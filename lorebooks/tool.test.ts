import { create as createDatabase, insert } from '@orama/orama';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lorebooks } from '@/lorebooks/client';
import { useRagState } from '@/memories/client/rag';
import type { Realm } from '@/stories';
import type { ToolItem } from '@/tools/client';

// 持久化会走设置接口，这里整体替换掉，避免用例里出现真实请求
vi.mock('@/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./tool.cases.json')).default);
}

async function createRealm(overrides: Record<string, any> = {}): Promise<Realm> {
  const preset = structuredClone(
    (await import('../presets/preset.json')).default,
  );

  return {
    ...structuredClone((await import('../stories/realm.json')).default),
    properties: {},
    presets: [preset],
    ...overrides,
  } as unknown as Realm;
}

/** 造一个已经建好向量的 RAG 缓存 */
async function createRag(
  documents: { name: string; title: string; embedding: number[] }[],
  queryEmbedding: number[],
) {
  const database = createDatabase({
    schema: {
      name: 'string',
      title: 'string',
      embedding: 'vector[3]',
    },
    sort: { enabled: true },
  });
  for (const document of documents) {
    await insert(database, document as any);
  }
  return {
    embed: {
      dimension: 3,
      generate: vi.fn(async () => queryEmbedding),
    },
    database,
  };
}

/** provider.create 会把 realm 关进闭包，所以工具必须绑定在同一个 realm 上 */
async function createTool(realm: Realm): Promise<ToolItem<any>> {
  const [tool] = await lorebooks.tool.create(null as any, realm);
  return tool;
}

/** RAG 缓存挂在 realm.context 上，这里直接造好 */
function withRag(realm: Realm, rag: unknown) {
  realm.context = {
    'model.lorebook': { before: [], after: [], entries: {}, rag },
  };
  return realm;
}

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('lorebooks tool / provider', () => {
  it('应当以模块名注册，并只提供 get_lorebook', async () => {
    const data = await loadCases();
    const realm = await createRealm();

    const items = await lorebooks.tool.create(null as any, realm);

    expect(lorebooks.tool.id).toBe(lorebooks.name);
    expect(items.map((u) => u.name)).toEqual([data.toolName]);
  });

  it('参数 schema 应当只要求 content，并留出 limit 与相似度', async () => {
    const tool = await createTool(await createRealm());
    const properties = tool.parameters.properties as Record<string, any>;

    expect(tool.parameters.required).toEqual(['content']);
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(properties.limit.type).toBe('integer');
    expect(properties.limit.maximum).toBe(5);
    expect(properties.min_relevance.minimum).toBe(0);
    expect(properties.min_relevance.maximum).toBe(1);
    expect(properties.content.description).toBeTruthy();
  });

  it('limit 与相似度的默认值应当取自 RAG 设置', async () => {
    const tool = await createTool(await createRealm());
    const { limit, similarity } = useRagState.getState();
    const properties = tool.parameters.properties as Record<string, any>;

    expect(properties.limit.default).toBe(limit);
    expect(properties.min_relevance.default).toBe(similarity);
  });
});

describe('lorebooks tool / invoke', () => {
  it('没有输出消息时应当直接报错', async () => {
    const data = await loadCases();
    const realm = await createRealm();
    const tool = await createTool(realm);

    const result = await tool.invoke({
      args: { content: data.query },
      controller: new AbortController(),
    });

    expect(result).toBe(data.result.notFound);
  });

  it('未启用 RAG 时应当提示未开启', async () => {
    const data = await loadCases();
    const realm = withRag(
      await createRealm({ histories: [structuredClone(data.history)] }),
      null,
    );
    const tool = await createTool(realm);

    const result = await tool.invoke({
      args: { content: data.query },
      controller: new AbortController(),
    });

    expect(result).toBe(data.result.noRag);
  });

  it('命中时应当返回标题并把编码记到消息上', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      histories: [structuredClone(data.history)],
    });
    const rag = await createRag(data.documents, data.queryEmbedding);
    withRag(realm, rag);
    const tool = await createTool(realm);

    const result = await tool.invoke({
      args: { content: data.query },
      controller: new AbortController(),
    });

    expect(rag.embed.generate).toHaveBeenCalledWith({ content: data.query });
    expect(JSON.parse(result)).toEqual(data.expectedTitles);
    const output = realm.histories[0]!.outputs[0][0];
    expect(output.properties!.lorebook_vector).toEqual(data.expectedCodes);
  });

  it('相似度低于阈值的结果应当被过滤', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      histories: [structuredClone(data.history)],
    });
    const rag = await createRag(data.documents, data.filter.embedding);
    withRag(realm, rag);
    const tool = await createTool(realm);

    const result = await tool.invoke({
      args: {
        content: data.filter.query,
        min_relevance: data.filter.minRelevance,
      },
      controller: new AbortController(),
    });

    expect(JSON.parse(result)).toEqual(data.filter.expectedTitles);
  });

  it('limit 应当限制返回条数', async () => {
    const data = await loadCases();
    const realm = await createRealm({
      histories: [structuredClone(data.history)],
    });
    const rag = await createRag(data.documents, data.queryEmbedding);
    withRag(realm, rag);
    const tool = await createTool(realm);

    const result = await tool.invoke({
      args: { content: data.query, limit: 1, min_relevance: 0 },
      controller: new AbortController(),
    });

    expect(JSON.parse(result)).toHaveLength(1);
  });
});
