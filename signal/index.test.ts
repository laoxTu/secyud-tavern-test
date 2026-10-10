import { describe, expect, it, vi } from 'vitest';

import { signals, sseUtils } from '@/signal';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

/** 把若干文本块拼成一个 ReadableStream，用来模拟分块到达的响应体 */
function streamOf(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** 按字节读完整个流 */
async function readAll(stream: ReadableStream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text;
}

/** 收集 async generator 的全部产出 */
async function collect<T>(items: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}

/**
 * jsdom 的 AbortSignal 不暴露监听器数量，这里伪造一个可统计的
 * 只实现 setAbort / createSub 用到的那几个成员
 */
function fakeSignal() {
  const listeners = new Set<(event: Event) => void>();
  const signal = {
    aborted: false,
    reason: undefined as any,
    addEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
      if (type === 'abort') listeners.add(listener);
    }),
    removeEventListener: vi.fn(
      (type: string, listener: (event: Event) => void) => {
        if (type === 'abort') listeners.delete(listener);
      },
    ),
    /** 直接触发一次，不管 aborted 状态，用来验证监听器是否真的被摘掉 */
    fire() {
      for (const listener of [...listeners]) listener(new Event('abort'));
    },
    abort(reason?: any) {
      if (signal.aborted) return;
      signal.aborted = true;
      signal.reason = reason;
      signal.fire();
    },
    listenerCount: () => listeners.size,
  };
  return signal;
}

describe('signal / sseUtils.pack', () => {
  it('应当逐项打包成 data 帧，末尾补 [DONE] 后关闭', async () => {
    const data = await loadCases();
    async function* source() {
      yield* data.items;
    }

    const text = await readAll(await sseUtils.pack(source()));

    // 期望值从 fixture 派生，改数据时只改 json
    const expected =
      data.items
        .map((item: any) => `data: ${JSON.stringify(item)}\n\n`)
        .join('') + 'data: [DONE]\n\n';
    expect(text).toBe(expected);
  });

  it('空迭代器只产出 [DONE]', async () => {
    const data = await loadCases();
    async function* source() {
      yield* data.emptyItems;
    }

    const text = await readAll(await sseUtils.pack(source()));

    expect(text).toBe('data: [DONE]\n\n');
  });

  it('迭代器抛错时流带着同一个错误终止', async () => {
    const data = await loadCases();
    async function* source() {
      yield data.failedItem;
      throw new Error(data.error);
    }
    const reader = (await sseUtils.pack(source())).getReader();

    try {
      // 抛错前已经产出的那一帧还在
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe(
        `data: ${JSON.stringify(data.failedItem)}\n\n`,
      );
      await expect(reader.read()).rejects.toThrow(data.error);
    } finally {
      reader.releaseLock();
    }
  });

  it('pack 产出的流可以被 read 原样读回', async () => {
    const data = await loadCases();
    async function* source() {
      yield* data.items;
    }

    const result = await collect(sseUtils.read(await sseUtils.pack(source())));

    expect(result).toEqual(data.items);
  });
});

describe('signal / sseUtils.read', () => {
  it('应当按空行切分事件并跳过 [DONE]', async () => {
    const data = await loadCases();

    const result = await collect(sseUtils.read(streamOf(data.read.single.chunks)));

    expect(result).toEqual(data.read.single.expected);
  });

  it('跨块到达的事件会被拼回同一个事件', async () => {
    const data = await loadCases();

    const result = await collect(sseUtils.read(streamOf(data.read.split.chunks)));

    expect(result).toEqual(data.read.split.expected);
  });

  it('多行 data 会被并成同一条事件', async () => {
    const data = await loadCases();

    const result = await collect(
      sseUtils.read(streamOf(data.read.multiLine.chunks)),
    );

    expect(result).toEqual(data.read.multiLine.expected);
  });

  it('最后一块没有终止符时也要处理', async () => {
    const data = await loadCases();

    const result = await collect(
      sseUtils.read(streamOf(data.read.trailing.chunks)),
    );

    expect(result).toEqual(data.read.trailing.expected);
  });

  it('只有 [DONE] 时什么都不产出', async () => {
    const data = await loadCases();

    const result = await collect(
      sseUtils.read(streamOf(data.read.onlyDone.chunks)),
    );

    expect(result).toEqual(data.read.onlyDone.expected);
  });

  it('空流什么都不产出', async () => {
    const data = await loadCases();

    const result = await collect(sseUtils.read(streamOf(data.read.empty.chunks)));

    expect(result).toEqual(data.read.empty.expected);
  });

  it('非法 json 的事件被静默跳过', async () => {
    const data = await loadCases();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = await collect(
        sseUtils.read(streamOf(data.read.invalid.chunks)),
      );

      expect(result).toEqual(data.read.invalid.expected);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('读完后应当释放 reader 锁', async () => {
    const data = await loadCases();
    const stream = streamOf(data.read.single.chunks);

    const result = await collect(sseUtils.read(stream));

    expect(result).toEqual(data.read.single.expected);
    expect(stream.locked).toBe(false);
  });
});

describe('signal / signals.setAbort', () => {
  it('中止前不触发，中止后把事件交给操作', async () => {
    const data = await loadCases();
    const controller = new AbortController();
    const action = vi.fn();

    signals.setAbort(controller.signal, action);
    expect(action).not.toHaveBeenCalled();

    controller.abort(data.abortReason);

    expect(action).toHaveBeenCalledTimes(1);
    expect(action.mock.calls[0][0].type).toBe('abort');
  });

  it('触发后自动解绑，再触发不会重复调用', async () => {
    const signal = fakeSignal();
    const action = vi.fn();

    signals.setAbort(signal as unknown as AbortSignal, action);
    expect(signal.listenerCount()).toBe(1);

    signal.abort();
    // 监听器已经摘掉，再触发一次也不该有第二次回调
    signal.fire();

    expect(action).toHaveBeenCalledTimes(1);
    expect(signal.listenerCount()).toBe(0);
  });
});

describe('signal / signals.createSub', () => {
  it('父信号中止时用同一个 reason 中止子控制器', async () => {
    const data = await loadCases();
    const parent = new AbortController();

    const { controller } = signals.createSub(parent.signal);
    expect(controller.signal.aborted).toBe(false);

    parent.abort(data.subReason);

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe(data.subReason);
  });

  it('父信号已经中止时立即中止子控制器', async () => {
    const data = await loadCases();
    const parent = new AbortController();
    parent.abort(data.abortReason);

    const { controller } = signals.createSub(parent.signal);

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe(data.abortReason);
  });

  it('destroy 之后父信号中止不再影响子控制器', async () => {
    const data = await loadCases();
    const parent = new AbortController();
    const { controller, destroy } = signals.createSub(parent.signal);

    destroy();
    parent.abort(data.abortReason);

    expect(controller.signal.aborted).toBe(false);
  });

  it('父信号中止后自动解绑（用假信号统计监听器）', async () => {
    const signal = fakeSignal();

    const { controller } = signals.createSub(signal as unknown as AbortSignal);
    expect(signal.listenerCount()).toBe(1);

    signal.abort('fake-reason');

    expect(signal.listenerCount()).toBe(0);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe('fake-reason');
  });
});
