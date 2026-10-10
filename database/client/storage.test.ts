import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));

// dbStorage 只通过 settings.proxy 读写设置，这里整体替换掉
vi.mock('@/global/client', () => ({
  settings: { proxy: { get: mocks.get, set: mocks.set } },
}));

import { dbStorage } from '@/database/client/storage';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./storage.cases.json')).default);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('database client storage / getItem', () => {
  it('应当按 name 读设置，并把值包成 json 文本', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.setting);

    const text = await dbStorage.getItem(data.name);

    expect(mocks.get).toHaveBeenCalledWith(data.name);
    expect(text).toBe(data.text);
    expect(JSON.parse(text as string)).toEqual(data.setting);
  });

  it('读取失败时应当把错误抛出去', async () => {
    const data = await loadCases();
    mocks.get.mockRejectedValue(new Error('boom'));

    await expect(dbStorage.getItem(data.name)).rejects.toThrow('boom');
  });
});

describe('database client storage / setItem', () => {
  it('应当把 json 文本解析成对象后写入设置', async () => {
    const data = await loadCases();

    await dbStorage.setItem(data.name, data.text);

    expect(mocks.set).toHaveBeenCalledWith(data.name, data.setting);
  });
});

describe('database client storage / removeItem', () => {
  it('应当把设置写成 null', async () => {
    const data = await loadCases();

    await dbStorage.removeItem(data.name);

    expect(mocks.set).toHaveBeenCalledWith(data.name, null);
  });
});
