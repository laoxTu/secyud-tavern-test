import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// route 只负责拦截器编排，这里直接暴露处理函数
vi.mock('@/interceptors/server', () => ({
  route: (handler: unknown) => handler,
}));

import { BusinessError } from '@/interceptors';
import api from '@/signal/server/api';
import { registry, type SseEvent } from '@/signal/server';

const handlers = (api as any).sse['[id]'];
const baseUrl = 'http://localhost/api/sse';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./api.cases.json')).default);
}

const registeredIds: string[] = [];

/** 记住用例建过的连接，跑完统一清理（registry 是全局单例） */
function track(id: string) {
  registeredIds.push(id);
  return id;
}

/** 按 Next.js 的签名调用处理函数（route 已被替换为直通） */
function call(
  handler: any,
  options: { request?: Request; params?: Record<string, string> } = {},
) {
  return handler(options.request ?? new Request(baseUrl), {
    params: Promise.resolve(options.params ?? {}),
    searchParams: {},
  });
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

/** 建立一条 sse 长连接 */
async function connect(id: string, signal?: AbortSignal) {
  track(id);
  const request = new Request(`${baseUrl}/${id}`, { signal });
  const response = await call(handlers.GET, { request, params: { id } });
  return { request, response, event: registry.record(id) as SseEvent };
}

/** 只读一帧（一次 enqueue = 一个 chunk） */
async function readChunk(response: Response) {
  const reader = response.body!.getReader();
  try {
    const { value } = await reader.read();
    return new TextDecoder().decode(value);
  } finally {
    reader.releaseLock();
  }
}

function post(id: string, body: unknown) {
  track(id);
  return call(handlers.subscription.POST, {
    request: jsonRequest(`${baseUrl}/${id}/subscription`, body),
    params: { id },
  });
}

/** 按源码的拼帧规则派生期望值 */
function frame(message: any) {
  return `event: ${message.type}\ndata: ${JSON.stringify({
    ...message.data,
    target: message.target,
  })}\n\n`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const id of registeredIds.splice(0)) registry.unregister(id);
  vi.restoreAllMocks();
});

describe('signal api / GET sse/[id]', () => {
  it('应当返回 SSE 响应头并注册事件', async () => {
    const data = await loadCases();

    const { response, event } = await connect(data.ids.conn);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'text/event-stream; charset=utf-8',
    );
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(response.headers.get('connection')).toBe('keep-alive');
    expect(response.headers.get('content-encoding')).toBe('none');
    expect(registry.record(data.ids.conn)).toBe(event);
    expect(typeof event.send).toBe('function');
    // 默认订阅 toast，且是不过滤 target 的 all
    expect(event.subscriptions.get('toast')).toEqual({
      targets: [],
      status: 'all',
    });
  });

  it('同一个 id 重复连接应当复用同一个事件对象', async () => {
    const data = await loadCases();

    const first = await connect(data.ids.conn);
    const second = await connect(data.ids.conn);

    expect(second.event).toBe(first.event);
  });

  it('send 应当按 SSE 格式逐条写出帧', async () => {
    const data = await loadCases();
    const { response, event } = await connect(data.ids.conn);

    await event.send!(data.message);
    await event.send!(data.secondMessage);

    await expect(readChunk(response)).resolves.toBe(frame(data.message));
    await expect(readChunk(response)).resolves.toBe(frame(data.secondMessage));
  });

  it('请求中止时注销事件', async () => {
    const data = await loadCases();
    const controller = new AbortController();

    await connect(data.ids.abort, controller.signal);
    expect(registry.record(data.ids.abort)).toBeTruthy();

    controller.abort();

    expect(registry.record(data.ids.abort)).toBeNull();
  });

  it('流被取消时注销事件', async () => {
    const data = await loadCases();
    const { response } = await connect(data.ids.cancel);
    expect(registry.record(data.ids.cancel)).toBeTruthy();

    await response.body!.cancel();

    expect(registry.record(data.ids.cancel)).toBeNull();
  });
});

describe('signal api / POST sse/[id]/subscription', () => {
  it('set 应当整体写入订阅并返回 null', async () => {
    const data = await loadCases();

    const response = await post(data.ids.created, data.set);

    // id 不存在时会顺手建出连接
    const event = registry.record(data.ids.created) as SseEvent;
    expect(event).toBeTruthy();
    expect(event.subscriptions.get(data.set.type)).toEqual({
      status: data.set.status,
      targets: data.set.targets,
    });
    await expect(response.json()).resolves.toBeNull();
  });

  it('set 应当写在已存在的连接上', async () => {
    const data = await loadCases();
    const { event } = await connect(data.ids.delPart);

    await post(data.ids.delPart, data.set);

    expect(registry.record(data.ids.delPart)).toBe(event);
    expect(event.subscriptions.get(data.set.type)?.targets).toEqual(
      data.set.targets,
    );
  });

  it('add 没有旧订阅时按请求体建，已有订阅时去重合并', async () => {
    const data = await loadCases();

    await post(data.ids.addFresh, data.addFresh);
    const event = registry.record(data.ids.addFresh) as SseEvent;
    expect(event.subscriptions.get(data.addFresh.type)?.targets).toEqual(
      data.addFresh.targets,
    );

    await post(data.ids.addFresh, data.addMerge);

    expect(event.subscriptions.get(data.addMerge.type)?.targets).toEqual([
      ...new Set([...data.addFresh.targets, ...data.addMerge.targets]),
    ]);
  });

  it('del 按 targets 逐个移除，仍有剩余时保留订阅', async () => {
    const data = await loadCases();
    await post(data.ids.delPart, data.set);

    await post(data.ids.delPart, data.delPart);

    const event = registry.record(data.ids.delPart) as SseEvent;
    const remaining = data.set.targets.filter(
      (item: string) => !data.delPart.targets.includes(item),
    );
    expect(event.subscriptions.get(data.set.type)?.targets).toEqual(remaining);
  });

  it('del 移除后为空集时删掉整个订阅', async () => {
    const data = await loadCases();
    await post(data.ids.delEmpty, data.set);

    await post(data.ids.delEmpty, data.delBoth);

    const event = registry.record(data.ids.delEmpty) as SseEvent;
    expect(event.subscriptions.has(data.set.type)).toBe(false);
  });

  it('del 且 status 为 all 时无论原有 targets 都整体删除', async () => {
    const data = await loadCases();
    await post(data.ids.delAll, data.set);
    expect(
      (registry.record(data.ids.delAll) as SseEvent).subscriptions.has(
        data.set.type,
      ),
    ).toBe(true);

    await post(data.ids.delAll, data.delAll);

    const event = registry.record(data.ids.delAll) as SseEvent;
    expect(event.subscriptions.has(data.delAll.type)).toBe(false);
  });

  it('del 一个不存在的订阅时静默返回 null', async () => {
    const data = await loadCases();

    const response = await post(data.ids.delMissing, data.delMissing);

    const event = registry.record(data.ids.delMissing) as SseEvent;
    expect(event.subscriptions.size).toBe(0);
    await expect(response.json()).resolves.toBeNull();
  });

  it('未知 action 抛 BusinessError 并带上 action', async () => {
    const data = await loadCases();

    const error = (await post(data.ids.unknown, data.unknownAction).catch(
      (err: unknown) => err,
    )) as BusinessError;

    expect(error).toBeInstanceOf(BusinessError);
    expect(error.message).toBe(`unknown action: ${data.unknownAction.action}`);
    expect(error.code).toBe('error.sse.unknown_action');
    expect(error.data).toEqual({ action: data.unknownAction.action });
  });
});
