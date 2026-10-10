import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validate } from 'uuid';

import type { ComfyUIParam, ComfyUIWorkflow } from '@/comfyui';

const mocks = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  set: vi.fn(),
  values: vi.fn(),
  wheres: [] as unknown[],
  get: vi.fn(),
  exists: vi.fn(),
  query: vi.fn(),
  remove: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  offsets: [] as number[],
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
    count: mark('count'),
    sql: mark('sql'),
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
        return {
          values: (payload: unknown) => {
            mocks.values(payload);
            return Promise.resolve();
          },
        };
      },
      update: (...args: unknown[]) => {
        mocks.db.update(...args);
        return {
          set: (payload: unknown) => {
            mocks.set(payload);
            return {
              where: (condition: unknown) => {
                mocks.wheres.push(condition);
                return Promise.resolve();
              },
            };
          },
        };
      },
      delete: (...args: unknown[]) => {
        mocks.db.delete(...args);
        return {
          where: (condition: unknown) => {
            mocks.wheres.push(condition);
            return Promise.resolve();
          },
        };
      },
      select: (fields?: unknown) => ({
        from: () => ({
          where: (condition: unknown) => {
            // 裸 drizzle 链：countQuery / itemsQuery 都通过 then 解析成行数组
            if (fields) {
              return {
                then: (resolve: (rows: unknown) => unknown) => {
                  mocks.queryOne(condition);
                  return Promise.resolve(
                    mocks.queryOne.mock.results.at(-1)?.value,
                  ).then(resolve);
                },
              };
            }
            const rows = () => {
              mocks.queryMany(condition);
              return mocks.queryMany.mock.results.at(-1)?.value;
            };
            return {
              then: (resolve: (rows: unknown) => unknown) =>
                Promise.resolve(rows()).then(resolve),
              get: async () => (await mocks.get(condition)) ?? undefined,
              offset: (skip: number) => {
                mocks.offsets.push(skip);
                return {
                  limit: async (size: number) => {
                    mocks.offsets.push(size);
                    return rows();
                  },
                };
              },
            };
          },
        }),
      }),
    },
    get: mocks.get,
    exists: mocks.exists,
    query: mocks.query,
    delete: mocks.remove,
  },
}));

import { workflowRepository } from '@/comfyui/server/repository-workflow';
import {
  comfyuiParamSchema,
  comfyuiWorkflowSchema,
} from '@/comfyui/server/schema';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone(
    (await import('./repository-workflow.cases.json')).default,
  );
}

async function createWorkflow(
  overrides: Partial<ComfyUIWorkflow> = {},
): Promise<ComfyUIWorkflow> {
  const data = await loadCases();
  return { ...data.workflow, ...overrides } as ComfyUIWorkflow;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.wheres.length = 0;
  mocks.offsets.length = 0;
});

describe('comfyui workflow repository / get', () => {
  it('查不到时应当抛实体不存在', async () => {
    const workflow = await createWorkflow();
    mocks.get.mockResolvedValue(undefined);

    await expect(workflowRepository.get(workflow.id)).rejects.toThrow(
      'entity not found',
    );
  });

  it('查到后应当原样返回', async () => {
    const workflow = await createWorkflow();
    mocks.get.mockResolvedValue(workflow);

    await expect(workflowRepository.get(workflow.id)).resolves.toEqual(
      workflow,
    );
    expect(mocks.get).toHaveBeenCalledWith(comfyuiWorkflowSchema, workflow.id);
  });
});

describe('comfyui workflow repository / create', () => {
  it('合法 uuid 应当保留，非法 id 应当重新生成', async () => {
    const data = await loadCases();

    const kept = structuredClone(data.create.simple) as ComfyUIWorkflow;
    await expect(workflowRepository.create(kept)).resolves.toBe(kept.id);

    const replaced = structuredClone(data.create.simple) as ComfyUIWorkflow;
    replaced.id = data.create.invalidId;
    const id = await workflowRepository.create(replaced);

    expect(id).not.toBe(data.create.invalidId);
    expect(validate(id)).toBe(true);
  });

  it('名称为空时应当直接报错', async () => {
    const data = await loadCases();

    await expect(
      workflowRepository.create(data.create.noName as unknown as ComfyUIWorkflow),
    ).rejects.toThrow(/No name provided/);
    await expect(
      workflowRepository.create(
        data.create.blankName as unknown as ComfyUIWorkflow,
      ),
    ).rejects.toThrow(/No name provided/);
  });

  it('应当按 schema 插入并返回 id', async () => {
    const data = await loadCases();
    const workflow = structuredClone(data.create.simple) as ComfyUIWorkflow;

    await expect(workflowRepository.create(workflow)).resolves.toBe(
      workflow.id,
    );

    expect(mocks.db.insert).toHaveBeenCalledWith(comfyuiWorkflowSchema);
    expect(mocks.values).toHaveBeenCalledWith(workflow);
  });
});

describe('comfyui workflow repository / update', () => {
  it('名称显式为空白时应当报错', async () => {
    const data = await loadCases();
    const workflow = await createWorkflow();

    await expect(
      workflowRepository.update(workflow.id, data.update.blankName),
    ).rejects.toThrow(/No name provided/);
  });

  it('应当清掉请求体里的主键，并按 id 定位更新', async () => {
    const data = await loadCases();
    const workflow = await createWorkflow();

    const payload = structuredClone(
      data.update.withId,
    ) as Partial<ComfyUIWorkflow>;
    await workflowRepository.update(workflow.id, payload);

    expect(mocks.db.update).toHaveBeenCalledWith(comfyuiWorkflowSchema);
    expect(mocks.set).toHaveBeenCalledWith({ ...payload, id: undefined });
  });
});

describe('comfyui workflow repository / delete 与 exist', () => {
  it('delete 应当把表与 id 交给数据库层', async () => {
    const workflow = await createWorkflow();

    await workflowRepository.delete(workflow.id);

    expect(mocks.remove).toHaveBeenCalledWith(
      comfyuiWorkflowSchema,
      workflow.id,
    );
  });

  it('exist 应当把条件交给数据库层', async () => {
    const workflow = await createWorkflow();
    const condition = ((t: typeof comfyuiWorkflowSchema) => ({
      eq: [t.id, workflow.id],
    })) as any;

    await workflowRepository.exist(condition);

    expect(mocks.exists).toHaveBeenCalledWith(comfyuiWorkflowSchema, condition);
  });
});

describe('comfyui workflow repository / list', () => {
  it('应当按名称升序、只投影 id 与 name，并把请求原样透传', async () => {
    const data = await loadCases();
    mocks.query.mockResolvedValue({ items: [], length: 0 });

    await workflowRepository.list(data.requests.paged);

    const [table, passed, filter, sorter, map] = mocks.query.mock.calls[0];
    expect(table).toBe(comfyuiWorkflowSchema);
    expect(passed).toBe(data.requests.paged);
    expect(filter(comfyuiWorkflowSchema)).toBeUndefined();
    expect(Object.keys(map(comfyuiWorkflowSchema))).toEqual(data.list.mapKeys);
    expect(sorter(comfyuiWorkflowSchema)).toBe(comfyuiWorkflowSchema.name);
  });

  it('fuzzy 应当按名称模糊匹配', async () => {
    const data = await loadCases();
    mocks.query.mockResolvedValue({ items: [], length: 0 });

    await workflowRepository.list(data.requests.fuzzy);

    const condition = mocks.query.mock.calls[0][2](comfyuiWorkflowSchema);
    expect(condition.and).toHaveLength(1);
    expect(condition.and[0].like[1]).toBe(
      `%${data.requests.fuzzy.search.fuzzy}%`,
    );
  });
});

describe('comfyui workflow repository / param.list', () => {
  it('不传 size 时应当只按 masterId 过滤，不带 offset/limit', async () => {
    const data = await loadCases();
    const { items, length } = data.params.list;
    mocks.queryOne.mockResolvedValue([{ count: length }]);
    mocks.queryMany.mockResolvedValue(items);

    const result = await workflowRepository.param.list(data.workflow.id, {
      size: undefined,
    });

    expect(result).toEqual({ items, length });
    expect(mocks.queryOne).toHaveBeenCalledTimes(1);
    expect(mocks.queryMany).toHaveBeenCalledTimes(1);
    // 没有 size 时不追加 offset/limit
    expect(mocks.offsets).toEqual([]);
    expect(mocks.queryOne.mock.calls[0][0]).toEqual({
      and: [{ eq: [comfyuiParamSchema.masterId, data.workflow.id] }],
    });
  });

  it('带分页时应当把 skip/size 交给查询', async () => {
    const data = await loadCases();
    const { items, length } = data.params.list;
    mocks.queryOne.mockResolvedValue([{ count: length }]);
    mocks.queryMany.mockResolvedValue(items);

    await workflowRepository.param.list(data.workflow.id, {
      skip: data.requests.paged.skip,
      size: data.requests.paged.size,
    });

    expect(mocks.offsets).toEqual([
      data.requests.paged.skip,
      data.requests.paged.size,
    ]);
    expect(mocks.queryMany.mock.calls[0][0]).toEqual({
      and: [{ eq: [comfyuiParamSchema.masterId, data.workflow.id] }],
    });
  });

  it('search.filter 应当追加名称模糊条件', async () => {
    const data = await loadCases();
    mocks.queryOne.mockResolvedValue([{ count: data.params.list.filteredLength }]);
    mocks.queryMany.mockResolvedValue(data.params.list.items);

    await workflowRepository.param.list(
      data.workflow.id,
      data.params.list.request,
    );

    const condition = mocks.queryOne.mock.calls[0][0];
    expect(condition.and).toHaveLength(2);
    expect(condition.and[1].like[0]).toBe(comfyuiParamSchema.name);
    expect(condition.and[1].like[1]).toBe(`%${data.params.list.filter}%`);
  });

  it('过滤条件应当随 filter 变化', async () => {
    const data = await loadCases();
    mocks.queryOne.mockResolvedValue([{ count: data.params.list.filteredLength }]);
    mocks.queryMany.mockResolvedValue(data.params.list.items);

    await workflowRepository.param.list(data.workflow.id, {
      search: { filter: data.params.list.filter },
    });
    await workflowRepository.param.list(data.workflow.id, { search: {} });

    expect(mocks.queryOne.mock.calls[0][0].and).toHaveLength(2);
    expect(mocks.queryOne.mock.calls[1][0].and).toHaveLength(1);
  });
});

describe('comfyui workflow repository / param.get', () => {
  it('应当按 masterId + sequence 定位并返回单条', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.params.second);

    await expect(
      workflowRepository.param.get(data.workflow.id, data.params.second.sequence),
    ).resolves.toEqual(data.params.second);

    // 只有 param.get 会走到单条查询，databases.get 走的是另一个包装
    const condition = mocks.get.mock.calls[0][0];
    expect(condition).toEqual({
      and: [
        { eq: [comfyuiParamSchema.masterId, data.workflow.id] },
        { eq: [comfyuiParamSchema.sequence, data.params.second.sequence] },
      ],
    });
  });

  it('查不到时应当返回 undefined', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(undefined);

    await expect(
      workflowRepository.param.get(data.workflow.id, 9),
    ).resolves.toBeUndefined();
  });
});

describe('comfyui workflow repository / param.add', () => {
  it('应当按当前最大序号加一分配，并回写 masterId 与 sequence', async () => {
    const data = await loadCases();
    mocks.queryOne.mockResolvedValue([
      { sequence: data.params.add.maxSequence },
    ]);
    const param = structuredClone(data.params.incomingAdd) as ComfyUIParam;

    const sequence = await workflowRepository.param.add(
      data.workflow.id,
      param,
    );

    expect(sequence).toBe(data.params.add.maxSequence + 1);
    expect(param.masterId).toBe(data.workflow.id);
    expect(param.sequence).toBe(sequence);
    // 传入的旧 sequence 会被覆盖后写库
    expect(mocks.values).toHaveBeenCalledWith(param);
    expect(mocks.db.insert).toHaveBeenCalledWith(comfyuiParamSchema);
  });

  it('没有任何参数时应当从 0 开始', async () => {
    const data = await loadCases();
    mocks.queryOne.mockResolvedValue([
      { sequence: data.params.add.emptyMaxSequence },
    ]);
    const param = structuredClone(data.params.incomingAdd) as ComfyUIParam;

    await expect(
      workflowRepository.param.add(data.workflow.id, param),
    ).resolves.toBe(0);
    expect(param.sequence).toBe(0);
  });

  it('取最大值的查询应当限定在同一个工作流下', async () => {
    const data = await loadCases();
    mocks.queryOne.mockResolvedValue([{ sequence: 0 }]);

    await workflowRepository.param.add(data.workflow.id, {
      ...data.params.incomingAdd,
    });

    expect(mocks.queryOne.mock.calls[0][0]).toEqual({
      eq: [comfyuiParamSchema.masterId, data.workflow.id],
    });
  });
});

describe('comfyui workflow repository / param.make', () => {
  it('应当从当前最大序号加一开始，逐条递增', async () => {
    const data = await loadCases();
    mocks.queryOne.mockResolvedValue([
      { sequence: data.params.make.maxSequence },
    ]);
    const params = structuredClone(data.params.incomingMake) as ComfyUIParam[];

    await workflowRepository.param.make(data.workflow.id, params);

    const inserted = mocks.values.mock.calls[0][0];
    expect(inserted).toHaveLength(params.length);
    expect(inserted.map((u: ComfyUIParam) => u.sequence)).toEqual(
      params.map((_, i) => data.params.make.maxSequence + 1 + i),
    );
    expect(inserted.map((u: ComfyUIParam) => u.masterId)).toEqual(
      params.map(() => data.workflow.id),
    );
    // 其余字段原样带上
    expect(inserted.map((u: ComfyUIParam) => u.name)).toEqual(
      params.map((u) => u.name),
    );
  });

  it('没有任何参数时应当从 0 开始', async () => {
    const data = await loadCases();
    mocks.queryOne.mockResolvedValue([
      { sequence: data.params.make.emptyMaxSequence },
    ]);
    const params = structuredClone(data.params.incomingMake) as ComfyUIParam[];

    await workflowRepository.param.make(data.workflow.id, params);

    expect(
      mocks.values.mock.calls[0][0].map((u: ComfyUIParam) => u.sequence),
    ).toEqual(params.map((_, i) => i));
  });
});

describe('comfyui workflow repository / param.set', () => {
  it('应当禁止更新主键与序号，并按 masterId + sequence 定位', async () => {
    const data = await loadCases();
    const payload = structuredClone(data.params.update) as Partial<ComfyUIParam>;

    await workflowRepository.param.set(data.workflow.id, 1, payload);

    expect(mocks.db.update).toHaveBeenCalledWith(comfyuiParamSchema);
    expect(mocks.set).toHaveBeenCalledWith({
      ...data.params.update,
      masterId: undefined,
      sequence: undefined,
    });
    expect(mocks.wheres[0]).toEqual({
      and: [
        { eq: [comfyuiParamSchema.masterId, data.workflow.id] },
        { eq: [comfyuiParamSchema.sequence, 1] },
      ],
    });
  });
});

describe('comfyui workflow repository / param.del', () => {
  it('应当按 masterId + sequence 删除单条', async () => {
    const data = await loadCases();

    await workflowRepository.param.del(data.workflow.id, 1);

    expect(mocks.db.delete).toHaveBeenCalledWith(comfyuiParamSchema);
    expect(mocks.wheres[0]).toEqual({
      and: [
        { eq: [comfyuiParamSchema.masterId, data.workflow.id] },
        { eq: [comfyuiParamSchema.sequence, 1] },
      ],
    });
    // 删除不会再触发重新编号（没有额外的 insert/update）
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });
});
