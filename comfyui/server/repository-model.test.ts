import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validate } from 'uuid';

import type { ComfyUIModel } from '@/comfyui';

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
    inArray: mark('inArray'),
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

import { modelRepository } from '@/comfyui/server/repository-model';
import { comfyuiModelSchema } from '@/comfyui/server/schema';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./repository-model.cases.json')).default);
}

async function createModel(
  overrides: Partial<ComfyUIModel> = {},
): Promise<ComfyUIModel> {
  const data = await loadCases();
  return { ...data.model, ...overrides } as ComfyUIModel;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('comfyui model repository / get', () => {
  it('查不到时应当抛实体不存在', async () => {
    const model = await createModel();
    mocks.get.mockResolvedValue(undefined);

    await expect(modelRepository.get(model.id)).rejects.toThrow(
      'entity not found',
    );
    expect(mocks.get).toHaveBeenCalledWith(comfyuiModelSchema, model.id);
  });

  it('查到后应当原样返回，每次 get 都交给数据库层', async () => {
    const model = await createModel();
    mocks.get.mockResolvedValue(model);

    await expect(modelRepository.get(model.id)).resolves.toEqual(model);
    await modelRepository.get(model.id);

    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.get).toHaveBeenCalledWith(comfyuiModelSchema, model.id);
  });
});

describe('comfyui model repository / create', () => {
  it('合法 uuid 应当保留，缺失 id 应当重新生成', async () => {
    const data = await loadCases();

    const kept = structuredClone(data.create.simple) as ComfyUIModel;
    await expect(modelRepository.create(kept)).resolves.toBe(kept.id);

    const generated = structuredClone(data.create.simple) as ComfyUIModel;
    generated.id = undefined!;
    const id = await modelRepository.create(generated);

    expect(id).not.toBe(data.create.simple.id);
    expect(validate(id)).toBe(true);
    expect(generated.id).toBe(id);
  });

  it('名称为空时应当直接报错', async () => {
    const data = await loadCases();

    await expect(
      modelRepository.create(data.create.noName as unknown as ComfyUIModel),
    ).rejects.toThrow(/No name provided/);
    await expect(
      modelRepository.create(data.create.blankName as unknown as ComfyUIModel),
    ).rejects.toThrow(/No name provided/);
  });

  it('编码为空时应当直接报错', async () => {
    const data = await loadCases();

    await expect(
      modelRepository.create(data.create.noCode as unknown as ComfyUIModel),
    ).rejects.toThrow(/No code provided/);
    await expect(
      modelRepository.create(data.create.blankCode as unknown as ComfyUIModel),
    ).rejects.toThrow(/No code provided/);
  });

  it('应当按 schema 插入并返回 id', async () => {
    const data = await loadCases();
    const model = structuredClone(data.create.simple) as ComfyUIModel;

    await expect(modelRepository.create(model)).resolves.toBe(model.id);

    expect(mocks.db.insert).toHaveBeenCalledWith(comfyuiModelSchema);
  });
});

describe('comfyui model repository / update', () => {
  it('名称显式为空白时应当报错', async () => {
    const data = await loadCases();
    const model = await createModel();

    await expect(
      modelRepository.update(model.id, data.update.blankName),
    ).rejects.toThrow(/No name provided/);
  });

  it('应当清掉请求体里的主键，并按 id 定位更新', async () => {
    const data = await loadCases();
    const model = await createModel();

    const payload = structuredClone(data.update.withId) as Partial<ComfyUIModel>;
    await modelRepository.update(model.id, payload);

    expect(mocks.db.update).toHaveBeenCalledWith(comfyuiModelSchema);
    expect(mocks.set).toHaveBeenCalledWith({
      ...payload,
      id: undefined,
    });
  });
});

describe('comfyui model repository / delete 与 exist', () => {
  it('delete 应当把表与 id 交给数据库层', async () => {
    const model = await createModel();

    await modelRepository.delete(model.id);

    expect(mocks.remove).toHaveBeenCalledWith(comfyuiModelSchema, model.id);
  });

  it('exist 应当把条件交给数据库层', async () => {
    const model = await createModel();
    const condition = ((t: typeof comfyuiModelSchema) => ({
      eq: [t.id, model.id],
    })) as any;

    await modelRepository.exist(condition);

    expect(mocks.exists).toHaveBeenCalledWith(comfyuiModelSchema, condition);
  });
});

describe('comfyui model repository / list', () => {
  it('应当按名称升序、只投影 id 与 path，并把请求原样透传', async () => {
    const data = await loadCases();
    mocks.query.mockResolvedValue({ items: [], length: 0 });

    await modelRepository.list(data.requests.paged);

    const [table, passed, filter, sorter, map] = mocks.query.mock.calls[0];
    expect(table).toBe(comfyuiModelSchema);
    expect(passed).toBe(data.requests.paged);
    expect(filter(comfyuiModelSchema)).toBeUndefined();
    expect(Object.keys(map(comfyuiModelSchema))).toEqual(data.list.mapKeys);
    expect(sorter(comfyuiModelSchema)).toBe(comfyuiModelSchema.name);
  });

  it('fuzzy 应当按名称模糊匹配', async () => {
    const data = await loadCases();
    mocks.query.mockResolvedValue({ items: [], length: 0 });

    await modelRepository.list(data.requests.fuzzy);

    const condition = mocks.query.mock.calls[0][2](comfyuiModelSchema);
    expect(condition.and).toHaveLength(1);
    expect(condition.and[0].like[1]).toBe(
      `%${data.requests.fuzzy.search.fuzzy}%`,
    );
  });

  it('types 应当按类型集合过滤', async () => {
    const data = await loadCases();
    mocks.query.mockResolvedValue({ items: [], length: 0 });

    await modelRepository.list(data.requests.types);

    const condition = mocks.query.mock.calls[0][2](comfyuiModelSchema);
    expect(condition.and).toHaveLength(1);
    expect(condition.and[0].inArray).toEqual([
      comfyuiModelSchema.type,
      data.requests.types.search.types,
    ]);
  });

  it('fuzzy 与 types 同时存在时两个条件都应当带上', async () => {
    const data = await loadCases();
    mocks.query.mockResolvedValue({ items: [], length: 0 });

    await modelRepository.list(data.requests.fuzzyAndTypes);

    const condition = mocks.query.mock.calls[0][2](comfyuiModelSchema);
    expect(condition.and).toHaveLength(2);
    expect(condition.and[0].like[1]).toBe(
      `%${data.requests.fuzzyAndTypes.search.fuzzy}%`,
    );
    expect(condition.and[1].inArray[1]).toEqual(
      data.requests.fuzzyAndTypes.search.types,
    );
  });
});
