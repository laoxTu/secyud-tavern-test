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

import { useSseConnection } from '@/signal/client';
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
    // 订阅必须把真实连接 id 作为路径参数带上，否则请求会打到字面量 sse/{id}/subscription（幽灵连接）
    expect(mocks.post).toHaveBeenCalledWith(
      'sse/{id}/subscription',
      data.subscription,
      { params: { id: useSseConnection.getState().id } },
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
