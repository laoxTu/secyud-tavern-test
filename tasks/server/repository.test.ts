import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validate } from 'uuid';

import type { Task, TaskHistory } from '@/tasks';

const mocks = vi.hoisted(() => {
  /** drizzle 的链式 builder 桩：用例要回看每层收到的参数 */
  type AnyFn = (...args: any[]) => any;
  const values = vi.fn<AnyFn>(async () => {});
  const set = vi.fn<(payload: unknown) => void>();
  const where = vi.fn<AnyFn>(async () => {});
  const orderBy = vi.fn<AnyFn>(async () => [] as unknown[]);
  const limit = vi.fn<AnyFn>(async () => [] as unknown[]);
  const whereSelect = vi.fn<AnyFn>(() => ({ orderBy, limit }));
  const whereDelete = vi.fn<AnyFn>(async () => {});
  const from = vi.fn<AnyFn>(() => ({ where: whereSelect }));
  const select = vi.fn<AnyFn>(() => ({ from }));
  const insert = vi.fn<AnyFn>(() => ({ values }));
  const update = vi.fn<AnyFn>(() => ({
    set: (payload: unknown) => {
      set(payload);
      return { where };
    },
  }));
  const deleteRows = vi.fn<AnyFn>(() => ({ where: whereDelete }));
  return {
    values,
    set,
    where,
    orderBy,
    limit,
    whereSelect,
    whereDelete,
    from,
    select,
    insert,
    update,
    deleteRows,
    get: vi.fn(),
    exists: vi.fn(),
    query: vi.fn(),
    remove: vi.fn(),
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
    // history 子仓库直接驱动 drizzle 的链式 builder
    db: {
      insert: mocks.insert,
      update: mocks.update,
      select: mocks.select,
      delete: mocks.deleteRows,
    },
    get: mocks.get,
    exists: mocks.exists,
    query: mocks.query,
    delete: mocks.remove,
  },
}));

import { repository } from '@/tasks/server/repository';
import { taskHistorySchema, taskSchema } from '@/tasks/server/schema';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./repository.cases.json')).default);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tasks repository / get', () => {
  it('查不到时应当抛实体不存在', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(undefined);

    await expect(repository.get(data.task.id)).rejects.toThrow(
      'entity not found',
    );
    expect(mocks.get).toHaveBeenCalledWith(taskSchema, data.task.id);
  });

  it('命中时应当返回实体，且每次都查库（没有缓存）', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.task);

    await expect(repository.get(data.task.id)).resolves.toEqual(data.task);
    await repository.get(data.task.id);

    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.get).toHaveBeenCalledWith(taskSchema, data.task.id);
  });
});

describe('tasks repository / create', () => {
  it('名称为空或全是空白时应当报错，不写库', async () => {
    const data = await loadCases();

    await expect(
      repository.create(data.create.noName as unknown as Task),
    ).rejects.toThrow(/No name provided/);
    await expect(
      repository.create(data.create.blankName as unknown as Task),
    ).rejects.toThrow(/No name provided/);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('缺 id 时应当生成 uuid，并补上 status / attempt 默认值', async () => {
    const data = await loadCases();
    const task = structuredClone(data.create.withoutId) as Task;

    const id = await repository.create(task);

    expect(validate(id)).toBe(true);
    expect(task.id).toBe(id);
    expect(task.status).toBe('pending');
    expect(task.attempt).toBe(0);
    expect(mocks.insert).toHaveBeenCalledWith(taskSchema);
    expect(mocks.values).toHaveBeenCalledWith(task);
  });

  it('已有 id 时应当保留原 id', async () => {
    const data = await loadCases();
    const task = structuredClone(data.create.withId) as Task;

    await expect(repository.create(task)).resolves.toBe(task.id);
    expect(mocks.values).toHaveBeenCalledWith(task);
  });
});

describe('tasks repository / update', () => {
  it('名称显式为空白时应当报错，不写库', async () => {
    const data = await loadCases();

    await expect(
      repository.update(data.task.id, data.update.blankName as Partial<Task>),
    ).rejects.toThrow(/No name provided/);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('应当清掉请求体里的主键再写库并返回 id', async () => {
    const data = await loadCases();
    const payload = structuredClone(data.update.withId) as Partial<Task>;

    await expect(repository.update(data.task.id, payload)).resolves.toBe(
      data.task.id,
    );

    expect(mocks.update).toHaveBeenCalledWith(taskSchema);
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: undefined,
        name: data.update.withId.name,
        status: data.update.withId.status,
        result: data.update.withId.result,
      }),
    );
    // 入参被就地改写
    expect(payload.id).toBeUndefined();
  });
});

describe('tasks repository / delete 与 exist', () => {
  it('delete 应当把表与 id 交给数据库层', async () => {
    const data = await loadCases();

    await repository.delete(data.task.id);

    expect(mocks.remove).toHaveBeenCalledWith(taskSchema, data.task.id);
  });

  it('exist 应当把条件函数原样交给数据库层', async () => {
    const data = await loadCases();
    const condition = ((t: typeof taskSchema) => ({ eq: [t.id, data.task.id] })) as any;

    await repository.exist(condition);

    expect(mocks.exists).toHaveBeenCalledWith(taskSchema, condition);
  });
});

describe('tasks repository / list', () => {
  it('应当给出投影与按名称排序，并把请求原样透传', async () => {
    const data = await loadCases();
    mocks.query.mockResolvedValue({ items: [], length: 0 });

    await repository.list(data.requests.paged);

    const [table, passed, filter, sorter, map] = mocks.query.mock.calls[0];
    expect(table).toBe(taskSchema);
    expect(passed).toBe(data.requests.paged);
    expect(filter(taskSchema)).toBeUndefined();
    expect(Object.keys(map(taskSchema))).toEqual(data.list.mapKeys);
    expect(sorter(taskSchema)).toBe(taskSchema.name);
  });

  it('fuzzy 应当按名称模糊匹配', async () => {
    const data = await loadCases();
    mocks.query.mockResolvedValue({ items: [], length: 0 });

    await repository.list(data.requests.fuzzy);

    const condition = mocks.query.mock.calls[0][2](taskSchema);
    expect(condition.and).toHaveLength(1);
    expect(condition.and[0].like[0]).toBe(taskSchema.name);
    expect(condition.and[0].like[1]).toBe(
      `%${data.requests.fuzzy.search.fuzzy}%`,
    );
  });
});

describe('tasks repository / history', () => {
  it('list 应当按 masterId 过滤并按 attempt 排序', async () => {
    const data = await loadCases();
    mocks.orderBy.mockResolvedValue(data.history.rows);

    const rows = await repository.history.list(data.task.id);

    expect(rows).toEqual(data.history.rows);
    expect(mocks.from).toHaveBeenCalledWith(taskHistorySchema);
    expect(mocks.orderBy).toHaveBeenCalledWith(taskHistorySchema.attempt);
    const condition = mocks.whereSelect.mock.calls[0][0];
    expect(condition.and).toHaveLength(1);
    expect(condition.and[0].eq[0]).toBe(taskHistorySchema.masterId);
    expect(condition.and[0].eq[1]).toBe(data.task.id);
  });

  it('get 应当按 masterId 与 attempt 过滤并只取一条', async () => {
    const data = await loadCases();
    mocks.limit.mockResolvedValue([data.history.row]);

    const row = await repository.history.get(
      data.task.id,
      data.history.row.attempt,
    );

    expect(row).toEqual(data.history.row);
    expect(mocks.limit).toHaveBeenCalledWith(1);
    const condition = mocks.whereSelect.mock.calls[0][0];
    expect(condition.and).toHaveLength(2);
    expect(condition.and[0].eq[0]).toBe(taskHistorySchema.masterId);
    expect(condition.and[0].eq[1]).toBe(data.task.id);
    expect(condition.and[1].eq[0]).toBe(taskHistorySchema.attempt);
    expect(condition.and[1].eq[1]).toBe(data.history.row.attempt);
  });

  it('add 应当把 masterId 拼进历史条目', async () => {
    const data = await loadCases();

    await repository.history.add(
      data.task.id,
      data.history.entry as unknown as Omit<TaskHistory, 'masterId'>,
    );

    expect(mocks.insert).toHaveBeenCalledWith(taskHistorySchema);
    expect(mocks.values).toHaveBeenCalledWith({
      ...data.history.entry,
      masterId: data.task.id,
    });
  });

  it('del 应当按 masterId 与 attempt 删除', async () => {
    const data = await loadCases();

    await repository.history.del(data.task.id, data.history.entry.attempt);

    expect(mocks.deleteRows).toHaveBeenCalledWith(taskHistorySchema);
    const condition = mocks.whereDelete.mock.calls[0][0];
    expect(condition.and).toHaveLength(2);
    expect(condition.and[0].eq[0]).toBe(taskHistorySchema.masterId);
    expect(condition.and[0].eq[1]).toBe(data.task.id);
    expect(condition.and[1].eq[0]).toBe(taskHistorySchema.attempt);
    expect(condition.and[1].eq[1]).toBe(data.history.entry.attempt);
  });
});
