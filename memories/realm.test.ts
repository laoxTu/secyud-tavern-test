import { search } from '@orama/orama';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessError } from '@/interceptors';
import { memories } from '@/memories/client';
import { rags, useRagState } from '@/memories/client/rag';
import type { MemoryCache } from '@/memories/client/realm';
import { processer } from '@/memories/client/realm';
import { models } from '@/models/client';
import type {
  ModelInjectContext,
  ModelPromptContext,
} from '@/models/client';
import type { Realm, RealmHistory } from '@/stories';
import { realms } from '@/stories/client/realms';

// 设置持久化会走请求层，这里整体替换掉，避免用例里出现真实请求
vi.mock('@/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./realm.cases.json')).default);
}

async function createRealm(overrides: Record<string, any> = {}): Promise<Realm> {
  return {
    ...structuredClone((await import('../stories/realm.json')).default),
    context: {},
    properties: {},
    entries: {},
    ...overrides,
  } as unknown as Realm;
}

/** 注册一个只返回固定向量的假 embedder */
function registerFake(dimension: number, vector: number[]) {
  const generate = vi.fn(async () => vector);
  const value = { dimension, generate };
  const embed = vi.fn(async () => value);
  rags.registry.register({
    id: 'fake',
    component: (() => null) as any,
    configure: () => ({}),
    embed,
  } as any);
  useRagState.setState({
    embedder: { type: 'fake', config: {} },
    disabled: false,
  });
  return { embed, generate, value };
}

/** 走一遍 prompt → 取出注入器 → 返回可驱动的 InjectMessage 与调用记录 */
async function injectWith(
  realm: Realm,
  cache: MemoryCache,
  histories: RealmHistory[],
) {
  const ctx = {
    realm,
    properties: {},
    histories,
    history: histories.at(-1),
    current: false,
    converts: [],
    injects: [],
    controller: new AbortController(),
  } as unknown as ModelPromptContext;

  await processer.prompt!(ctx, cache);

  const spies = {
    prompt: vi.fn(),
    assist: vi.fn(),
    system: vi.fn(),
    caller: vi.fn(),
  };
  const injectCtx = {
    builder: 'default',
    name: (index: number) => `t${index}`,
    ...spies,
  } as unknown as ModelInjectContext;
  const message = await ctx.injects[0](injectCtx);
  return { message, ...spies };
}

/** 命中时写入的调用结果由条目派生，避免和 fixture 两处手写 */
function expectedResult(entries: { name: string; text: string }[]) {
  return entries.map((u) => `- ${u.name}: ${u.text}`).join('\n');
}

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  rags.registry.unregister('fake');
  vi.restoreAllMocks();
  useRagState.setState({
    embedder: { type: 'transformers', config: {} },
    disabled: false,
  });
});

describe('memories processer / 常量', () => {
  it('id 与 plural 应当与模块约定一致', async () => {
    const data = await loadCases();

    expect(processer.id).toBe(data.moduleInfo.name);
    expect(memories.plural).toBe(data.moduleInfo.plural);
  });
});

describe('memories processer / init', () => {
  it('未注册 embedder 时 rag 应当为 null 且不生成嵌入', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      entries: { memories: data.entries },
    });

    const cache = await processer.init({ properties: {}, realm });

    expect(cache.rag).toBeNull();
  });

  it('启用 RAG 时应当缓存条目并按文本生成嵌入', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      entries: { memories: data.entries },
    });
    const fake = registerFake(data.dimension, data.embedding);

    const cache = await processer.init({ properties: {}, realm });

    expect(cache.rag).not.toBeNull();
    expect(cache.rag!.embed).toBe(fake.value);
    expect(fake.generate).toHaveBeenCalledTimes(data.entries.length);
    for (const entry of data.entries) {
      expect(fake.generate).toHaveBeenCalledWith({ content: entry.text });
      expect(cache.memories[entry.entryId]).toEqual(entry);
    }
  });

  it('启用 RAG 时应当把条目写进向量库', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      entries: { memories: data.entries },
    });
    registerFake(data.dimension, data.embedding);

    const cache = await processer.init({ properties: {}, realm });
    const results = await search(cache.rag!.database, {
      mode: 'vector',
      vector: { value: data.embedding, property: 'embedding' },
      similarity: 0.9,
      limit: 10,
    });
    const documents = results.hits.map((hit) => hit.document as any);

    expect(documents.map((u) => u.title).sort()).toEqual(
      data.entries.map((u) => u.name).sort(),
    );
    expect(
      documents.find((u) => u.entryId === data.entries[0].entryId),
    ).toEqual(
      expect.objectContaining({
        entryId: data.entries[0].entryId,
        title: data.entries[0].name,
        tags: data.entries[0].tags,
        type: data.entries[0].type,
        importance: data.entries[0].importance,
        sequence: data.entries[0].sequence,
      }),
    );
  });

  it('没有条目时向量库应当是空的', async () => {
    const data = await loadCases();
    const realm = await createRealm();
    const fake = registerFake(data.dimension, data.embedding);

    const cache = await processer.init({ properties: {}, realm });

    expect(fake.generate).not.toHaveBeenCalled();
    expect(cache.memories).toEqual({});
  });
});

describe('memories processer / prompt', () => {
  it('应当把注入器挂到 ctx.injects 上', async () => {
    const data = await loadCases();
    const realm = await createRealm();
    const cache = await processer.init({ properties: {}, realm });
    const ctx = {
      realm,
      properties: {},
      histories: [],
      history: undefined,
      current: false,
      converts: [],
      injects: [],
      controller: new AbortController(),
    } as unknown as ModelPromptContext;

    await processer.prompt!(ctx, cache);

    expect(ctx.injects).toHaveLength(1);
    expect(typeof ctx.injects[0]).toBe('function');
  });
});

describe('memories processer / 默认构造器的注入', () => {
  it('非最后一段历史应当把命中的记忆作为 knowledge 调用注入', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      entries: { memories: data.entries },
    });
    registerFake(data.dimension, data.embedding);
    const cache = await processer.init({ properties: {}, realm });
    const histories = [
      structuredClone(data.history),
      structuredClone(data.emptyHistory),
    ] as RealmHistory[];
    const { message, caller } = await injectWith(realm, cache, histories);

    await message.behind!(0);

    expect(caller).toHaveBeenCalledTimes(1);
    expect(caller).toHaveBeenCalledWith('', null, [
      {
        ...data.expectedCalling,
        result: expectedResult(data.entries),
      },
    ]);
  });

  it('最后一段历史不应当注入', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      entries: { memories: data.entries },
    });
    registerFake(data.dimension, data.embedding);
    const cache = await processer.init({ properties: {}, realm });
    const { message, caller } = await injectWith(realm, cache, [
      structuredClone(data.history),
    ] as RealmHistory[]);

    await expect(message.behind!(0)).resolves.toBeUndefined();

    expect(caller).not.toHaveBeenCalled();
  });

  it('没有命中记忆时不应当调用工具通道', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      entries: { memories: data.entries },
    });
    registerFake(data.dimension, data.embedding);
    const cache = await processer.init({ properties: {}, realm });
    const histories = [
      structuredClone(data.emptyHistory),
      structuredClone(data.history),
    ] as RealmHistory[];
    const { message, caller } = await injectWith(realm, cache, histories);

    await message.behind!(0);

    expect(caller).not.toHaveBeenCalled();
  });

  it('缓存里没有对应记忆时应当跳过', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      entries: { memories: data.entries },
    });
    registerFake(data.dimension, data.embedding);
    const cache = await processer.init({ properties: {}, realm });
    const histories = [
      structuredClone(data.missingHistory),
      structuredClone(data.emptyHistory),
    ] as RealmHistory[];
    const { message, caller } = await injectWith(realm, cache, histories);

    await message.behind!(0);

    expect(caller).not.toHaveBeenCalled();
  });

  it('同一段历史里重复的编码只注入一次', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      entries: { memories: data.entries },
    });
    registerFake(data.dimension, data.embedding);
    const cache = await processer.init({ properties: {}, realm });
    const histories = [
      structuredClone(data.duplicateHistory),
      structuredClone(data.emptyHistory),
    ] as RealmHistory[];
    const { message, caller } = await injectWith(realm, cache, histories);

    await message.behind!(0);

    expect(caller).toHaveBeenCalledTimes(1);
    expect(caller.mock.calls[0][2][0].result).toBe(
      expectedResult(data.entries),
    );
  });

  it('跨历史命中的同一记忆只注入一次', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      entries: { memories: data.entries },
    });
    registerFake(data.dimension, data.embedding);
    const cache = await processer.init({ properties: {}, realm });
    const histories = [
      structuredClone(data.firstOnlyHistory),
      structuredClone(data.firstOnlyHistory),
      structuredClone(data.emptyHistory),
    ] as RealmHistory[];
    const { message, caller } = await injectWith(realm, cache, histories);

    await message.behind!(0);
    await message.behind!(1);

    expect(caller).toHaveBeenCalledTimes(1);
  });

  it('不同历史命中的不同记忆应当各自编号', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      entries: { memories: data.entries },
    });
    registerFake(data.dimension, data.embedding);
    const cache = await processer.init({ properties: {}, realm });
    const histories = [
      structuredClone(data.firstOnlyHistory),
      structuredClone(data.secondOnlyHistory),
      structuredClone(data.emptyHistory),
    ] as RealmHistory[];
    const { message, caller } = await injectWith(realm, cache, histories);

    await message.behind!(0);
    await message.behind!(1);

    expect(caller.mock.calls.map((call) => call[2][0].id)).toEqual([
      't0m',
      't1m',
    ]);
    expect(caller.mock.calls[0][2][0].result).toBe(
      expectedResult([data.entries[0]]),
    );
    expect(caller.mock.calls[1][2][0].result).toBe(
      expectedResult([data.entries[1]]),
    );
  });

  it('RAG 关闭时已缓存的记忆仍然会注入', async () => {
    const data = await loadCases();
    const realm = await createRealm();
    const cache: MemoryCache = {
      rag: null,
      memories: Object.fromEntries(
        data.entries.map((u: any) => [u.entryId, u]),
      ),
    };
    const histories = [
      structuredClone(data.history),
      structuredClone(data.emptyHistory),
    ] as RealmHistory[];
    const { message, caller } = await injectWith(realm, cache, histories);

    await message.behind!(0);

    expect(caller).toHaveBeenCalledTimes(1);
    expect(caller.mock.calls[0][2][0].result).toBe(
      expectedResult(data.entries),
    );
  });
});

describe('memories / 与 models.cache 的约定', () => {
  it('缓存应当以 model.memory 为键挂在 realm.context 上', async () => {
    const realm = await createRealm();

    expect(() => memories.cache(realm)).toThrow(BusinessError);

    const cache: MemoryCache = { rag: null, memories: {} };
    realms.initContext(realm, 'model.memory', cache);

    expect(memories.cache(realm)).toBe(cache);
    expect(models.cache(realm, memories.name)).toBe(cache);
  });

  it('init 返回的缓存可以直接挂到 realm.context 上复用', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      entries: { memories: data.entries },
    });
    registerFake(data.dimension, data.embedding);

    const cache = await processer.init({ properties: {}, realm });
    realms.initContext(realm, models.key(processer.id), cache);

    expect(memories.cache(realm)).toBe(cache);
    expect(Object.keys(cache.memories)).toHaveLength(data.entries.length);
  });
});
