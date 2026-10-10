import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validate } from 'uuid';

import type { Model } from '@/models';

const mocks = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
  },
  set: vi.fn(),
  get: vi.fn(),
  exists: vi.fn(),
  query: vi.fn(),
  remove: vi.fn(),
}));

/**
 * 只替换到 drizzle 的表达式构造这一层：
 * 表达式变成可读的标记对象，方便断言查询条件。
 */
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mark =
    (key: string) =>
    (...args: unknown[]) => ({ [key]: args });
  return {
    ...actual,
    eq: mark('eq'),
    and: mark('and'),
    or: mark('or'),
    like: mark('like'),
    asc: mark('asc'),
    desc: mark('desc'),
  };
});

// 避免真实打开 sqlite 文件
vi.mock('@/database/server/provider', () => ({
  dbProvider: {
    client: {},
    db: {},
    migrate: vi.fn(),
    url: 'file::memory:',
    migrationsFolder: '',
  },
}));

vi.mock('@/database/server', () => ({
  databases: {
    db: {
      insert: (...args: unknown[]) => {
        mocks.db.insert(...args);
        return { values: async () => {} };
      },
      update: (...args: unknown[]) => {
        mocks.db.update(...args);
        return {
          set: (payload: unknown) => {
            mocks.set(payload);
            return { where: async () => {} };
          },
        };
      },
    },
    get: mocks.get,
    exists: mocks.exists,
    query: mocks.query,
    delete: mocks.remove,
  },
}));

import { repository } from '@/models/server/repository';
import { modelSchema } from '@/models/server/schema';
import { cache, hasher } from '@/utils/server';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./repository.cases.json')).default);
}

async function loadModel(): Promise<Model> {
  return structuredClone(
    (await import('../model.json')).default,
  ) as unknown as Model;
}

const cacheKey = (id: string) => `model_${id}`;

beforeEach(async () => {
  vi.clearAllMocks();
  const model = await loadModel();
  await cache.delete(cacheKey(model.id));
});

describe('models repository / get', () => {
  it('查不到时应当抛实体不存在', async () => {
    const model = await loadModel();
    mocks.get.mockResolvedValue(undefined);

    await expect(repository.get(model.id)).rejects.toThrow('entity not found');
  });

  it('命中缓存时不应重复查库', async () => {
    const model = await loadModel();
    mocks.get.mockResolvedValue(model);

    await repository.get(model.id);
    await repository.get(model.id);

    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith(modelSchema, model.id);
  });

  it('清掉缓存后应当重新查库', async () => {
    const model = await loadModel();
    mocks.get.mockResolvedValue(model);

    await repository.get(model.id);
    await cache.delete(cacheKey(model.id));
    await repository.get(model.id);

    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
});

describe('models repository / create', () => {
  it('合法 uuid 应当保留，非法 id 应当重新生成', async () => {
    const data = await loadCases();

    const kept = structuredClone(data.create.simple) as Model;
    await expect(repository.create(kept)).resolves.toBe(kept.id);

    const replaced = { ...structuredClone(data.create.simple) } as Model;
    replaced.id = data.create.invalidId;
    const id = await repository.create(replaced);

    expect(id).not.toBe(data.create.invalidId);
    expect(validate(id)).toBe(true);
  });

  it('名称为空时应当直接报错', async () => {
    const data = await loadCases();

    await expect(
      repository.create(data.create.noName as unknown as Model),
    ).rejects.toThrow(/No name provided/);
    await expect(
      repository.create(data.create.blankName as unknown as Model),
    ).rejects.toThrow(/No name provided/);
  });

  it('应当按 schema 插入并返回 id', async () => {
    const data = await loadCases();
    const model = structuredClone(data.create.simple) as Model;

    await expect(repository.create(model)).resolves.toBe(model.id);

    expect(mocks.db.insert).toHaveBeenCalledWith(modelSchema);
  });
});

describe('models repository / update', () => {
  it('名称显式为空白时应当报错', async () => {
    const data = await loadCases();
    const model = await loadModel();

    await expect(
      repository.update(model.id, data.update.blankName),
    ).rejects.toThrow(/No name provided/);
  });

  it('应当先清缓存再写库，并清掉请求体里的主键', async () => {
    const data = await loadCases();
    const model = await loadModel();
    mocks.get.mockResolvedValue(model);
    await repository.get(model.id);

    const payload = structuredClone(data.update.withId) as Partial<Model>;
    await repository.update(model.id, payload);

    expect(mocks.db.update).toHaveBeenCalledWith(modelSchema);
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ id: undefined, name: data.update.withId.name }),
    );
    // 缓存已被清掉，下一次 get 会重新查库
    mocks.get.mockClear();
    await repository.get(model.id);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('带明文 key 时应当加密并写入 iv', async () => {
    const data = await loadCases();
    const model = await loadModel();
    const payload: Partial<Model> = { key: data.update.plainKey };

    await repository.update(model.id, payload);

    expect(payload.key).not.toBe(data.update.plainKey);
    expect(payload.iv).toBeInstanceOf(Buffer);
    expect((payload.iv as Buffer).length).toBe(16);
    expect(hasher.decrypt(payload.key!, payload.iv!)).toBe(data.update.plainKey);
  });

  it('不带 key 时不应生成 iv', async () => {
    const data = await loadCases();
    const model = await loadModel();
    const payload = structuredClone(data.update.noKey) as Partial<Model>;

    await repository.update(model.id, payload);

    expect(payload.key).toBeUndefined();
    expect(payload.iv).toBeUndefined();
  });
});

describe('models repository / delete 与 exist', () => {
  it('delete 应当同时清缓存与删库', async () => {
    const model = await loadModel();
    mocks.get.mockResolvedValue(model);
    await repository.get(model.id);

    await repository.delete(model.id);
    expect(mocks.remove).toHaveBeenCalledWith(modelSchema, model.id);

    mocks.get.mockClear();
    await repository.get(model.id);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('exist 应当把条件交给数据库层', async () => {
    const model = await loadModel();
    const condition = (t: typeof modelSchema) => ({ eq: [t.id, model.id] }) as any;

    await repository.exist(condition);

    expect(mocks.exists).toHaveBeenCalledWith(modelSchema, condition);
  });
});

describe('models repository / list', () => {
  it('应当给出投影与排序，并把请求原样透传', async () => {
    const data = await loadCases();
    mocks.query.mockResolvedValue({ items: [], length: 0 });

    await repository.list(data.requests.paged);

    const [table, passed, filter, sorter, map] = mocks.query.mock.calls[0];
    expect(table).toBe(modelSchema);
    expect(passed).toBe(data.requests.paged);
    expect(filter(modelSchema)).toBeUndefined();
    expect(Object.keys(map(modelSchema))).toEqual(data.list.mapKeys);
    expect(sorter(modelSchema)).toHaveLength(data.list.sorterLength);
  });

  it('fuzzy 应当按名称模糊匹配', async () => {
    const data = await loadCases();
    mocks.query.mockResolvedValue({ items: [], length: 0 });

    await repository.list(data.requests.fuzzy);

    const condition = mocks.query.mock.calls[0][2](modelSchema);
    expect(condition.and).toHaveLength(1);
    expect(condition.and[0].like[1]).toBe(
      `%${data.requests.fuzzy.search.fuzzy}%`,
    );
  });
});
