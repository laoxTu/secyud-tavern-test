import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

// 请求层整体替换掉，用例只关心拼出来的 url 与参数
vi.mock('@/client', () => ({
  get: mocks.get,
  post: mocks.post,
  put: mocks.put,
  del: mocks.del,
  open: vi.fn(),
}));

import { proxy } from '@/tasks/client/proxy';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./proxy.cases.json')).default);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tasks proxy / list', () => {
  it('应当把查询参数放进 params 并透传分页结果', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.listResponse);

    const result = await proxy.list(data.requests.paged);

    expect(mocks.get).toHaveBeenCalledWith('tasks', {
      params: data.requests.paged,
    });
    expect(result).toEqual(data.listResponse);
  });

  it('不传查询参数时 params 应当是 undefined', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.listResponse);

    const result = await proxy.list();

    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls[0][0]).toBe('tasks');
    expect('params' in mocks.get.mock.calls[0][1]).toBe(true);
    expect(mocks.get.mock.calls[0][1].params).toBeUndefined();
    expect(result).toEqual(data.listResponse);
  });
});

describe('tasks proxy / delete 与 restart', () => {
  it('delete 应当按 id 删除且不返回任何值', async () => {
    const data = await loadCases();
    mocks.del.mockResolvedValue('ignored');

    const result = await proxy.delete(data.ids.task);

    expect(mocks.del).toHaveBeenCalledWith('tasks/{id}', {
      params: { id: data.ids.task },
    });
    expect(result).toBeUndefined();
  });

  it('restart 应当按 id 发出 post 且不返回任何值', async () => {
    const data = await loadCases();
    mocks.post.mockResolvedValue('ignored');

    const result = await proxy.restart(data.ids.task);

    expect(mocks.post).toHaveBeenCalledWith('tasks/{id}/restart', {
      params: { id: data.ids.task },
    });
    expect(result).toBeUndefined();
  });

  it('id 原样透传，不做转义或 url 拼接', async () => {
    const data = await loadCases();

    await proxy.delete(data.ids.raw);
    await proxy.restart(data.ids.raw);

    expect(mocks.del.mock.calls[0][1].params.id).toBe(data.ids.raw);
    expect(mocks.post.mock.calls[0][1].params.id).toBe(data.ids.raw);
  });

  it('每个方法只传 url 与 options 两个参数', async () => {
    const data = await loadCases();

    await proxy.list(data.requests.fuzzy);
    await proxy.delete(data.ids.task);
    await proxy.restart(data.ids.task);

    expect(mocks.get.mock.calls[0]).toHaveLength(2);
    expect(mocks.del.mock.calls[0]).toHaveLength(2);
    expect(mocks.post.mock.calls[0]).toHaveLength(2);
  });
});
