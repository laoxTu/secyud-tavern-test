import { beforeEach, describe, expect, it, vi } from 'vitest';

import { storage } from '@/memories/server/storage';
import type { Story } from '@/stories';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  make: vi.fn(),
}));

// 条目仓库整体替换掉，绕开 sqlite，只验证 storage 的编排
vi.mock('@/stories/server/repository', () => ({
  repository: { entry: { list: mocks.list, make: mocks.make } },
}));

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./entries.json')).default);
}

function createModel(data: any): Story {
  return structuredClone(data.model) as unknown as Story;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('memories server storage / 常量', () => {
  it('id 应当用单数 name，条目键用 plural', async () => {
    const data = await loadCases();

    expect(storage.id).toBe(data.moduleInfo.name);
    expect(storage.id).not.toBe(data.moduleInfo.plural);
  });
});

describe('memories server storage / criteria', () => {
  it('排序键应当由补零的 sequence、importance 与 name 拼成', async () => {
    const data = await loadCases();

    expect(storage.criteria(data.criteria.entry as any)).toEqual({
      sorter: data.criteria.sorter,
      filter: data.criteria.filter,
    });
  });

  it('补零后字符串比较应当与数值顺序一致', async () => {
    const data = await loadCases();
    const sorters = data.sortCases.map(
      (item: any) =>
        storage.criteria({ name: item.name, data: item } as any).sorter,
    );

    expect(sorters).toEqual(data.sortCases.map((item: any) => item.expected));
    expect([...sorters].sort()).toEqual(sorters);
  });

  it('同名条目的过滤键应当相同，排序键仍然不同', async () => {
    const data = await loadCases();
    const [left, right] = data.duplicate.map((item: any) =>
      storage.criteria({ name: item.name, data: item } as any),
    );

    expect(left.filter).toBe(right.filter);
    expect(left.sorter).not.toBe(right.sorter);
  });

  it('缺少 data 时应当返回空条件', async () => {
    expect(storage.criteria({ name: '初遇' } as any)).toEqual({});
  });
});

describe('memories server storage / load', () => {
  it('应当按条目类型查询并展开成 memory 条目', async () => {
    const data = await loadCases();
    const model = createModel(data);
    mocks.list.mockResolvedValue({
      items: structuredClone(data.stored),
      length: data.stored.length,
    });

    await storage.load(model);

    expect(mocks.list).toHaveBeenCalledWith(model.id, {
      search: { entryType: data.moduleInfo.name },
    });
    expect(model.entries![data.moduleInfo.plural]).toEqual(
      data.stored.map((item: any) => ({
        ...item.data,
        name: item.name,
        entryId: item.entryId,
      })),
    );
  });

  it('没有条目时不应当写入条目键', async () => {
    const data = await loadCases();
    const model = createModel(data);
    mocks.list.mockResolvedValue({ items: [], length: 0 });

    await storage.load(model);

    expect(model.entries![data.moduleInfo.plural]).toBeUndefined();
  });
});

describe('memories server storage / save', () => {
  it('应当把条目拆成仓库入参并补上主键信息', async () => {
    const data = await loadCases();
    const model = createModel(data);
    model.entries = { [data.moduleInfo.plural]: structuredClone(data.entries) };

    await storage.save(model);

    expect(mocks.make).toHaveBeenCalledWith(
      model.id,
      data.moduleInfo.name,
      data.entries.map((item: any) => ({
        data: { ...item, name: undefined, masterId: undefined },
        name: item.name,
        masterId: model.id,
        entryType: data.moduleInfo.name,
        entryId: 0,
      })),
    );
  });

  it('没有 entries 时不应当落库', async () => {
    const data = await loadCases();
    const model = createModel(data);

    await storage.save(model);

    expect(mocks.make).not.toHaveBeenCalled();
  });

  it('条目数组为空时不应当落库', async () => {
    const data = await loadCases();
    const model = createModel(data);
    model.entries = { [data.moduleInfo.plural]: [] };

    await storage.save(model);

    expect(mocks.make).not.toHaveBeenCalled();
  });
});
