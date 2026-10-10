import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

const mocks = vi.hoisted(() => {
  const calls = {
    select: [] as unknown[][],
    from: [] as unknown[],
    where: [] as unknown[],
    orderBy: [] as unknown[][],
    offset: [] as unknown[],
    limit: [] as unknown[],
    delete: [] as unknown[],
    deleteWhere: [] as unknown[],
  };
  const state = {
    /** 链式查询 await 时按顺序取的结果 */
    queue: [] as unknown[],
    /** 每次 select 造出来的链节点，用来断言嵌套引用 */
    nodes: [] as any[],
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
    state.nodes.push(node);
    return node;
  };
  const db = {
    select: vi.fn((...args: unknown[]) => {
      calls.select.push(args);
      return createNode();
    }),
    delete: vi.fn((table: unknown) => {
      calls.delete.push(table);
      const node: any = {
        where: (condition: unknown) => {
          calls.deleteWhere.push(condition);
          return node;
        },
      };
      return node;
    }),
  };
  const migrate = vi.fn();
  return { calls, state, db, migrate };
});

// 避免真实打开 sqlite 文件
vi.mock('@/database/server/provider', () => ({
  dbProvider: {
    client: {},
    db: mocks.db,
    migrate: mocks.migrate,
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
    exists: mark('exists'),
  };
});

import { databases } from '@/database/server';

const table = sqliteTable('entities', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sorter: text('sorter').notNull().default(''),
});

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const list of Object.values(mocks.calls)) list.length = 0;
  mocks.state.queue = [];
  mocks.state.nodes = [];
  mocks.state.row = undefined;
});

describe('database server / provider 透传', () => {
  it('应当把 provider 的字段合并进来', () => {
    expect(databases.url).toBe('file::memory:');
    expect(databases.migrationsFolder).toBe('');
    expect(databases.migrate).toBe(mocks.migrate);
    expect(databases.client).toEqual({});
    expect(databases.db).toBe(mocks.db);
  });
});

describe('database server / get', () => {
  it('不带 map 时应当按 id 查整行', async () => {
    const data = await loadCases();
    mocks.state.row = data.row;

    const result = await databases.get(table, data.id);

    expect(mocks.calls.select[0]).toEqual([]);
    expect(mocks.calls.from[0]).toBe(table);
    expect((mocks.calls.where[0] as any).eq[0]).toBe(table.id);
    expect((mocks.calls.where[0] as any).eq[1]).toBe(data.id);
    expect(result).toEqual(data.row);
  });

  it('带 map 时应当使用投影列', async () => {
    const data = await loadCases();
    mocks.state.row = data.row;
    const map = (t: typeof table) => ({ id: t.id, name: t.name });

    await databases.get(table, data.id, map);

    expect(mocks.calls.select[0]).toEqual([{ id: table.id, name: table.name }]);
  });

  it('查不到时应当返回 undefined', async () => {
    const data = await loadCases();

    await expect(databases.get(table, data.id)).resolves.toBeUndefined();
  });
});

describe('database server / delete', () => {
  it('应当按 id 删除', async () => {
    const data = await loadCases();

    await databases.delete(table, data.id);

    expect(mocks.calls.delete[0]).toBe(table);
    expect((mocks.calls.deleteWhere[0] as any).eq[0]).toBe(table.id);
    expect((mocks.calls.deleteWhere[0] as any).eq[1]).toBe(data.id);
  });
});

describe('database server / query', () => {
  it('默认应当 offset 0 / limit 20，且不加 where 与排序', async () => {
    const data = await loadCases();
    mocks.state.queue = [[{ count: data.length }], data.rows];

    const result = await databases.query(table, data.requests.default);

    expect(mocks.calls.select[0][0]).toEqual({ count: { count: [] } });
    expect(mocks.calls.select[1]).toEqual([]);
    expect(mocks.calls.where).toEqual([]);
    expect(mocks.calls.orderBy).toEqual([]);
    expect(mocks.calls.offset).toEqual([0]);
    expect(mocks.calls.limit).toEqual([20]);
    expect(result).toEqual({ items: data.rows, length: data.length });
  });

  it('应当使用请求里的 skip 与 size', async () => {
    const data = await loadCases();
    mocks.state.queue = [[{ count: data.length }], data.rows];

    await databases.query(table, data.requests.paged);

    expect(mocks.calls.offset).toEqual([data.requests.paged.skip]);
    expect(mocks.calls.limit).toEqual([data.requests.paged.size]);
  });

  it('有 filter 时 count 与 items 都要带上条件', async () => {
    const data = await loadCases();
    mocks.state.queue = [[{ count: data.length }], data.rows];
    const filter = vi.fn((t: typeof table) => ({ eq: [t.id, data.id] }) as any);

    await databases.query(table, data.requests.searched, filter);

    expect(filter).toHaveBeenCalledWith(table);
    expect(mocks.calls.where).toHaveLength(2);
    expect(mocks.calls.where[0]).toBe(mocks.calls.where[1]);
    expect((mocks.calls.where[0] as any).eq[1]).toBe(data.id);
  });

  it('filter 返回 undefined 时不应加 where', async () => {
    const data = await loadCases();
    mocks.state.queue = [[{ count: data.length }], data.rows];
    const filter = vi.fn(() => undefined);

    await databases.query(table, data.requests.default, filter);

    expect(filter).toHaveBeenCalledWith(table);
    expect(mocks.calls.where).toEqual([]);
  });

  it('sorter 返回数组时应当展开传入 orderBy', async () => {
    const data = await loadCases();
    mocks.state.queue = [[{ count: data.length }], data.rows];
    const sorter = vi.fn(() => [table.sorter, table.name]);

    await databases.query(
      table,
      data.requests.default,
      undefined,
      sorter as any,
    );

    expect(mocks.calls.orderBy).toEqual([[table.sorter, table.name]]);
  });

  it('sorter 返回单列时应当直接传入', async () => {
    const data = await loadCases();
    mocks.state.queue = [[{ count: data.length }], data.rows];

    await databases.query(
      table,
      data.requests.default,
      undefined,
      (t) => t.sorter,
    );

    expect(mocks.calls.orderBy).toEqual([[table.sorter]]);
  });

  it('sorter 返回 undefined 时不应排序', async () => {
    const data = await loadCases();
    mocks.state.queue = [[{ count: data.length }], data.rows];
    const sorter = vi.fn(() => undefined);

    await databases.query(
      table,
      data.requests.default,
      undefined,
      sorter as any,
    );

    expect(sorter).toHaveBeenCalledWith(table);
    expect(mocks.calls.orderBy).toEqual([]);
  });

  it('带 map 时 items 查询应当使用投影列', async () => {
    const data = await loadCases();
    mocks.state.queue = [[{ count: data.length }], data.rows];
    const map = (t: typeof table) => ({ id: t.id });

    await databases.query(
      table,
      data.requests.default,
      undefined,
      undefined,
      map,
    );

    expect(mocks.calls.select[1]).toEqual([{ id: table.id }]);
  });
});

describe('database server / exists', () => {
  it('命中时应当返回 true，并把子查询交给 exists()', async () => {
    const data = await loadCases();
    mocks.state.queue = [data.exists.hit];
    const condition = vi.fn((t: typeof table) => ({ eq: [t.id, data.id] }) as any);

    await expect(databases.exists(table, condition)).resolves.toBe(true);

    expect(condition).toHaveBeenCalledWith(table);
    // 子查询节点原样交给 exists()
    const projection = mocks.calls.select[1][0] as any;
    expect(projection.exists.exists[0]).toBe(mocks.state.nodes[0]);
    expect(mocks.calls.from).toEqual([table, table]);
    // 条件只加在子查询上，主查询不带 where
    expect(mocks.calls.where).toHaveLength(1);
    expect((mocks.calls.where[0] as any).eq[1]).toBe(data.id);
    expect(mocks.calls.limit).toEqual([1]);
  });

  it('未命中时应当返回 false', async () => {
    const data = await loadCases();
    mocks.state.queue = [data.exists.miss];

    await expect(databases.exists(table, () => undefined)).resolves.toBe(false);
  });

  it('exists 为假值时应当返回 false', async () => {
    const data = await loadCases();
    mocks.state.queue = [data.exists.falsey];

    await expect(databases.exists(table, () => undefined)).resolves.toBe(false);
  });
});
