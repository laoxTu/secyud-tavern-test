import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));

// 请求层整体替换掉，用例只关心拼出来的 url 与请求体
vi.mock('@/client', () => ({
  get: mocks.get,
  post: mocks.post,
  put: mocks.put,
  del: mocks.del,
  open: mocks.open,
}));

import { proxy } from '@/signal/client/proxy';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./proxy.cases.json')).default);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('signal proxy / subscription', () => {
  it('应当把订阅动作整包 POST 给订阅接口', async () => {
    const data = await loadCases();

    await proxy.subscription(data.subscription as any);

    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith(
      'sse/{id}/subscription',
      data.subscription,
    );
    // 只走 post，不该顺手发别的请求
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.del).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('调用方拿不到返回值（透传 undefined）', async () => {
    const data = await loadCases();
    mocks.post.mockResolvedValue({ ignored: true });

    await expect(
      proxy.subscription(data.subscription as any),
    ).resolves.toBeUndefined();
  });
});
