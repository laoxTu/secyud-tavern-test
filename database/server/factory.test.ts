import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import {
  getTableConfig,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

import type { Entries } from '@/database';
import type { Storage } from '@/database/server/storage';
import { Registry } from '@/plugins';

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
  const state = {
    /** 链式查询 await 时按顺序取的结果 */
    queue: [] as unknown[],
    /** .get() 的返回值 */
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
      then: (resolve: (value: unknown) => unknown) => resolve(state.queue.shift()),
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
  return { calls, state, db };
});

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
    count: mark('count'),
    sql: (...args: unknown[]) => ({ sql: args }),
  };
});

import {
  boolean,
  foreignKey,
  json,
  repositories,
  schemas,
  storages,
} from '@/database/server/factory';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./factory.cases.json')).default);
}

function createMaster(name: string) {
  return sqliteTable(name, { id: text('id').primaryKey() });
}

/** 造一个假的存储管理器，criteria 的期望值都由 fixture 里的 name 派生 */
async function createRepository() {
  const data = await loadCases();
  const master = createMaster(data.masterTable);
  const table = schemas.entry(data.entryTable, () => master.id);
  const manager = {
    load: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    criteria: vi.fn((type: string, entry: any) => ({
      filter: `${type}:${entry.name}`,
      sorter: entry.name,
    })),
  };
  const map = (t: typeof table) => ({ name: t.name, filter: t.filter });

  return {
    data,
    master,
    table,
    manager,
    map,
    repository: repositories.entry(table, manager as any, map as any),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const list of Object.values(mocks.calls)) list.length = 0;
  mocks.state.queue = [];
  mocks.state.row = undefined;
});

describe('database server factory / json 与 boolean', () => {
  it('应当生成 json 与 boolean 模式的列', async () => {
    const data = await loadCases();
    const probe = sqliteTable('probe', {
      payload: json(data.columns.json.name),
      flag: boolean(data.columns.boolean.name),
    });

    expect(probe.payload.name).toBe(data.columns.json.name);
    expect(probe.payload.dataType).toBe(data.columns.json.dataType);
    expect(probe.payload.columnType).toBe(data.columns.json.columnType);
    expect(probe.flag.name).toBe(data.columns.boolean.name);
    expect(probe.flag.dataType).toBe(data.columns.boolean.dataType);
    expect(probe.flag.columnType).toBe(data.columns.boolean.columnType);
  });
});

describe('database server factory / foreignKey', () => {
  it('应当引用目标列，并默认双向级联', async () => {
    const data = await loadCases();
    const master = createMaster(data.masterTable);
    const child = sqliteTable('children', {
      masterId: foreignKey(data.columns.foreignKey.name, () => master.id),
    });

    expect(child.masterId.name).toBe(data.columns.foreignKey.name);
    expect(child.masterId.dataType).toBe(data.columns.foreignKey.dataType);
    expect(child.masterId.columnType).toBe(data.columns.foreignKey.columnType);

    const [fk] = getTableConfig(child).foreignKeys;
    expect(fk.onDelete).toBe(data.columns.foreignKey.onDelete);
    expect(fk.onUpdate).toBe(data.columns.foreignKey.onUpdate);

    const reference = fk.reference();
    expect(reference.columns.map((u) => u.name)).toEqual([
      data.columns.foreignKey.name,
    ]);
    expect(reference.foreignColumns.map((u) => u.name)).toEqual([
      master.id.name,
    ]);
    expect(getTableName(reference.foreignTable)).toBe(data.masterTable);
  });
});

describe('database server factory / schemas.entry', () => {
  it('应当生成业务列、默认值、主键与索引', async () => {
    const data = await loadCases();
    const master = createMaster(data.masterTable);
    const table = schemas.entry(data.entryTable, () => master.id);
    const config = getTableConfig(table);

    expect(getTableName(table)).toBe(data.entryTable);
    expect(config.columns.map((u) => u.name)).toEqual(
      data.entryColumns.map((u) => u.name),
    );
    for (const spec of data.entryColumns) {
      const column = config.columns.find((u) => u.name === spec.name)!;
      expect(column.notNull).toBe(spec.notNull);
      if ('dataType' in spec) {
        expect(column.dataType).toBe(spec.dataType);
      }
      if ('default' in spec) {
        expect(column.hasDefault).toBe(true);
        expect(column.default).toBe(spec.default);
      }
    }

    expect(
      config.primaryKeys[0].columns.map((u) => u.name),
    ).toEqual(data.pkColumns);
    expect(config.indexes.map((u) => u.config.name)).toEqual(
      data.indexes.map((u) => `${data.entryTable}${u.suffix}`),
    );
    // index 的列是 IndexColumn（SQLiteColumn | SQL）联合，断言的是列名字符串
    expect(
      config.indexes.map((u) =>
        u.config.columns.map((c) => (c as unknown as { name: string }).name),
      ),
    ).toEqual(data.indexes.map((u) => [u.column]));

    const [fk] = config.foreignKeys;
    expect(fk.onDelete).toBe(data.columns.foreignKey.onDelete);
    expect(fk.reference().foreignColumns.map((u) => u.name)).toEqual([
      master.id.name,
    ]);
  });

  it('额外列应当合并进表定义', async () => {
    const data = await loadCases();
    const master = createMaster(data.masterTable);
    const table = schemas.entry(data.entryTable, () => master.id, {
      extra: integer('extra'),
    });

    expect(getTableConfig(table).columns.map((u) => u.name)).toContain('extra');
  });
});

describe('database server factory / repositories.entry list', () => {
  it('应当把 filter 与 entryType 拼成 and 条件，并带上排序与分页', async () => {
    const { data, table, repository } = await createRepository();
    mocks.state.queue = [[{ count: data.length }], data.rows];

    const result = await repository.list(data.masterId, data.request as any);

    expect(mocks.calls.select[0][0]).toEqual({ count: { count: [] } });
    const projection = mocks.calls.select[1][0] as Record<string, unknown>;
    expect(Object.keys(projection)).toEqual([
      'name',
      'filter',
      'entryType',
      'entryId',
      'masterId',
    ]);
    expect(projection.name).toBe(table.name);
    expect(projection.filter).toBe(table.filter);
    expect(projection.entryType).toBe(table.entryType);
    expect(projection.entryId).toBe(table.entryId);
    expect(projection.masterId).toBe(table.masterId);

    const condition = mocks.calls.where[0] as any;
    expect(condition.and).toHaveLength(3);
    expect(condition.and[0].eq[0]).toBe(table.masterId);
    expect(condition.and[0].eq[1]).toBe(data.masterId);
    expect(condition.and[1].eq[0]).toBe(table.entryType);
    expect(condition.and[1].eq[1]).toBe(data.request.search.entryType);
    expect(condition.and[2].like[0]).toBe(table.filter);
    expect(condition.and[2].like[1]).toBe(`%${data.request.search.filter}%`);

    expect(mocks.calls.orderBy).toEqual([[table.sorter]]);
    expect(mocks.calls.offset).toEqual([data.request.skip]);
    expect(mocks.calls.limit).toEqual([data.request.size]);
    expect(result).toEqual({ items: data.rows, length: data.length });
  });

  it('没有 filter/entryType 时只剩 masterId 条件，且缺省 size 不分页', async () => {
    const { data, table, repository } = await createRepository();
    mocks.state.queue = [[{ count: data.length }], data.rows];

    await repository.list(data.masterId, data.requestNoFilter as any);

    const condition = mocks.calls.where[0] as any;
    expect(condition.and).toHaveLength(1);
    expect(condition.and[0].eq[0]).toBe(table.masterId);
    expect(condition.and[0].eq[1]).toBe(data.masterId);
    expect(mocks.calls.offset).toEqual([]);
    expect(mocks.calls.limit).toEqual([]);
  });

  it('只给 size 时 skip 应当回落成 0', async () => {
    const { data, repository } = await createRepository();
    mocks.state.queue = [[{ count: data.length }], data.rows];

    await repository.list(data.masterId, data.requestSizeOnly as any);

    expect(mocks.calls.offset).toEqual([0]);
    expect(mocks.calls.limit).toEqual([data.requestSizeOnly.size]);
  });

  it('完全不带请求时应当按 masterId 全量列出', async () => {
    const { data, table, repository } = await createRepository();
    mocks.state.queue = [[{ count: data.length }], data.rows];

    const result = await repository.list(data.masterId);

    const condition = mocks.calls.where[0] as any;
    expect(condition.and).toHaveLength(1);
    expect(condition.and[0].eq[0]).toBe(table.masterId);
    expect(mocks.calls.offset).toEqual([]);
    expect(result.length).toBe(data.length);
  });
});

describe('database server factory / repositories.entry get 与 types', () => {
  it('get 应当按三段主键查询并返回整条记录', async () => {
    const { data, table, repository } = await createRepository();
    mocks.state.row = data.entry;

    const result = await repository.get(
      data.masterId,
      data.entryType,
      data.entryId,
    );

    const condition = mocks.calls.where[0] as any;
    expect(condition.and).toHaveLength(3);
    expect(condition.and[0].eq).toEqual([table.masterId, data.masterId]);
    expect(condition.and[1].eq).toEqual([table.entryType, data.entryType]);
    expect(condition.and[2].eq).toEqual([table.entryId, data.entryId]);

    const projection = mocks.calls.select[0][0] as Record<string, unknown>;
    expect(Object.keys(projection)).toEqual([
      'name',
      'filter',
      'entryType',
      'entryId',
      'masterId',
    ]);
    expect(result).toEqual(data.entry);
  });

  it('types 应当去重查询并按 masterId 过滤', async () => {
    const { data, table, repository } = await createRepository();
    mocks.state.queue = [data.types.map((entryType) => ({ entryType }))];

    const result = await repository.types(data.masterId);

    expect(mocks.calls.selectDistinct[0][0]).toEqual({
      entryType: table.entryType,
    });
    const condition = mocks.calls.where[0] as any;
    expect(condition.eq[0]).toBe(table.masterId);
    expect(condition.eq[1]).toBe(data.masterId);
    expect(result).toEqual(data.types);
  });
});

describe('database server factory / repositories.entry make 与 add', () => {
  it('make 应当先取最大 entryId，再按序号批量写入并合并 criteria', async () => {
    const { data, table, manager, repository } = await createRepository();
    mocks.state.queue = [[{ entryId: data.maxEntryId }]];

    await repository.make(data.masterId, data.entryType, data.entries as any);

    const maxProjection = mocks.calls.select[0][0] as any;
    expect(maxProjection.entryId.sql[1]).toBe(table.entryId);
    expect(maxProjection.entryId.sql[0].join('')).toContain('max(');

    const maxCondition = mocks.calls.where[0] as any;
    expect(maxCondition.and).toHaveLength(2);
    expect(maxCondition.and[0].eq).toEqual([table.masterId, data.masterId]);
    expect(maxCondition.and[1].eq).toEqual([table.entryType, data.entryType]);

    expect(mocks.calls.insert[0]).toBe(table);
    expect(mocks.calls.values[0]).toEqual(
      data.entries.map((entry, index) => ({
        ...entry,
        filter: `${data.entryType}:${entry.name}`,
        sorter: entry.name,
        masterId: data.masterId,
        entryType: data.entryType,
        entryId: data.maxEntryId + 1 + index,
      })),
    );
    expect(manager.criteria).toHaveBeenCalledTimes(data.entries.length);
    expect(manager.criteria).toHaveBeenCalledWith(data.entryType, data.entries[0]);
  });

  it('add 应当返回分配到的 entryId 并写入单条', async () => {
    const { data, repository } = await createRepository();
    mocks.state.queue = [[{ entryId: data.maxEntryId }]];

    const entryId = await repository.add(
      data.masterId,
      data.entryType,
      data.entry as any,
    );

    expect(entryId).toBe(data.nextEntryId);
    expect(mocks.calls.values[0]).toEqual({
      ...data.entry,
      filter: `${data.entryType}:${data.entry.name}`,
      sorter: data.entry.name,
      masterId: data.masterId,
      entryType: data.entryType,
      entryId: data.nextEntryId,
    });
  });

  it('没有历史条目（max 为 null）时 entryId 应当从 1 开始', async () => {
    const { data, repository } = await createRepository();
    mocks.state.queue = [[{ entryId: null }]];

    const entryId = await repository.add(
      data.masterId,
      data.entryType,
      data.entry as any,
    );

    expect(entryId).toBe(data.firstEntryId);
    expect((mocks.calls.values[0] as any).entryId).toBe(data.firstEntryId);
  });
});

describe('database server factory / repositories.entry set 与 del', () => {
  it('set 应当清掉三段主键列，并按主键定位', async () => {
    const { data, table, manager, repository } = await createRepository();

    await repository.set(
      data.masterId,
      data.entryType,
      data.entryId,
      data.patch as any,
    );

    expect(mocks.calls.update[0]).toBe(table);
    const payload = mocks.calls.set[0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual([
      'name',
      'filter',
      'sorter',
      'masterId',
      'entryType',
      'entryId',
    ]);
    expect(payload.name).toBe(data.patch.name);
    expect(payload.filter).toBe(`${data.entryType}:${data.patch.name}`);
    expect(payload.masterId).toBeUndefined();
    expect(payload.entryType).toBeUndefined();
    expect(payload.entryId).toBeUndefined();
    expect(manager.criteria).toHaveBeenCalledWith(data.entryType, data.patch);

    const condition = mocks.calls.updateWhere[0] as any;
    expect(condition.and).toHaveLength(3);
    expect(condition.and[0].eq).toEqual([table.masterId, data.masterId]);
    expect(condition.and[1].eq).toEqual([table.entryType, data.entryType]);
    expect(condition.and[2].eq).toEqual([table.entryId, data.entryId]);
  });

  it('del 应当按三段主键删除', async () => {
    const { data, table, repository } = await createRepository();

    await repository.del(data.masterId, data.entryType, data.entryId);

    expect(mocks.calls.delete[0]).toBe(table);
    const condition = mocks.calls.deleteWhere[0] as any;
    expect(condition.and).toHaveLength(3);
    expect(condition.and[0].eq).toEqual([table.masterId, data.masterId]);
    expect(condition.and[1].eq).toEqual([table.entryType, data.entryType]);
    expect(condition.and[2].eq).toEqual([table.entryId, data.entryId]);
  });
});

describe('database server factory / storages.createManager', () => {
  /** 用真实 Registry 注册两个假存储，记录调用顺序 */
  async function createManager(log: string[]) {
    const data = await loadCases();
    const registry = new Registry<Storage<Entries>>('test-storages');
    const created = data.storages.map((spec) => {
      const storage = {
        id: spec.id,
        sequence: spec.sequence,
        load: vi.fn(async () => {
          log.push(`load:${spec.id}`);
        }),
        save: vi.fn(async () => {
          log.push(`save:${spec.id}`);
        }),
        criteria: vi.fn((entry: any) => ({
          filter: `${spec.id}:${entry.name}`,
        })),
      };
      registry.register(storage);
      return storage;
    });

    return { data, created, manager: storages.createManager(registry) };
  }

  it('load 应当按注册顺序逐个委派给存储', async () => {
    const log: string[] = [];
    const { data, created, manager } = await createManager(log);
    const entity = { id: data.masterId } as Entries;

    await manager.load(entity);

    expect(log).toEqual(data.storages.map((spec) => `load:${spec.id}`));
    for (const storage of created) {
      expect(storage.load).toHaveBeenCalledWith(entity);
    }
  });

  it('save 应当按注册顺序逐个委派给存储', async () => {
    const log: string[] = [];
    const { data, created, manager } = await createManager(log);
    const entity = { id: data.masterId } as Entries;

    await manager.save(entity);

    expect(log).toEqual(data.storages.map((spec) => `save:${spec.id}`));
    for (const storage of created) {
      expect(storage.save).toHaveBeenCalledWith(entity);
    }
  });

  it('criteria 应当只委派给对应类型的存储', async () => {
    const { data, created, manager } = await createManager([]);
    const entry = data.entry;

    const result = manager.criteria(created[1].id, entry);

    expect(result).toEqual({ filter: `${created[1].id}:${entry.name}` });
    expect(created[1].criteria).toHaveBeenCalledWith(entry);
    expect(created[0].criteria).not.toHaveBeenCalled();
  });
});
