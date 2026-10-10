import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  translate: vi.fn((message: string) => `translated:${message}`),
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

// 只替换 UI 边界：toast 与 translator，其余导出保持真实实现
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    translator: { ...actual.translator, translate: mocks.translate },
  };
});

import { signals as main } from '@/signal';
import registerSignals, {
  signals,
  useSse,
  useSseConnection,
} from '@/signal/client';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

/**
 * jsdom 没有 EventSource，这里伪造一个可手动派发的实现：
 * 记录 url、按类型保存监听器，并提供 dispatch / emit 两种派发方式
 */
class StubEventSource {
  static instances: StubEventSource[] = [];
  readonly url: string;
  readonly listeners = new Map<string, Set<(event: any) => void>>();

  constructor(url: string) {
    this.url = url;
    StubEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  /** 按类型派发，模拟真实 EventSource 的分发规则 */
  dispatch(type: string, data: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ type, data });
    }
  }

  /** 不分类型，直接交给所有监听器，用来验证回调里的类型判断 */
  emit(event: { type: string; data: string }) {
    for (const listeners of [...this.listeners.values()]) {
      for (const listener of [...listeners]) listener(event);
    }
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

/**
 * jsdom 没有 EventSource，state 里保存的实际上是上面的桩；
 * 取状态时收窄到 StubEventSource，用例才能直接用 dispatch / emit / listenerCount
 */
function connectionState() {
  return useSseConnection.getState() as ReturnType<
    typeof useSseConnection.getState
  > & { eventSource: StubEventSource } & { id: string };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('EventSource', StubEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signal client / useSseConnection', () => {
  it('id 应当是 uuid v7', () => {
    expect(useSseConnection.getState().id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('eventSource 懒加载到 /api/sse/{id}，重复访问返回同一个实例', () => {
    const id = useSseConnection.getState().id;
    const before = StubEventSource.instances.length;

    const first = connectionState().eventSource;
    const second = connectionState().eventSource;

    expect(first).toBe(second);
    expect(first.url).toBe(`/api/sse/${id}`);
    // 只建一次：多次访问最多新增一个实例，且就是这个
    expect(StubEventSource.instances.length - before).toBeLessThanOrEqual(1);
    expect(
      StubEventSource.instances.filter((item) => item === first),
    ).toHaveLength(1);
  });
});

describe('signal client / useSse', () => {
  it('回调应当收到 target 与去掉 target 的载荷', async () => {
    const data = await loadCases();
    const callback = vi.fn();
    renderHook(() => useSse(data.progress.type, callback));
    const es = connectionState().eventSource;

    es.dispatch(data.progress.type, JSON.stringify(data.progress.payload));

    const { target: expectedTarget, ...expectedPayload } = data.progress.payload;
    expect(callback).toHaveBeenCalledTimes(1);
    const [target, payload] = callback.mock.calls[0];
    expect(target).toBe(expectedTarget);
    expect(payload).toEqual(expectedPayload);
    // target 被显式置成 undefined（键还在，值没了）
    expect(Object.keys(payload)).toContain('target');
    expect(payload.target).toBeUndefined();
  });

  it('载荷里没有 target 时回调收到空串', async () => {
    const data = await loadCases();
    const callback = vi.fn();
    renderHook(() => useSse(data.progress.type, callback));
    const es = connectionState().eventSource;
    const { target, ...payload } = data.progress.payload;

    es.dispatch(data.progress.type, JSON.stringify(payload));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toBe('');
  });

  it('事件类型不匹配时不触发回调', async () => {
    const data = await loadCases();
    const callback = vi.fn();
    renderHook(() => useSse(data.progress.type, callback));
    const es = connectionState().eventSource;

    es.emit({
      type: data.mismatchType,
      data: JSON.stringify(data.progress.payload),
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('载荷不是合法 json 或为空时不触发回调', async () => {
    const data = await loadCases();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const callback = vi.fn();
    renderHook(() => useSse(data.progress.type, callback));
    const es = connectionState().eventSource;

    try {
      es.dispatch(data.progress.type, data.invalidPayload);
      es.dispatch(data.progress.type, data.emptyPayload);

      expect(callback).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('卸载时移除事件监听', async () => {
    const data = await loadCases();
    const es = connectionState().eventSource;
    const before = es.listenerCount(data.progress.type);

    const { unmount } = renderHook(() => useSse(data.progress.type, vi.fn()));
    expect(es.listenerCount(data.progress.type)).toBe(before + 1);

    unmount();

    expect(es.listenerCount(data.progress.type)).toBe(before);
  });
});

describe('signal client / signals 组合与注册', () => {
  it('signals 应当合并主模块工具与 proxy', () => {
    expect(signals.setAbort).toBe(main.setAbort);
    expect(signals.createSub).toBe(main.createSub);
    expect(typeof signals.proxy.subscription).toBe('function');
  });

  it('默认导出把 toast 事件转成 sonner 提示，未知类型回落到 error', async () => {
    const data = await loadCases();
    await registerSignals();
    const es = connectionState().eventSource;

    es.dispatch('toast', JSON.stringify(data.toast));
    es.dispatch('toast', JSON.stringify(data.unknownToast));

    expect(mocks.translate).toHaveBeenNthCalledWith(
      1,
      data.toast.message,
      data.toast.data,
    );
    expect(mocks.toast[(data.toast.type as 'success')]).toHaveBeenCalledTimes(1);
    expect(mocks.toast[(data.toast.type as 'success')]).toHaveBeenCalledWith(
      `translated:${data.toast.message}`,
      { richColors: true },
    );
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).toHaveBeenCalledWith(
      `translated:${data.unknownToast.message}`,
      { richColors: true },
    );
  });
});
