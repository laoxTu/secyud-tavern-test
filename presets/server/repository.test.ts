import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Preset, PresetEntry } from '@/presets';

const mocks = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
  },
  get: vi.fn(),
  exists: vi.fn(),
  query: vi.fn(),
  remove: vi.fn(),
  entryRepo: {
    types: vi.fn(),
    list: vi.fn(),
    make: vi.fn(),
  },
  manager: {
    load: vi.fn(),
    save: vi.fn(),
    criteria: vi.fn(),
  },
  rows: new Map<string, Preset>(),
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

vi.mock('@/database/server', () => ({
  databases: {
    db: {
      insert: (...args: unknown[]) => {
        mocks.db.insert(...args);
        return { values: async () => {} };
      },
      update: (...args: unknown[]) => {
        mocks.db.update(...args);
        return { set: () => ({ where: async () => {} }) };
      },
      // traversal 用 db.select().from().where().get()
      select: () => {
        let id: string | undefined;
        const chain = {
          from: () => chain,
          where: (condition: any) => {
            id = condition?.eq?.[1];
            return chain;
          },
          get: async () => (id ? mocks.rows.get(id) : undefined),
        };
        return chain;
      },
    },
    get: mocks.get,
    exists: mocks.exists,
    query: mocks.query,
    delete: mocks.remove,
  },
}));

// 保留 schema 构造器（json/schemas/...）真实实现，只替换仓库与存储管理器
vi.mock('@/database/server/factory', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    repositories: { entry: () => mocks.entryRepo },
    storages: { createManager: () => mocks.manager },
  };
});

import { repository } from '@/presets/server/repository';
import { presetSchema } from '@/presets/server/schema';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./repository.cases.json')).default);
}

/** 把场景里的预设灌进假 db，并返回场景本身 */
async function seed(scenario: keyof Awaited<ReturnType<typeof loadCases>>['scenarios']) {
  const data = await loadCases();
  const item = data.scenarios[scenario];
  mocks.rows.clear();
  for (const preset of item.presets) {
    mocks.rows.set(preset.id, preset as unknown as Preset);
  }
  return item as unknown as { codes: string[]; presets: Preset[] };
}

const ids = (list: { id: string }[]) => list.map((u) => u.id);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.clear();
  mocks.query.mockResolvedValue({ items: [], length: 0 });
});

describe('presets repository / traversal', () => {
  it('应当先访问依赖方，返回顺序为依赖在前', async () => {
    const scenario = await seed('chain');
    const action = vi.fn();

    const result = await repository.traversal({ action }, scenario.codes);

    expect(ids(result)).toEqual(ids(scenario.presets).reverse());
    expect(action.mock.calls.map((u) => u[0].id)).toEqual(ids(scenario.presets));
  });

  it('重复依赖与环都应当只访问一次', async () => {
    const scenario = await seed('duplicate');

    const result = await repository.traversal({}, scenario.codes);

    expect(ids(result).sort()).toEqual(ids(scenario.presets).sort());
  });

  it('依赖不存在时应当跳过', async () => {
    const scenario = await seed('ghost');

    const result = await repository.traversal({}, scenario.codes);

    expect(ids(result)).toEqual(ids(scenario.presets));
  });

  it('entities 选项应当触发存储层加载', async () => {
    const scenario = await seed('single');

    await repository.traversal({}, scenario.codes, { entities: true });

    expect(mocks.manager.load).toHaveBeenCalledTimes(1);
  });

  it('types 选项应当把类型集合写到 properties 上', async () => {
    const data = await loadCases();
    const scenario = await seed('single');
    mocks.entryRepo.types.mockResolvedValue(data.types);

    const [preset] = await repository.traversal({}, scenario.codes, {
      types: true,
    });

    expect(mocks.entryRepo.types).toHaveBeenCalledWith(scenario.presets[0].id);
    expect(preset.properties?.types).toEqual(data.types);
  });

  it('空 code 应当被忽略', async () => {
    const data = await loadCases();

    const result = await repository.traversal({}, data.emptyCodes);

    expect(result).toEqual([]);
  });
});

describe('presets repository / list', () => {
  it('应当把请求原样交给查询层，并给出投影与排序', async () => {
    const data = await loadCases();

    await repository.list(data.requests.paged);

    const [table, passed, filter, sorter, map] = mocks.query.mock.calls[0];
    expect(table).toBe(presetSchema);
    expect(passed).toBe(data.requests.paged);
    expect(filter(presetSchema)).toBeUndefined();
    expect(Object.keys(map(presetSchema))).toEqual([
      'id',
      'name',
      'cover',
      'version',
    ]);
    expect(sorter(presetSchema)).toHaveLength(2);
  });

  it('fuzzy 应当同时匹配名称与 id', async () => {
    const data = await loadCases();

    await repository.list(data.requests.fuzzy);

    const filter = mocks.query.mock.calls[0][2];
    const condition = filter(presetSchema);

    expect(condition.and).toHaveLength(2);
    expect(condition.and[0].like[1]).toBe(`%${data.requests.fuzzy.search.fuzzy}%`);
    expect(condition.and[1].like[1]).toBe(`%${data.requests.fuzzy.search.fuzzy}%`);
  });

  it('tags 应当以 or 连接多个模糊匹配', async () => {
    const data = await loadCases();
    const [first, second] = data.requests.tags.search.tags;

    await repository.list(data.requests.tags);

    const filter = mocks.query.mock.calls[0][2];
    const condition = filter(presetSchema);

    expect(condition.and).toHaveLength(1);
    expect(condition.and[0].or).toHaveLength(2);
    expect(condition.and[0].or[0].like[1]).toBe(`%${first}%`);
    expect(condition.and[0].or[1].like[1]).toBe(`%${second}%`);
  });
});

describe('presets repository / create 与 update', () => {
  it('缺少 id 或名称时应当直接报错', async () => {
    const data = await loadCases();

    await expect(
      repository.create(data.create.noId as unknown as Preset),
    ).rejects.toThrow(/No id provided/);
    await expect(
      repository.create(data.create.noName as unknown as Preset),
    ).rejects.toThrow(/No name provided/);
  });

  it('id 已存在时应当报重复', async () => {
    const data = await loadCases();
    mocks.exists.mockResolvedValue(true);

    await expect(
      repository.create(data.create.duplicate as unknown as Preset),
    ).rejects.toThrow(
      `preset.id with id ${data.create.duplicate.id} already exist`,
    );
  });

  it('应当插入预设，并在有 entries 时同步存储层', async () => {
    const data = await loadCases();
    mocks.exists.mockResolvedValue(false);
    const preset = data.create.withEntries as unknown as Preset;

    await expect(repository.create(preset)).resolves.toBe(preset.id);
    expect(mocks.db.insert).toHaveBeenCalledWith(presetSchema);
    expect(mocks.manager.save).toHaveBeenCalledWith(preset);
  });

  it('没有 entries 时不应当触发存储层', async () => {
    const data = await loadCases();
    mocks.exists.mockResolvedValue(false);

    await repository.create({ ...data.create.withEntries, entries: undefined } as unknown as Preset);

    expect(mocks.manager.save).not.toHaveBeenCalled();
  });

  it('update 改名时应当校验名称，id 变化时校验重复', async () => {
    const data = await loadCases();
    const scenario = await seed('single');
    const [preset] = scenario.presets;

    await expect(
      repository.update(preset.id, data.create.blankName),
    ).rejects.toThrow(/No name provided/);

    mocks.exists.mockResolvedValue(true);
    await expect(repository.update(preset.id, data.create.renamed)).rejects.toThrow(
      `preset.id with id ${data.create.renamed.id} already exist`,
    );
  });

  it('update 应当写库并返回生效 id', async () => {
    const data = await loadCases();
    const scenario = await seed('single');
    const [preset] = scenario.presets;

    const result = await repository.update(preset.id, {
      name: data.create.renamed.name,
    });

    expect(mocks.db.update).toHaveBeenCalledWith(presetSchema);
    expect(result).toBe(preset.id);
  });
});

describe('presets repository / get 与委托', () => {
  it('找不到预设时应当抛实体不存在', async () => {
    const scenario = await seed('single');
    mocks.get.mockResolvedValue(undefined);

    await expect(repository.get(scenario.presets[0].id)).rejects.toThrow(
      'entity not found',
    );
  });

  it('get 应当按选项填充实体与类型', async () => {
    const data = await loadCases();
    const scenario = await seed('single');
    const [preset] = scenario.presets;
    mocks.get.mockResolvedValue(preset);
    mocks.entryRepo.types.mockResolvedValue(data.types);

    const result = await repository.get(preset.id, {
      entities: true,
      types: true,
    });

    expect(mocks.manager.load).toHaveBeenCalledWith(result);
    expect(result.properties?.types).toEqual(data.types);
  });

  it('delete 与 exist 应当委托给数据库层', async () => {
    const scenario = await seed('single');
    const [preset] = scenario.presets;

    await repository.delete(preset.id);
    await repository.exist(() => undefined as any);

    expect(mocks.remove).toHaveBeenCalledWith(presetSchema, preset.id);
    expect(mocks.exists).toHaveBeenCalled();
  });

  it('entry 应当使用 factory 生成的条目仓库', () => {
    expect(repository.entry).toBe(mocks.entryRepo);
  });

  it('条目仓库的 list 应当由调用方直接透传', async () => {
    const data = await loadCases();
    const params = { search: { entryType: data.entry.entryType } };
    mocks.entryRepo.list.mockResolvedValue({ items: [], length: 0 });

    await repository.entry.list(data.entry.masterId, params);

    expect(mocks.entryRepo.list).toHaveBeenCalledWith(
      data.entry.masterId,
      params,
    );
  });
});

describe('presets repository / 条目形状', () => {
  it('条目数据应当由 factory 负责展开成 data + disabled + name', async () => {
    const data = await loadCases();
    const entry = data.entry as unknown as PresetEntry;

    expect(entry.masterId).toBe(data.entry.masterId);
    expect(entry.entryType).toBe(data.entry.entryType);
  });
});
