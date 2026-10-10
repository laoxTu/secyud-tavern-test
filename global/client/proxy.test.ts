import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));

// 请求层整体替换掉，用例只关心拼出来的 url 与透传的参数
vi.mock('@/client', () => ({
  get: mocks.get,
  post: mocks.post,
  put: mocks.put,
  del: mocks.del,
  open: mocks.open,
}));

import { proxy, settingProxy } from '@/global/client/proxy';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./proxy.cases.json')).default);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('global client proxy / settingProxy', () => {
  it('get 应当 GET settings/{id} 并返回后端数据', async () => {
    const data = await loadData();
    mocks.get.mockResolvedValue(data.loadedValue);

    await expect(settingProxy.get(data.settingId)).resolves.toEqual(
      data.loadedValue,
    );
    expect(mocks.get).toHaveBeenCalledWith('settings/{id}', {
      params: { id: data.settingId },
    });
    // 只走 get，不该顺手发别的请求
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('set 应当 PUT 设置本体，且不回传结果', async () => {
    const data = await loadData();
    mocks.put.mockResolvedValue(data.fetchResult);

    await expect(
      settingProxy.set(data.settingId, data.settingValue),
    ).resolves.toBeUndefined();
    expect(mocks.put).toHaveBeenCalledWith('settings/{id}', data.settingValue, {
      params: { id: data.settingId },
    });
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('global client proxy / proxy.fetch', () => {
  it('应当把整个请求描述交给后端代理接口', async () => {
    const data = await loadData();
    mocks.post.mockResolvedValue(data.fetchResult);

    await expect(proxy.fetch(data.fetchParam)).resolves.toEqual(
      data.fetchResult,
    );
    expect(mocks.post).toHaveBeenCalledWith('proxy', data.fetchParam);

    const [, passed] = mocks.post.mock.calls[0];
    expect(passed).toBe(data.fetchParam);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it('只给 url 时也照原样透传，不在客户端补默认值', async () => {
    const data = await loadData();
    mocks.post.mockResolvedValue(data.fetchResult);

    await proxy.fetch(data.fetchOnlyUrl);

    expect(mocks.post).toHaveBeenCalledWith('proxy', data.fetchOnlyUrl);
    expect(mocks.post.mock.calls[0][1]).not.toHaveProperty('method');
  });
});
