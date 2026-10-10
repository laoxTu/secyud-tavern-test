import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  values: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  get: vi.fn(),
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
  };
});

// 避免真实打开 sqlite 文件；db 本身也换成可断言的桩
vi.mock('@/database/server/provider', () => ({
  dbProvider: {
    client: {},
    db: {
      insert: (...args: unknown[]) => {
        mocks.insert(...args);
        return {
          values: async (model: unknown) => {
            mocks.values(model);
          },
        };
      },
      update: (...args: unknown[]) => {
        mocks.update(...args);
        return {
          set: (payload: unknown) => {
            mocks.set(payload);
            return {
              where: async (condition: unknown) => {
                mocks.where(condition);
              },
            };
          },
        };
      },
    },
    migrate: vi.fn(),
    url: 'file::memory:',
    migrationsFolder: '',
  },
}));

vi.mock('@/database/server', () => ({
  databases: {
    get: mocks.get,
  },
}));

import { settingRepository } from '@/global/server/repository';
import { settingSchema } from '@/global/server/schema';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./repository.cases.json')).default);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('global repository / get', () => {
  it('应当按 schema 与 id 直接委托数据库层', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.existing);

    await expect(settingRepository.get(data.existing.id)).resolves.toEqual(
      data.existing,
    );
    expect(mocks.get).toHaveBeenCalledWith(settingSchema, data.existing.id);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('查不到时不抛错，直接返回 undefined', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(undefined);

    await expect(settingRepository.get(data.existing.id)).resolves.toBeUndefined();
  });

  it('id 原样透传，仓库侧不做校验', async () => {
    const data = await loadCases();

    await settingRepository.get(data.emptyId);

    expect(mocks.get).toHaveBeenCalledWith(settingSchema, data.emptyId);
  });

  it('没有缓存层，每次 get 都会查库', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.existing);

    await settingRepository.get(data.existing.id);
    await settingRepository.get(data.existing.id);

    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
});

describe('global repository / set', () => {
  it('已存在时应当按 id 更新 data，且不改主键', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.existing);

    await expect(
      settingRepository.set({
        id: data.existing.id,
        data: data.updatedData,
      }),
    ).resolves.toBeUndefined();

    expect(mocks.get).toHaveBeenCalledWith(settingSchema, data.existing.id);
    expect(mocks.update).toHaveBeenCalledWith(settingSchema);
    // data 字段原样交给 drizzle 的 json 列，不在这里手工序列化
    expect(mocks.set).toHaveBeenCalledWith({ data: data.updatedData });
    expect(mocks.where.mock.calls[0][0].eq).toEqual([
      settingSchema.id,
      data.existing.id,
    ]);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('不存在时应当整条插入', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(undefined);

    await settingRepository.set(data.created);

    expect(mocks.insert).toHaveBeenCalledWith(settingSchema);
    expect(mocks.values).toHaveBeenCalledWith(data.created);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('data 为 null 时也按 null 覆盖写入', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.existing);

    await settingRepository.set({
      id: data.existing.id,
      data: data.nullData,
    });

    expect(mocks.set).toHaveBeenCalledWith({ data: data.nullData });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('查库失败时应当原样抛出且不写库', async () => {
    const data = await loadCases();
    const error = new Error('db down');
    mocks.get.mockRejectedValue(error);

    await expect(settingRepository.set(data.created)).rejects.toBe(error);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
