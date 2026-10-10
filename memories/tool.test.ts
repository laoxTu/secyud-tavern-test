import { create as createDatabase, insert, search } from '@orama/orama';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { memories } from '@/memories/client';
import { memorySchema, type MemoryCache } from '@/memories/client/realm';
import { provider } from '@/memories/client/tool';
import { useRagState } from '@/memories/client/rag';
import type { Realm, RealmHistory } from '@/stories';
import type { ToolItem } from '@/tools/client';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));

// 请求层整体替换掉：设置持久化与条目接口都不打真实请求
vi.mock('@/client', () => ({
  get: mocks.get,
  post: mocks.post,
  put: mocks.put,
  del: mocks.del,
  open: mocks.open,
}));

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./tool.cases.json')).default);
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

/** 造一个已经建好向量的 RAG 缓存，schema 直接复用业务定义 */
async function createRag(documents: any[], queryEmbedding: number[]) {
  const database = createDatabase({
    schema: {
      ...memorySchema,
      embedding: `vector[${queryEmbedding.length}]`,
    },
    sort: { enabled: true },
  });
  for (const document of documents) {
    await insert(database, structuredClone(document));
  }
  return {
    embed: {
      dimension: queryEmbedding.length,
      generate: vi.fn(async () => queryEmbedding),
    },
    database,
  };
}

/** RAG 缓存挂在 realm.context 的 model.memory 上，这里直接造好 */
function withCache(realm: Realm, rag: any, memories: Record<number, any> = {}) {
  const cache: MemoryCache = { rag, memories };
  realm.context = { 'model.memory': cache };
  return { cache, realm };
}

/** 取出指定名字的工具 */
async function createTool(realm: Realm, name: string) {
  const tools = await provider.create(null as any, realm);
  return tools.find((u) => u.name === name) as ToolItem<any>;
}

/** 取最后一条输出消息上写回的编码 */
function codesOf(realm: Realm) {
  const history = realm.histories.at(-1) as RealmHistory;
  return history.outputs[history.output]!.at(-1)!.properties!.memory;
}

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  useRagState.setState({ limit: 5, similarity: 0.75 });
});

describe('memories tool / provider', () => {
  it('应当以模块名注册，并同时提供读写两个工具', async () => {
    const data = await loadCases();
    const realm = await createRealm();

    const tools = await provider.create(null as any, realm);

    expect(provider.id).toBe(memories.name);
    expect(tools.map((u) => u.name)).toEqual(data.toolNames);
  });

  it('get_memory 的参数 schema 应当声明检索条件与默认值', async () => {
    const data = await loadCases();
    const realm = await createRealm();
    const tool = await createTool(realm, 'get_memory');
    const properties = tool.parameters.properties as Record<string, any>;
    const { limit, similarity } = useRagState.getState();

    expect(tool.parameters.required).toEqual(['content']);
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(properties.content.type).toBe('string');
    expect(properties.types.type).toBe('array');
    expect(properties.types.items.enum).toEqual(memories.types);
    expect(properties.tags.type).toBe('array');
    expect(properties.limit).toEqual({
      type: 'integer',
      description: expect.any(String),
      minimum: 1,
      maximum: 5,
      default: limit,
    });
    expect(properties.min_relevance.default).toBe(similarity);
    expect(properties.min_relevance.minimum).toBe(0);
    expect(properties.min_relevance.maximum).toBe(1);
  });

  it('默认值应当在创建时快照，之后的设置变化不影响已创建的工具', async () => {
    const realm = await createRealm();
    const before = useRagState.getState();
    const tool = await createTool(realm, 'get_memory');

    useRagState.setState({ limit: 2, similarity: 0.4 });

    const properties = tool.parameters.properties as Record<string, any>;
    expect(properties.limit.default).toBe(before.limit);
    expect(properties.min_relevance.default).toBe(before.similarity);

    const next = await createTool(realm, 'get_memory');
    const nextProperties = next.parameters.properties as Record<string, any>;
    expect(nextProperties.limit.default).toBe(2);
    expect(nextProperties.min_relevance.default).toBe(0.4);
  });

  it('set_memory 的参数 schema 应当约束类型与重要度', async () => {
    const data = await loadCases();
    const realm = await createRealm();
    const tool = await createTool(realm, 'set_memory');
    const properties = tool.parameters.properties as Record<string, any>;

    expect(tool.parameters.required).toEqual(['content']);
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(properties.type.enum).toEqual(memories.types);
    expect(properties.importance.minimum).toBe(1);
    expect(properties.importance.maximum).toBe(10);
    expect(properties.importance.default).toBe(memories.default.importance);
    expect(tool.description).toBeTruthy();
  });
});

describe('memories tool / get_memory invoke', () => {
  it('没有输出消息时应当直接报错', async () => {
    const data = await loadCases();
    const realm = await createRealm();
    withCache(realm, null);
    const tool = await createTool(realm, 'get_memory');

    const result = await tool.invoke({
      args: { content: data.query },
      controller: new AbortController(),
    });

    expect(result).toBe(data.result.notFound);
  });

  it('未启用 RAG 时应当提示未开启', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      histories: [structuredClone(data.history)],
    });
    withCache(realm, null);
    const tool = await createTool(realm, 'get_memory');

    const result = await tool.invoke({
      args: { content: data.query },
      controller: new AbortController(),
    });

    expect(result).toBe(data.result.noRag);
  });

  it('命中时应当按加权重排后返回标题并写回编码', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      histories: [structuredClone(data.history)],
    });
    const rag = await createRag(data.documents, data.queryEmbedding);
    withCache(realm, rag);
    const tool = await createTool(realm, 'get_memory');

    const result = await tool.invoke({
      args: { content: data.query },
      controller: new AbortController(),
    });

    expect(rag.embed.generate).toHaveBeenCalledWith({ content: data.query });
    expect(JSON.parse(result)).toEqual(data.expectedTitles);
    expect(codesOf(realm)).toEqual(data.expectedCodes);
  });

  it('min_relevance 应当过滤掉相似度不足的结果', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      histories: [structuredClone(data.history)],
    });
    const rag = await createRag(data.documents, data.queryEmbedding);
    withCache(realm, rag);
    const tool = await createTool(realm, 'get_memory');

    const result = await tool.invoke({
      args: {
        content: data.query,
        min_relevance: data.minRelevance.value,
      },
      controller: new AbortController(),
    });

    expect(JSON.parse(result)).toEqual(data.minRelevance.titles);
    expect(codesOf(realm)).toEqual(data.minRelevance.codes);
  });

  it('limit 应当限制返回与写回的条数', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      histories: [structuredClone(data.history)],
    });
    const rag = await createRag(data.documents, data.queryEmbedding);
    withCache(realm, rag);
    const tool = await createTool(realm, 'get_memory');

    const result = await tool.invoke({
      args: { content: data.query, limit: data.limit.value, min_relevance: 0 },
      controller: new AbortController(),
    });

    expect(JSON.parse(result)).toEqual(data.limit.titles);
    expect(codesOf(realm)).toEqual(data.limit.codes);
  });

  it('types 应当按类型过滤', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      histories: [structuredClone(data.history)],
    });
    const rag = await createRag(data.documents, data.queryEmbedding);
    withCache(realm, rag);
    const tool = await createTool(realm, 'get_memory');

    const result = await tool.invoke({
      args: { content: data.query, types: data.typeFilter.value },
      controller: new AbortController(),
    });

    expect(JSON.parse(result)).toEqual(data.typeFilter.titles);
    expect(codesOf(realm)).toEqual(data.typeFilter.codes);
  });

  it('tags 应当按标签过滤', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      histories: [structuredClone(data.history)],
    });
    const rag = await createRag(data.documents, data.queryEmbedding);
    withCache(realm, rag);
    const tool = await createTool(realm, 'get_memory');

    const result = await tool.invoke({
      args: { content: data.query, tags: data.tagFilter.value },
      controller: new AbortController(),
    });

    expect(JSON.parse(result)).toEqual(data.tagFilter.titles);
    expect(codesOf(realm)).toEqual(data.tagFilter.codes);
  });

  it('已有编码时应当追加而不是覆盖', async () => {
    const data = await loadCases();
    const history = structuredClone(data.history);
    history.outputs[0][0].properties = { memory: [[99]] };
    const realm = await createRealm({ histories: [history] });
    const rag = await createRag(data.documents, data.queryEmbedding);
    withCache(realm, rag);
    const tool = await createTool(realm, 'get_memory');

    await tool.invoke({
      args: { content: data.query, limit: 1, min_relevance: 0 },
      controller: new AbortController(),
    });

    expect(codesOf(realm)).toEqual([[99], data.limit.codes[0]]);
  });
});

describe('memories tool / set_memory invoke', () => {
  it('未启用 RAG 时应当提示未开启且不落库', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      histories: structuredClone(data.histories),
    });
    withCache(realm, null);
    const tool = await createTool(realm, 'set_memory');

    const result = await tool.invoke({
      args: structuredClone(data.set.args),
      controller: new AbortController(),
    });

    expect(result).toBe(data.result.noRag);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('应当以 memories 条目类型落库并写入缓存与向量库', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      histories: structuredClone(data.histories),
    });
    const rag = await createRag([], data.queryEmbedding);
    const { cache } = withCache(realm, rag);
    mocks.post.mockResolvedValue({ entryId: data.set.entryId });
    const tool = await createTool(realm, 'set_memory');
    const args = structuredClone(data.set.args);

    const result = await tool.invoke({
      args,
      controller: new AbortController(),
    });

    const memory = {
      importance: args.importance,
      sequence: realm.histories.length,
      text: args.content,
      tags: args.tags,
      type: args.type,
    };
    expect(result).toBe(data.result.success);
    expect(rag.embed.generate).toHaveBeenCalledWith({ content: args.content });
    expect(mocks.post).toHaveBeenCalledWith(
      'stories/{id}/entries/{entryType}',
      { name: args.title, data: memory },
      // 条目类型用的是单数 name，条目列表键才是 plural
      { params: { id: realm.id, entryType: memories.name } },
    );
    expect(cache.memories[data.set.entryId]).toEqual({
      name: args.title,
      entryId: data.set.entryId,
      ...memory,
    });
  });

  it('落库后的记忆应当能在向量库里检索到', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      histories: structuredClone(data.histories),
    });
    const rag = await createRag(data.documents, data.queryEmbedding);
    withCache(realm, rag);
    mocks.post.mockResolvedValue({ entryId: data.set.entryId });
    const tool = await createTool(realm, 'set_memory');

    await tool.invoke({
      args: structuredClone(data.set.args),
      controller: new AbortController(),
    });
    const results = await search(rag.database, {
      mode: 'vector',
      vector: { value: data.queryEmbedding, property: 'embedding' },
      similarity: 0.9,
      limit: 10,
    });

    expect(results.hits.map((hit) => hit.document.title)).toContain(
      data.set.args.title,
    );
  });

  it('未提供的类型、标签与重要度应当落到默认值', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      histories: structuredClone(data.histories),
    });
    const rag = await createRag([], data.queryEmbedding);
    const { cache } = withCache(realm, rag);
    mocks.post.mockResolvedValue({ entryId: data.set.entryId });
    const tool = await createTool(realm, 'set_memory');

    await tool.invoke({
      args: structuredClone(data.set.defaults),
      controller: new AbortController(),
    });

    expect(cache.memories[data.set.entryId]).toEqual({
      name: data.set.defaults.title,
      entryId: data.set.entryId,
      text: data.set.defaults.content,
      sequence: realm.histories.length,
      type: 'event',
      tags: [],
      importance: 5,
    });
  });
});
