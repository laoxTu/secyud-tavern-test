import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initContext: vi.fn(),
  cache: vi.fn(),
  key: vi.fn((id: string) => `realm.${id}`),
  content: vi.fn(),
  variables: vi.fn(),
  convert: vi.fn(),
}));

vi.mock('@/models/client', () => ({
  models: { convert: mocks.convert },
}));
vi.mock('@/stories/client/realms', () => ({
  realms: {
    initContext: mocks.initContext,
    cache: mocks.cache,
    key: mocks.key,
    message: {
      content: mocks.content,
      variables: mocks.variables,
    },
  },
}));

import { renderers } from '@/stories/client/renderer';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./renderer.cases.json')).default);
}

const registered: string[] = [];

/** registry 是模块内闭包的全局单例，只能往里面注册，注册完记得清掉 */
function register(...items: any[]) {
  renderers.registry.register(...items);
  registered.push(...items.map((u) => u.id));
}

afterEach(() => {
  for (const id of registered.splice(0)) {
    renderers.registry.unregister(id);
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cache.mockImplementation((_realm: any, id: string) => ({ cached: id }));
});

describe('stories renderer / initialize', () => {
  it('应当按顺序 init 并把缓存写进 realm context', async () => {
    const data = await loadCases();
    const calls: string[] = [];
    register(
      {
        id: 'first',
        sequence: 1,
        init: vi.fn(async () => {
          calls.push('first');
          return { n: 1 };
        }),
      },
      {
        id: 'second',
        sequence: 2,
        init: vi.fn(async () => {
          calls.push('second');
          return { n: 2 };
        }),
      },
    );

    await renderers.initialize({ realm: data.realm as any });

    expect(calls).toEqual(['first', 'second']);
    expect(mocks.initContext).toHaveBeenNthCalledWith(
      1,
      data.realm,
      'realm.first',
      { n: 1 },
    );
    expect(mocks.initContext).toHaveBeenNthCalledWith(
      2,
      data.realm,
      'realm.second',
      { n: 2 },
    );
  });

  it('init 抛错时应当把错误抛出去', async () => {
    const data = await loadCases();
    register({
      id: 'bad',
      init: vi.fn(async () => {
        throw new Error('init boom');
      }),
    });

    await expect(
      renderers.initialize({ realm: data.realm as any }),
    ).rejects.toThrow('init boom');
    expect(mocks.initContext).not.toHaveBeenCalled();
  });
});

describe('stories renderer / content', () => {
  it('应当先 output，再处理内容，最后处理变量', async () => {
    const data = await loadCases();
    const order: string[] = [];
    const output = vi.fn(async () => {
      order.push('output');
    });
    register({ id: 'order-a', output });
    mocks.content.mockImplementation(async () => {
      order.push('content');
    });
    mocks.variables.mockImplementation(() => {
      order.push('variables');
    });

    await renderers.content({
      history: data.history as any,
      realm: data.realm as any,
    });

    expect(order).toEqual(['output', 'content', 'variables']);
    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({
        history: data.history,
        realm: data.realm,
        converts: [],
      }),
      { cached: 'order-a' },
    );
  });

  it('处理器往 converts 里塞的内容应当被同一个 convert 使用', async () => {
    const data = await loadCases();
    let seen: any;
    register({
      id: 'convert-a',
      output: vi.fn(async (ctx: any) => {
        seen = ctx.converts;
        ctx.converts.push({ type: 'test' });
      }),
    });
    let handler: any;
    mocks.content.mockImplementation(async (_history: any, fn: any) => {
      handler = fn;
    });

    await renderers.content({
      history: data.history as any,
      realm: data.realm as any,
    });
    const result = await handler('text', { role: 'user' });

    expect(seen).toEqual([{ type: 'test' }]);
    expect(mocks.convert).toHaveBeenCalledWith([{ type: 'test' }], 'text', {
      role: 'user',
    });
    expect(result).toBe(mocks.convert.mock.results[0]?.value);
  });

  it('没有 output 的处理器不会破坏编排', async () => {
    const data = await loadCases();
    register({ id: 'no-output' });

    await renderers.content({
      history: data.history as any,
      realm: data.realm as any,
    });

    expect(mocks.content).toHaveBeenCalledTimes(1);
    expect(mocks.variables).toHaveBeenCalledTimes(1);
  });
});

describe('stories renderer / stream', () => {
  it('应当调 stream 与内容处理，但不处理变量', async () => {
    const data = await loadCases();
    const stream = vi.fn(async () => {});
    register({ id: 'stream-a', stream });

    await renderers.stream({
      history: data.history as any,
      realm: data.realm as any,
    });

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({ history: data.history, realm: data.realm }),
      { cached: 'stream-a' },
    );
    expect(mocks.content).toHaveBeenCalledTimes(1);
    expect(mocks.variables).not.toHaveBeenCalled();
  });

  it('没有 stream 的处理器被跳过', async () => {
    const data = await loadCases();
    register({ id: 'no-stream' });

    await renderers.stream({
      history: data.history as any,
      realm: data.realm as any,
    });

    expect(mocks.content).toHaveBeenCalledTimes(1);
  });
});
