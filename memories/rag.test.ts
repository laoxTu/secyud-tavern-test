import { insert, search } from '@orama/orama';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rags, useRagState } from '@/memories/client/rag';
import { getRegistry } from '@/plugins';

// 持久化会走设置接口，这里整体替换掉，避免用例里出现真实请求
vi.mock('@/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));

/**
 * jsdom 没有 indexedDB。这里不引依赖，直接把 idb 的 openDB 换成一个最小内存实现，
 * 只覆盖 rag.cache 用到的 get / put / count / transaction(store.index.openCursor)。
 */
const idb = vi.hoisted(() => {
  /** 键是 fnv1a64Bytes 产出的 ArrayBuffer，Map 里统一转成十六进制串 */
  const keyOf = (key: any) =>
    Buffer.from(new Uint8Array(key as ArrayBuffer)).toString('hex');

  const items = new Map<string, any>();
  const connections: any[] = [];
  /** openDB 的参数单独记一份：afterEach 的 restoreAllMocks 会清掉 mock 的调用记录 */
  const opened: { name: string; version: number; options: any }[] = [];

  const openDB = vi.fn(async (name: string, version: number, options: any) => {
    opened.push({ name, version, options });
    const db: any = {
      close: vi.fn(),
      get: vi.fn(async (_store: string, key: any) => items.get(keyOf(key))),
      put: vi.fn(async (_store: string, value: any, key: any) => {
        items.set(keyOf(key), value);
      }),
      count: vi.fn(async () => items.size),
      transaction: vi.fn(() => {
        let entries: [string, any][] = [];
        let index = 0;
        const next = (): any => {
          if (index >= entries.length) return null;
          const [key, value] = entries[index];
          return {
            value,
            delete: () => items.delete(key),
            continue: async () => {
              index += 1;
              return next();
            },
          };
        };
        const openCursor = vi.fn(async () => {
          // 升序，最旧在前
          entries = [...items.entries()].sort(
            (a, b) => (a[1].time ?? 0) - (b[1].time ?? 0),
          );
          index = 0;
          return next();
        });
        return {
          store: { index: vi.fn(() => ({ openCursor })) },
          done: Promise.resolve(),
        };
      }),
    };
    connections.push(db);
    return db;
  });

  return { keyOf, items, openDB, connections, opened };
});

vi.mock('idb', () => ({ openDB: idb.openDB }));

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./rag.cases.json')).default);
}

/** 注册一个只关心维度的假 embedder */
function registerFake(id: string, dimension: number) {
  const generate = vi.fn(async () =>
    Array.from({ length: dimension }, (_, i) => (i === 0 ? 1 : 0)),
  );
  const value = { dimension, generate };
  const embed = vi.fn(async () => value);
  rags.registry.register({
    id,
    component: (() => null) as any,
    configure: () => ({}),
    embed,
  } as any);
  return { embed, generate, value };
}

/** 走一遍缓存，返回结果与工厂的调用记录 */
async function cacheWith(input: string, model: string, vector: number[]) {
  const factory = vi.fn(async () => Float32Array.from(vector));
  const item = await rags.cache(input, model, factory);
  return { item, factory };
}

beforeEach(() => {
  idb.items.clear();
  // openDB 的调用记录不清：vectorDb 是模块级缓存，全文件只会打开一次连接
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  useRagState.setState({
    embedder: { type: 'transformers', config: {} },
    disabled: false,
    cacheLimit: 200000,
  });
});

afterEach(() => {
  vi.useRealTimers();
  rags.registry.unregister('fake');
  rags.registry.unregister('other');
  vi.restoreAllMocks();
  useRagState.setState({
    embedder: { type: 'transformers', config: {} },
    disabled: false,
    cacheLimit: 200000,
  });
});

describe('rags / 模块常量', () => {
  it('name 与默认 embedder 应当与约定一致', async () => {
    const data = await loadCases();

    expect(rags.name).toBe(data.moduleInfo.name);
    expect(rags.default).toEqual(data.moduleInfo.defaultEmbedder);
  });

  it('registry 应当是全局单例的 embedder 注册表', () => {
    expect(rags.registry).toBe(getRegistry('embedder'));
  });
});

describe('useRagState / 默认值', () => {
  it('默认条数、相似度、缓存上限与禁用位应当与约定一致', async () => {
    const data = await loadCases();
    const { embedder, ...rest } = useRagState.getState();

    expect(embedder).toEqual({ type: 'transformers', config: {} });
    expect(rest.limit).toBe(data.state.limit);
    expect(rest.similarity).toBe(data.state.similarity);
    expect(rest.cacheLimit).toBe(data.state.cacheLimit);
    expect(rest.disabled).toBe(data.state.disabled);
  });
});

describe('rags / create', () => {
  it('disabled 时即使注册了 embedder 也应当返回 null', async () => {
    const data = await loadCases();
    const fake = registerFake('fake', data.dimension);
    useRagState.setState({
      embedder: { type: 'fake', config: {} },
      disabled: true,
    });

    await expect(rags.create(data.schema)).resolves.toBeNull();
    expect(fake.embed).not.toHaveBeenCalled();
  });

  it('未注册 embedder 时应当返回 null', async () => {
    const data = await loadCases();
    useRagState.setState({
      embedder: { type: 'missing', config: {} },
      disabled: false,
    });

    await expect(rags.create(data.schema)).resolves.toBeNull();
  });

  it('正常时应当返回同一份 embed 与建好的向量库', async () => {
    const data = await loadCases();
    const fake = registerFake('fake', data.dimension);
    useRagState.setState({ embedder: { type: 'fake', config: {} } });

    const rag = await rags.create(data.schema);

    expect(fake.embed).toHaveBeenCalledTimes(1);
    expect(rag!.embed).toBe(fake.value);
    expect(rag!.database).toBeTruthy();
  });

  it('schema 应当保留业务字段并把 embedding 声明为 embedder 的维度', async () => {
    const data = await loadCases();
    registerFake('fake', data.dimension);
    useRagState.setState({ embedder: { type: 'fake', config: {} } });

    const rag = await rags.create(data.schema);
    const schema = (rag!.database as any).schema;

    for (const [key, type] of Object.entries(data.schema)) {
      expect(schema[key]).toBe(type);
    }
    expect(Object.keys(schema).sort()).toEqual(
      [...Object.keys(data.schema), 'embedding'].sort(),
    );
    expect(schema.embedding).toBe(`vector[${data.dimension}]`);
  });

  it('vector 维度应当跟随 embedder 的 dimension', async () => {
    const data = await loadCases();
    registerFake('other', data.otherDimension);
    useRagState.setState({ embedder: { type: 'other', config: {} } });

    const rag = await rags.create(data.schema);

    expect((rag!.database as any).schema.embedding).toBe(
      `vector[${data.otherDimension}]`,
    );
  });

  it('建好的库应当能插入并按向量检索', async () => {
    const data = await loadCases();
    registerFake('fake', data.dimension);
    useRagState.setState({ embedder: { type: 'fake', config: {} } });
    const rag = await rags.create(data.schema);

    await insert(rag!.database as any, {
      entryId: 1,
      title: '初遇',
      tags: ['主角'],
      type: 'event',
      importance: 8,
      sequence: 100,
      embedding: data.vectors.first,
    } as any);
    const results = await search(rag!.database, {
      mode: 'vector',
      vector: { value: data.vectors.first, property: 'embedding' },
      similarity: 0.9,
      limit: 5,
    });

    expect(results.hits).toHaveLength(1);
    expect(results.hits[0].document).toEqual(
      expect.objectContaining({
        entryId: 1,
        title: '初遇',
        tags: ['主角'],
        type: 'event',
        importance: 8,
        sequence: 100,
      }),
    );
  });
});

describe('rags / cache 命中与失效', () => {
  it('首次调用应当打开向量缓存并调用 factory 写入', async () => {
    const data = await loadCases();
    const before = Date.now();
    const { item, factory } = await cacheWith(
      data.inputs.first,
      'all-MiniLM-L6-v2',
      data.vectors.first,
    );

    expect(factory).toHaveBeenCalledTimes(1);
    expect(item.model).toBe('all-MiniLM-L6-v2');
    expect([...item.vector]).toEqual(data.vectors.first);
    expect(item.time).toBeGreaterThanOrEqual(before);
    expect(idb.items.size).toBe(1);
  });

  it('同一输入同一 model 应当直接命中缓存', async () => {
    const data = await loadCases();
    const { item: first, factory } = await cacheWith(
      data.inputs.first,
      'all-MiniLM-L6-v2',
      data.vectors.first,
    );

    const second = await rags.cache(
      data.inputs.first,
      'all-MiniLM-L6-v2',
      factory,
    );

    expect(factory).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(idb.items.size).toBe(1);
  });

  it('model 变化时应当重新计算向量', async () => {
    const data = await loadCases();
    const { factory } = await cacheWith(
      data.inputs.first,
      'all-MiniLM-L6-v2',
      data.vectors.first,
    );

    const second = await rags.cache(
      data.inputs.first,
      'bge-small-zh-v1.5',
      async () => Float32Array.from(data.vectors.second),
    );

    expect(factory).toHaveBeenCalledTimes(1);
    expect(second.model).toBe('bge-small-zh-v1.5');
    expect([...second.vector]).toEqual(data.vectors.second);
  });

  it('不同输入应当分别缓存', async () => {
    const data = await loadCases();
    await cacheWith(data.inputs.first, 'm', data.vectors.first);
    await cacheWith(data.inputs.second, 'm', data.vectors.second);

    expect(idb.items.size).toBe(2);
  });

  it('命中缓存时也应当刷新时间戳', async () => {
    const data = await loadCases();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const { item } = await cacheWith(
      data.inputs.first,
      'all-MiniLM-L6-v2',
      data.vectors.first,
    );
    // 缓存项是同一个对象引用，第二次调用会就地改写，先取下来
    const firstTime = item.time;

    vi.setSystemTime(new Date('2024-01-01T00:00:10.000Z'));
    const second = await rags.cache(
      data.inputs.first,
      'all-MiniLM-L6-v2',
      async () => Float32Array.from(data.vectors.second),
    );

    expect(firstTime).toBe(Date.parse('2024-01-01T00:00:00.000Z'));
    expect(second.time).toBe(Date.parse('2024-01-01T00:00:10.000Z'));
  });

  it('超过 cacheLimit 时应当清理旧条目', async () => {
    const data = await loadCases();
    useRagState.setState({ cacheLimit: 2 });

    await cacheWith(data.inputs.first, 'm', data.vectors.first);
    await cacheWith(data.inputs.second, 'm', data.vectors.second);
    const last = await cacheWith(data.inputs.third, 'm', data.vectors.first);

    expect(last.factory).toHaveBeenCalledTimes(1);
    expect(idb.items.size).toBeLessThanOrEqual(2);
  });
});

describe('rags / 向量库连接', () => {
  it('应当打开 VectorCache 并建好 time 索引', async () => {
    const data = await loadCases();
    await cacheWith(data.inputs.first, 'm', data.vectors.first);

    expect(idb.opened.at(-1)!.name).toBe('VectorCache');
    expect(idb.opened.at(-1)!.version).toBe(1);

    const { upgrade } = idb.opened.at(-1)!.options;
    const store = { createIndex: vi.fn() };
    const fake = {
      objectStoreNames: { contains: vi.fn(() => false) },
      createObjectStore: vi.fn(() => store),
      deleteObjectStore: vi.fn(),
    };

    await upgrade(fake);

    expect(fake.deleteObjectStore).not.toHaveBeenCalled();
    expect(fake.createObjectStore).toHaveBeenCalledWith('vectors');
    expect(store.createIndex).toHaveBeenCalledWith('i_time', 'time');
  });

  it('已存在 vectors 存储时应当先删除再重建', async () => {
    const data = await loadCases();
    await cacheWith(data.inputs.first, 'm', data.vectors.first);

    const { upgrade } = idb.opened.at(-1)!.options;
    const store = { createIndex: vi.fn() };
    const fake = {
      objectStoreNames: { contains: vi.fn(() => true) },
      createObjectStore: vi.fn(() => store),
      deleteObjectStore: vi.fn(),
    };

    await upgrade(fake);

    expect(fake.deleteObjectStore).toHaveBeenCalledWith('vectors');
    expect(fake.createObjectStore).toHaveBeenCalledWith('vectors');
  });

  it('blocking 时应当关闭连接，下次调用重新打开', async () => {
    const data = await loadCases();
    await cacheWith(data.inputs.first, 'm', data.vectors.first);
    const opened = idb.opened.length;
    const current = idb.connections.at(-1)!;

    await idb.opened.at(-1)!.options.blocking();

    expect(current.close).toHaveBeenCalledTimes(1);

    await rags.cache(data.inputs.first, 'm', async () =>
      Float32Array.from(data.vectors.second),
    );

    expect(idb.opened.length).toBe(opened + 1);
  });
});
