import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
}));

// 真正发请求的那一层替换掉，用例只关心编排
vi.mock('@/models/client/proxy', () => ({
  proxy: { engine: { generate: mocks.generate } },
}));

import { models } from '@/models/client';
import type { Processer } from '@/models/client';
import { realms } from '@/stories/client/realms';
import type { Realm, RealmHistory } from '@/stories';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./processer.cases.json')).default);
}

const registered: string[] = [];

function registerProcesser<T, E extends Record<string, any>>(
  id: string,
  extra?: E,
): { id: string; init: ReturnType<typeof vi.fn> } & E {
  const processer = { id, init: vi.fn(async () => ({ cache: id })), ...extra };
  models.processers.registry.register(processer as unknown as Processer);
  registered.push(id);
  return processer as { id: string; init: ReturnType<typeof vi.fn> } & E;
}

function registerEngine(
  data: Awaited<ReturnType<typeof loadCases>>,
  onResult?: (ctx: any) => void,
) {
  const engine = {
    id: 'fake',
    configComponent: (() => null) as any,
    configureObject: vi.fn(),
    prompt: vi.fn(async (_ctx: any, _cache: any) => ({
      input: data.engineInput,
      summaries: [],
    })),
    result: vi.fn(async (ctx: any) => {
      if (onResult) onResult(ctx);
      else {
        ctx.output.content = data.engineResult.content;
        ctx.stopped = true;
      }
    }),
  };
  models.engines.registry.register(engine as any);
  return engine;
}

async function createRealm(histories: RealmHistory[] = []): Promise<Realm> {
  const data = await loadCases();
  const realm = structuredClone(
    (await import('../../stories/realm.json')).default,
  ) as any;

  return {
    ...realm,
    properties: {},
    histories,
    model: { ...realm.model, ...data.model },
  } as Realm;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const id of registered.splice(0)) {
    models.processers.registry.unregister(id);
  }
  models.engines.registry.unregister('fake');
});

describe('models processer / initialize', () => {
  it('应当按注册顺序初始化并把缓存写进 realm.context', async () => {
    const realm = await createRealm();
    const first = registerProcesser('p1');
    const second = registerProcesser('p2');

    await models.processers.initialize({ realm });

    expect(first.init).toHaveBeenCalledWith({ properties: {}, realm });
    expect(second.init).toHaveBeenCalledWith({ properties: {}, realm });
    expect(realm.context!['model.p1']).toEqual({ cache: 'p1' });
    expect(realm.context!['model.p2']).toEqual({ cache: 'p2' });
  });

  it('同一个 realm 重复初始化应当报重复', async () => {
    const realm = await createRealm();
    registerProcesser('p1');

    await models.processers.initialize({ realm });

    await expect(models.processers.initialize({ realm })).rejects.toThrow(
      /already initialized/,
    );
  });

  it('没有注册任何处理者时也不应当报错', async () => {
    const realm = await createRealm();

    await expect(
      models.processers.initialize({ realm }),
    ).resolves.toBeUndefined();
  });
});

describe('models processer / output', () => {
  it('应当把最后一段历史与各自缓存交给处理者', async () => {
    const historical = await loadCases();
    const histories = structuredClone(historical.histories) as RealmHistory[];
    const realm = await createRealm(histories);
    realm.context = { 'model.p1': { cache: 'p1' } };
    const first = registerProcesser('p1', {
      output: vi.fn(async (_ctx: any, _cache: any) => {}),
    });

    await models.processers.output({ realm });

    expect(first.output).toHaveBeenCalledWith(
      { properties: {}, realm, history: histories.at(-1) },
      { cache: 'p1' },
    );
  });

  it('没有实现 output 的处理者应当被跳过', async () => {
    const realm = await createRealm([
      structuredClone((await loadCases()).histories[0]) as RealmHistory,
    ]);
    realm.context = { 'model.p1': { cache: 'p1' } };
    registerProcesser('p1');

    await expect(models.processers.output({ realm })).resolves.toBeUndefined();
  });
});

describe('models processer / prompt', () => {
  it('应当从最后一个总结段落开始向上收集历史', async () => {
    const data = await loadCases();
    const histories = structuredClone(data.histories) as RealmHistory[];
    const realm = await createRealm(histories);
    const engine = registerEngine(data);
    const controller = new AbortController();

    const result = await models.processers.prompt({
      realm,
      args: { a: 1 },
      current: true,
      controller,
    });

    const context = engine.prompt.mock.calls[0][0] as any;
    expect(context.histories.map((u: RealmHistory) => u.sequence)).toEqual([
      0, 1, 2,
    ]);
    expect(context.history).toBe(histories[2]);
    expect(context.realm).toBe(realm);
    expect(context.controller).toBe(controller);
    expect(context.current).toBe(true);
    expect(context.converts).toEqual([]);
    expect(context.injects).toEqual([]);
    expect(context.properties).toEqual({ args: { a: 1 } });
    expect(result).toEqual({ input: data.engineInput, summaries: [] });
  });

  it('没有总结段落时应当补上开场白', async () => {
    const data = await loadCases();
    const histories = structuredClone(data.noSummary) as RealmHistory[];
    const realm = await createRealm(histories);
    const engine = registerEngine(data);

    await models.processers.prompt({
      realm,
      current: false,
      controller: new AbortController(),
    });

    const context = engine.prompt.mock.calls[0][0] as any;
    expect(context.histories).toHaveLength(2);
    expect(context.histories[0]).toBe(realm.context!['opening']);
    expect(context.history).toBe(histories[0]);
  });

  it('处理者应当拿到自己 key 下的缓存', async () => {
    const data = await loadCases();
    const realm = await createRealm(
      structuredClone(data.histories) as RealmHistory[],
    );
    realm.context = { 'model.p1': { cache: 'p1' } };
    const first = registerProcesser('p1', {
      prompt: vi.fn(async (_ctx: any, _cache: any) => {}),
    });
    registerEngine(data);

    await models.processers.prompt({
      realm,
      current: false,
      controller: new AbortController(),
    });

    expect(first.prompt).toHaveBeenCalledTimes(1);
    expect(first.prompt.mock.calls[0][1]).toEqual({ cache: 'p1' });
  });
});

describe('models processer / generate', () => {
  it('非流式生成应当调用引擎并产出一次输出', async () => {
    const data = await loadCases();
    const realm = await createRealm();
    const engine = registerEngine(data);
    mocks.generate.mockResolvedValue(data.engineResult);
    const controller = new AbortController();

    const items: any[] = [];
    for await (const item of models.processers.generate({ realm, controller })) {
      items.push(item);
    }

    expect(mocks.generate).toHaveBeenCalledWith(
      realm.model.id,
      data.engineInput,
      expect.anything(),
    );
    expect(items).toHaveLength(1);
    expect(items[0].output.content).toBe(data.engineResult.content);
    expect(items[0].outputs).toHaveLength(1);

    const result = engine.result.mock.calls[0][0] as any;
    expect(result.stream).toBe(false);
    expect(result.message).toBe(data.engineResult);
    expect(result.realm).toBe(realm);

    const history = await realms.history.get(null, realm);
    expect(history.output).toBe(1);
    expect(history.outputs).toHaveLength(2);
    expect(history.outputs[1]).toBe(items[0].outputs);
  });

  it('引擎报 retry 时应当重新请求', async () => {
    const data = await loadCases();
    const realm = await createRealm();
    registerEngine(data);
    mocks.generate
      .mockRejectedValueOnce(new Error('retry'))
      .mockResolvedValueOnce(data.engineResult);

    const items: any[] = [];
    for await (const item of models.processers.generate({
      realm,
      controller: new AbortController(),
    })) {
      items.push(item);
    }

    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(1);
  });

  it('其它错误应当直接抛出并结束生成', async () => {
    const data = await loadCases();
    const realm = await createRealm();
    registerEngine(data);
    mocks.generate.mockRejectedValue(new Error('boom'));

    const collect = async () => {
      for await (const _ of models.processers.generate({
        realm,
        controller: new AbortController(),
      })) {
        // 不应当走到这里
      }
    };

    await expect(collect()).rejects.toThrow('boom');
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
});
