import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

// 持久化与模型读取都会走请求层，这里整体替换掉
vi.mock('@/client', () => ({
  get: mocks.get,
  post: mocks.post,
  put: mocks.put,
  del: mocks.del,
  open: vi.fn(),
}));

import { useModelSettingState, useModelState } from '@/models/client/state';
import type { Model } from '@/models';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadModel() {
  return structuredClone(
    (await import('../model.json')).default,
  ) as unknown as Model;
}

beforeEach(() => {
  vi.clearAllMocks();
  useModelSettingState.setState({ model: null });
  useModelState.setState({ item: undefined });
});

describe('models state / 默认模型设置', () => {
  it('初始没有默认模型，重复设置应当整体替换', async () => {
    const model = await loadModel();
    const value = { name: model.name, value: model.id };

    expect(useModelSettingState.getState().model).toBeNull();

    useModelSettingState.getState().setModel(value);
    expect(useModelSettingState.getState().model).toEqual(value);

    useModelSettingState.getState().setModel(null);
    expect(useModelSettingState.getState().model).toBeNull();
  });

  it('持久化键应当与模块常量一致', async () => {
    const { models } = await import('@/models');

    expect(useModelSettingState.persist.getOptions().name).toBe(
      models.state.setting,
    );
  });
});

describe('models state / 当前模型', () => {
  it('传入 id 时应当读取模型并写入状态', async () => {
    const model = await loadModel();
    mocks.get.mockResolvedValue(model);

    await useModelState.getState().setItem(model.id);

    expect(mocks.get).toHaveBeenCalledWith('models/{id}', {
      params: { id: model.id },
    });
    expect(useModelState.getState().item).toEqual(model);
  });

  it('不传 id 时应当清空当前模型且不发请求', async () => {
    const model = await loadModel();
    useModelState.setState({ item: model });

    await useModelState.getState().setItem(undefined);

    expect(mocks.get).not.toHaveBeenCalled();
    expect(useModelState.getState().item).toBeUndefined();
  });

  it('读取失败时应当保持原状态并把错误抛出去', async () => {
    const model = await loadModel();
    mocks.get.mockRejectedValue(new Error('boom'));

    await expect(useModelState.getState().setItem(model.id)).rejects.toThrow(
      'boom',
    );
    expect(useModelState.getState().item).toBeUndefined();
  });
});
