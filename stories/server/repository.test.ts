import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validate } from 'uuid';

import { models } from '@/models';
import type { RealmHistory, Story, StoryEntry } from '@/stories';

const mocks = vi.hoisted(() => {
  const calls = {
    select: [] as unknown[][],
    selectDistinct: [] as unknown[][],
    from: [] as unknown[],
    where: [] as unknown[],
    orderBy: [] as unknown[][],
    offset: [] as unknown[],
    limit: [] as unknown[],
    insert: [] as unknown[],
    values: [] as unknown[],
    update: [] as unknown[],
    set: [] as unknown[],
    updateWhere: [] as unknown[],
    delete: [] as unknown[],
    deleteWhere: [] as unknown[],
  };
  /** select 链 await 时按顺序取结果；.get() 单独取 row */
  const state = {
    queue: [] as unknown[],
    row: undefined as unknown,
  };
  const createNode = () => {
    const node: any = {
      from: (table: unknown) => {
        calls.from.push(table);
        return node;
      },
      where: (condition: unknown) => {
        calls.where.push(condition);
        return node;
      },
      orderBy: (...sorters: unknown[]) => {
        calls.orderBy.push(sorters);
        return node;
      },
      offset: (value: number) => {
        calls.offset.push(value);
        return node;
      },
      limit: (value: number) => {
        calls.limit.push(value);
        return node;
      },
      get: async () => state.row,
      then: (resolve: (value: unknown) => unknown) =>
        resolve(state.queue.shift()),
    };
    return node;
  };
  const db = {
    select: vi.fn((...args: unknown[]) => {
      calls.select.push(args);
      return createNode();
    }),
    selectDistinct: vi.fn((...args: unknown[]) => {
      calls.selectDistinct.push(args);
      return createNode();
    }),
    insert: vi.fn((table: unknown) => {
      calls.insert.push(table);
      return {
        values: async (value: unknown) => {
          calls.values.push(value);
        },
      };
    }),
    update: vi.fn((table: unknown) => {
      calls.update.push(table);
      return {
        set: (payload: unknown) => {
          calls.set.push(payload);
          return {
            where: async (condition: unknown) => {
              calls.updateWhere.push(condition);
            },
          };
        },
      };
    }),
    delete: vi.fn((table: unknown) => {
      calls.delete.push(table);
      return {
        where: async (condition: unknown) => {
          calls.deleteWhere.push(condition);
        },
      };
    }),
  };
  return {
    calls,
    state,
    db,
    get: vi.fn(),
    exists: vi.fn(),
    query: vi.fn(),
    remove: vi.fn(),
    modelGet: vi.fn(),
    settingGet: vi.fn(),
    traversal: vi.fn(),
    manager: {
      load: vi.fn(),
      save: vi.fn(),
      criteria: vi.fn(),
    },
  };
});

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

// 仓库层通过 databases 做单表读写、通过 provider 里的 db 走 factory 生成的条目仓库
vi.mock('@/database/server', () => ({
  databases: {
    db: mocks.db,
    get: mocks.get,
    exists: mocks.exists,
    query: mocks.query,
    delete: mocks.remove,
  },
}));
// 避免真实打开 sqlite 文件
vi.mock('@/database/server/provider', () => ({
  dbProvider: {
    client: {},
    db: mocks.db,
    migrate: vi.fn(),
    url: 'file::memory:',
    migrationsFolder: '',
  },
}));
// 只用真实的 models.state.setting，仓库换成假的
vi.mock('@/models/server', async () => {
  const { models: main } = await import('@/models');
  return { models: { ...main, repository: { get: mocks.modelGet } } };
});
vi.mock('@/presets/server', () => ({
  presets: { repository: { traversal: mocks.traversal } },
}));
vi.mock('@/global/server', () => ({
  settings: { repository: { get: mocks.settingGet } },
}));
// 存储管理器整体换掉，仓库层只负责在正确时机委托
vi.mock('@/stories/server/storage', () => ({
  storage: { registry: { register: vi.fn() }, manager: mocks.manager },
}));

import { repository } from '@/stories/server/repository';
import {
  realmHistorySchema,
  storyEntrySchema,
  storySchema,
} from '@/stories/server/schema';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./repository.cases.json')).default);
}

async function loadStory(): Promise<Story> {
  return structuredClone((await import('./story.json')).default) as Story;
}

const storyId = async () => (await loadStory()).id;

beforeEach(() => {
  vi.clearAllMocks();
  for (const list of Object.values(mocks.calls)) list.length = 0;
  mocks.state.queue = [];
  mocks.state.row = undefined;
  // 这几个是「按用例设置返回值」的桩，清掉上一次用例的残留实现
  mocks.get.mockReset();
  mocks.query.mockReset();
  mocks.modelGet.mockReset();
  mocks.settingGet.mockReset();
  mocks.traversal.mockReset();
  mocks.manager.criteria.mockReset();
  mocks.manager.criteria.mockImplementation((type: string, entry: any) => ({
    filter: `${type}:${entry.name}`,
    sorter: `${entry.name}`,
  }));
});

describe('stories repository / get', () => {
  it('查不到时应当抛实体不存在', async () => {
    const id = await storyId();
    mocks.get.mockResolvedValue(undefined);

    await expect(repository.get(id)).rejects.toThrow('entity not found');
    expect(mocks.get).toHaveBeenCalledWith(storySchema, id);
  });

  it('带 entities 选项时应当让存储管理器加载条目', async () => {
    const story = await loadStory();
    mocks.get.mockResolvedValue(story);

    const result = await repository.get(story.id, { entities: true });

    expect(result).toBe(story);
    expect(mocks.manager.load).toHaveBeenCalledWith(story);
  });

  it('不带选项时不应触发存储管理器', async () => {
    const story = await loadStory();
    mocks.get.mockResolvedValue(story);

    await repository.get(story.id);

    expect(mocks.manager.load).not.toHaveBeenCalled();
  });

  it('带 types 选项时应当把条目类型集合写到 properties 上', async () => {
    const data = await loadCases();
    const story = await loadStory();
    mocks.get.mockResolvedValue(story);
    mocks.state.queue = [data.entry.types.map((entryType) => ({ entryType }))];

    const result = await repository.get(story.id, { types: true });

    expect(mocks.calls.selectDistinct[0][0]).toEqual({
      entryType: storyEntrySchema.entryType,
    });
    expect(result.properties!.types).toEqual(data.entry.types);
  });
});

describe('stories repository / create', () => {
  it('缺少名称时应当直接报错', async () => {
    const data = await loadCases();

    await expect(
      repository.create(data.create.noName as unknown as Story),
    ).rejects.toThrow(/No name provided/);
    await expect(
      repository.create(data.create.blankName as unknown as Story),
    ).rejects.toThrow(/No name provided/);

    expect(mocks.calls.insert).toHaveLength(0);
  });

  it('没有 id 时应当生成 uuid 并写库', async () => {
    const story = await loadStory();
    story.id = undefined as unknown as string;

    const id = await repository.create(story);

    expect(validate(id)).toBe(true);
    expect(story.id).toBe(id);
    expect(mocks.calls.insert[0]).toBe(storySchema);
    expect(mocks.calls.values[0]).toBe(story);
  });

  it('合法 uuid 应当保留', async () => {
    const story = await loadStory();

    await expect(repository.create(story)).resolves.toBe(story.id);
  });

  it('带 entries 时应当同步写条目，不带时不动存储层', async () => {
    const story = await loadStory();
    story.entries = { images: [{ name: '头像' }] };

    await repository.create(story);
    expect(mocks.manager.save).toHaveBeenCalledWith(story);

    const plain = await loadStory();
    mocks.manager.save.mockClear();
    await repository.create(plain);
    expect(mocks.manager.save).not.toHaveBeenCalled();
  });
});

describe('stories repository / update', () => {
  it('名称为空白时应当报错', async () => {
    const data = await loadCases();

    await expect(
      repository.update(await storyId(), data.update.blankName as Partial<Story>),
    ).rejects.toThrow(/No name provided/);
    expect(mocks.calls.update).toHaveLength(0);
  });

  it('应当清掉主键、按 id 定位并返回原 id', async () => {
    const data = await loadCases();
    const id = await storyId();
    const payload = data.update.withId as Partial<Story>;

    await expect(repository.update(id, payload)).resolves.toBe(id);

    expect(mocks.calls.update[0]).toBe(storySchema);
    expect(mocks.calls.set[0]).toBe(payload);
    expect(payload.id).toBeUndefined();
    expect((mocks.calls.set[0] as Record<string, unknown>).name).toBe(
      data.update.withId.name,
    );
    expect(mocks.calls.updateWhere[0]).toEqual({
      eq: [storySchema.id, id],
    });
  });
});

describe('stories repository / delete 与 exist', () => {
  it('delete 应当委托给数据库层', async () => {
    const id = await storyId();

    await repository.delete(id);

    expect(mocks.remove).toHaveBeenCalledWith(storySchema, id);
  });

  it('exist 应当把条件原样交给数据库层', async () => {
    const condition = (() => undefined) as any;

    await repository.exist(condition);

    expect(mocks.exists).toHaveBeenCalledWith(storySchema, condition);
  });
});

describe('stories repository / list', () => {
  it('应当给出投影与排序，并把请求原样透传', async () => {
    const data = await loadCases();
    mocks.query.mockResolvedValue({ items: [], length: 0 });

    await repository.list(data.requests.paged);

    const [table, passed, filter, sorter, map] = mocks.query.mock.calls[0];
    expect(table).toBe(storySchema);
    expect(passed).toBe(data.requests.paged);
    expect(filter(storySchema)).toBeUndefined();
    expect(Object.keys(map(storySchema))).toEqual(data.list.mapKeys);
    expect(sorter(storySchema)).toBe(storySchema.name);
  });

  it('fuzzy 应当按名称模糊匹配', async () => {
    const data = await loadCases();
    mocks.query.mockResolvedValue({ items: [], length: 0 });

    await repository.list(data.requests.fuzzy);

    const condition = mocks.query.mock.calls[0][2](storySchema);
    expect(condition.and).toHaveLength(1);
    expect(condition.and[0].like[0]).toBe(storySchema.name);
    expect(condition.and[0].like[1]).toBe(
      `%${data.requests.fuzzy.search.fuzzy}%`,
    );
  });
});

describe('stories repository / getRealm', () => {
  async function setupRealm() {
    const data = await loadCases();
    const story = await loadStory();
    mocks.traversal.mockResolvedValue(data.realm.presets);
    mocks.state.queue = [[{ count: data.realm.historyCount }]];
    return { data, story };
  }

  it('没有模型时应当回落到默认设置', async () => {
    const { data, story } = await setupRealm();
    story.model = null;
    mocks.settingGet.mockResolvedValue(data.realm.setting);
    mocks.modelGet.mockResolvedValue(data.realm.model);

    const realm = await repository.getRealm(story);

    expect(mocks.settingGet).toHaveBeenCalledWith(models.state.setting);
    expect(mocks.modelGet).toHaveBeenCalledWith(
      data.realm.setting.data.model.value,
    );
    expect(realm.model).toEqual(data.realm.model);
  });

  it('已有模型时不应读取默认设置', async () => {
    const { data, story } = await setupRealm();
    mocks.modelGet.mockResolvedValue(data.realm.model);

    await repository.getRealm(story);

    expect(mocks.settingGet).not.toHaveBeenCalled();
    expect(mocks.modelGet).toHaveBeenCalledWith(story.model!.value);
  });

  it('没有模型也没有默认设置时应当报错并带上故事名', async () => {
    const story = await loadStory();
    story.model = null;
    mocks.settingGet.mockResolvedValue(undefined);

    await expect(repository.getRealm(story)).rejects.toMatchObject({
      message: 'no model or default configured',
      code: 'error.story.model_not_configured',
      data: { name: story.name },
    });
    expect(mocks.modelGet).not.toHaveBeenCalled();
  });

  it('模型不存在时应当抛实体不存在', async () => {
    const story = await loadStory();
    mocks.modelGet.mockResolvedValue(undefined);

    await expect(repository.getRealm(story)).rejects.toThrow(
      'entity not found',
    );
  });

  it('应当按历史条数准备空位，并带上预设依赖', async () => {
    const { data, story } = await setupRealm();
    mocks.modelGet.mockResolvedValue(data.realm.model);

    const realm = await repository.getRealm(story);

    expect(realm.histories).toHaveLength(data.realm.historyCount);
    expect(realm.histories.every((u) => u === null)).toBe(true);
    expect(mocks.traversal).toHaveBeenCalledWith(
      {},
      story.presets.map((u) => u.value),
      { entities: true },
    );
    expect(realm.presets).toBe(data.realm.presets);
    expect(realm.name).toBe(story.name);
    expect(mocks.calls.from[0]).toBe(realmHistorySchema);
    expect(mocks.calls.where[0]).toEqual({
      eq: [realmHistorySchema.masterId, story.id],
    });
  });
});

describe('stories repository / history', () => {
  it('get 应当按 masterId 过滤，并用 offset 当索引', async () => {
    const data = await loadCases();
    const id = await storyId();
    mocks.state.queue = [[data.history.row]];

    const result = await repository.history.get(id, data.history.index);

    expect(mocks.calls.from[0]).toBe(realmHistorySchema);
    expect(mocks.calls.where[0]).toEqual({
      eq: [realmHistorySchema.masterId, id],
    });
    expect(mocks.calls.offset).toEqual([data.history.index]);
    expect(mocks.calls.limit).toEqual([1]);
    expect(result).toEqual(data.history.row);
  });

  it('add 应当按 max(sequence) + 1 分配序号', async () => {
    const data = await loadCases();
    const id = await storyId();
    const history = structuredClone(
      data.history.newHistory,
    ) as unknown as RealmHistory;
    mocks.state.queue = [[{ sequence: data.history.maxSequence }]];

    const sequence = await repository.history.add(id, history);

    expect(sequence).toBe(data.history.maxSequence + 1);
    expect(mocks.calls.values[0]).toBe(history);
    expect(history.masterId).toBe(id);
    expect(history.sequence).toBe(sequence);
  });

  it('没有历史（max 为 null）时序号应当从 0 开始', async () => {
    const data = await loadCases();
    const id = await storyId();
    mocks.state.queue = [[{ sequence: null }]];

    const sequence = await repository.history.add(
      id,
      structuredClone(data.history.newHistory) as unknown as RealmHistory,
    );

    expect(sequence).toBe(0);
    expect(mocks.calls.values[0]).toMatchObject({ sequence: 0 });
  });

  it('set 应当清掉两个主键列并按主键定位', async () => {
    const data = await loadCases();
    const id = await storyId();
    const payload: Partial<RealmHistory> = {
      masterId: 'another-story',
      sequence: 99,
      summary: true,
    };

    await repository.history.set(id, data.history.index, payload);

    expect(mocks.calls.update[0]).toBe(realmHistorySchema);
    expect(mocks.calls.set[0]).toBe(payload);
    expect(payload.masterId).toBeUndefined();
    expect(payload.sequence).toBeUndefined();
    expect(mocks.calls.updateWhere[0]).toEqual({
      and: [
        { eq: [realmHistorySchema.masterId, id] },
        { eq: [realmHistorySchema.sequence, data.history.index] },
      ],
    });
  });

  it('del 应当按 masterId 与 sequence 删除', async () => {
    const data = await loadCases();
    const id = await storyId();

    await repository.history.del(id, data.history.index);

    expect(mocks.calls.delete[0]).toBe(realmHistorySchema);
    expect(mocks.calls.deleteWhere[0]).toEqual({
      and: [
        { eq: [realmHistorySchema.masterId, id] },
        { eq: [realmHistorySchema.sequence, data.history.index] },
      ],
    });
  });
});

describe('stories repository / entry', () => {
  it('list 应当按 masterId + entryType + filter 查询，并带排序与分页', async () => {
    const data = await loadCases();
    const id = await storyId();
    const request = data.entry.request;
    mocks.state.queue = [[{ count: data.entry.length }], data.entry.rows];

    const result = await repository.entry.list(id, request);

    const projection = mocks.calls.select[1][0] as Record<string, unknown>;
    expect(Object.keys(projection)).toEqual(data.entry.mapKeys);
    expect(projection.data).toBe(storyEntrySchema.data);
    expect(projection.name).toBe(storyEntrySchema.name);

    const condition = mocks.calls.where[0] as any;
    expect(condition.and).toHaveLength(3);
    expect(condition.and[0].eq).toEqual([storyEntrySchema.masterId, id]);
    expect(condition.and[1].eq).toEqual([
      storyEntrySchema.entryType,
      request.search.entryType,
    ]);
    expect(condition.and[2].like).toEqual([
      storyEntrySchema.filter,
      `%${request.search.filter}%`,
    ]);
    expect(mocks.calls.orderBy).toEqual([[storyEntrySchema.sorter]]);
    expect(mocks.calls.offset).toEqual([request.skip]);
    expect(mocks.calls.limit).toEqual([request.size]);
    expect(result).toEqual({ items: data.entry.rows, length: data.entry.length });
  });

  it('只给类型时不应拼 filter，也不分页', async () => {
    const data = await loadCases();
    const id = await storyId();
    mocks.state.queue = [[{ count: 0 }], []];

    await repository.entry.list(id, data.entry.requestTypeOnly);

    const condition = mocks.calls.where[0] as any;
    expect(condition.and).toHaveLength(2);
    expect(condition.and[1].eq).toEqual([
      storyEntrySchema.entryType,
      data.entry.requestTypeOnly.search.entryType,
    ]);
    expect(mocks.calls.offset).toEqual([]);
    expect(mocks.calls.limit).toEqual([]);
  });

  it('get 应当按三段主键查询并返回整条记录', async () => {
    const data = await loadCases();
    const id = await storyId();
    mocks.state.row = data.entry.rows[0];

    const result = await repository.entry.get(
      id,
      data.entry.entryType,
      data.entry.entryId,
    );

    expect(mocks.calls.from[0]).toBe(storyEntrySchema);
    const condition = mocks.calls.where[0] as any;
    expect(condition.and).toEqual([
      { eq: [storyEntrySchema.masterId, id] },
      { eq: [storyEntrySchema.entryType, data.entry.entryType] },
      { eq: [storyEntrySchema.entryId, data.entry.entryId] },
    ]);
    expect(Object.keys(mocks.calls.select[0][0] as object)).toEqual(
      data.entry.mapKeys,
    );
    expect(result).toEqual(data.entry.rows[0]);
  });

  it('types 应当去重查询条目类型', async () => {
    const data = await loadCases();
    const id = await storyId();
    mocks.state.queue = [data.entry.types.map((entryType) => ({ entryType }))];

    const result = await repository.entry.types(id);

    expect(mocks.calls.selectDistinct[0][0]).toEqual({
      entryType: storyEntrySchema.entryType,
    });
    expect(mocks.calls.where[0]).toEqual({
      eq: [storyEntrySchema.masterId, id],
    });
    expect(result).toEqual(data.entry.types);
  });

  it('add 应当分配 entryId，并合并存储层的条件', async () => {
    const data = await loadCases();
    const id = await storyId();
    const entry = structuredClone(
      data.entry.newEntry,
    ) as unknown as StoryEntry;
    mocks.state.queue = [[{ entryId: data.entry.maxEntryId }]];

    const entryId = await repository.entry.add(id, data.entry.entryType, entry);

    expect(entryId).toBe(data.entry.nextEntryId);
    expect(mocks.calls.values[0]).toEqual({
      ...entry,
      filter: `${data.entry.entryType}:${entry.name}`,
      sorter: entry.name,
      masterId: id,
      entryType: data.entry.entryType,
      entryId: data.entry.nextEntryId,
    });
    expect(mocks.manager.criteria).toHaveBeenCalledWith(
      data.entry.entryType,
      entry,
    );
  });

  it('没有历史条目时 add 的 entryId 应当从 1 开始', async () => {
    const data = await loadCases();
    const id = await storyId();
    mocks.state.queue = [[{ entryId: null }]];

    const entryId = await repository.entry.add(
      id,
      data.entry.entryType,
      structuredClone(data.entry.newEntry) as unknown as StoryEntry,
    );

    expect(entryId).toBe(data.entry.firstEntryId);
    expect((mocks.calls.values[0] as any).entryId).toBe(data.entry.firstEntryId);
  });

  it('make 应当批量写入并逐个分配 entryId', async () => {
    const data = await loadCases();
    const id = await storyId();
    const entries = structuredClone(
      data.entry.batch,
    ) as unknown as StoryEntry[];
    mocks.state.queue = [[{ entryId: data.entry.maxEntryId }]];

    await repository.entry.make(id, data.entry.entryType, entries);

    expect(mocks.calls.values[0]).toEqual(
      entries.map((entry, index) => ({
        ...entry,
        filter: `${data.entry.entryType}:${entry.name}`,
        sorter: entry.name,
        masterId: id,
        entryType: data.entry.entryType,
        entryId: data.entry.maxEntryId + 1 + index,
      })),
    );
    expect(mocks.manager.criteria).toHaveBeenCalledTimes(entries.length);
  });

  it('set 应当清掉三段主键并合并存储层的条件', async () => {
    const data = await loadCases();
    const id = await storyId();
    const patch = structuredClone(data.entry.patch) as Partial<StoryEntry>;

    await repository.entry.set(
      id,
      data.entry.entryType,
      data.entry.entryId,
      patch,
    );

    expect(mocks.calls.update[0]).toBe(storyEntrySchema);
    const payload = mocks.calls.set[0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual([
      'data',
      'name',
      'filter',
      'sorter',
      'masterId',
      'entryType',
      'entryId',
    ]);
    expect(payload.filter).toBe(`${data.entry.entryType}:${patch.name}`);
    expect(payload.masterId).toBeUndefined();
    expect(payload.entryType).toBeUndefined();
    expect(payload.entryId).toBeUndefined();
    expect(mocks.calls.updateWhere[0]).toEqual({
      and: [
        { eq: [storyEntrySchema.masterId, id] },
        { eq: [storyEntrySchema.entryType, data.entry.entryType] },
        { eq: [storyEntrySchema.entryId, data.entry.entryId] },
      ],
    });
  });

  it('del 应当按三段主键删除', async () => {
    const data = await loadCases();
    const id = await storyId();

    await repository.entry.del(id, data.entry.entryType, data.entry.entryId);

    expect(mocks.calls.delete[0]).toBe(storyEntrySchema);
    expect(mocks.calls.deleteWhere[0]).toEqual({
      and: [
        { eq: [storyEntrySchema.masterId, id] },
        { eq: [storyEntrySchema.entryType, data.entry.entryType] },
        { eq: [storyEntrySchema.entryId, data.entry.entryId] },
      ],
    });
  });
});
