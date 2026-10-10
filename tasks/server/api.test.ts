import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  manager: {
    delete: vi.fn(),
    restart: vi.fn(),
  },
  repository: {
    list: vi.fn(),
    history: { list: vi.fn() },
  },
}));

// 调度与仓库都替换掉，用例只关心 handler 的入参来源与返回值
vi.mock('@/tasks/server', () => ({
  tasks: { manager: mocks.manager, repository: mocks.repository },
}));
// route 只负责拦截器编排，这里直接暴露处理函数
vi.mock('@/interceptors/server', () => ({
  route: (handler: unknown) => handler,
}));

import api from '@/tasks/server/api';

const handlers = (api as any).tasks;

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./api.cases.json')).default);
}

/** 按 Next.js 的签名调用处理函数（route 已被替换为直通） */
function call(
  handler: any,
  options: {
    request?: Request;
    params?: Record<string, string>;
    searchParams?: Record<string, any>;
  } = {},
) {
  return handler(options.request ?? new Request('http://localhost/api/tasks'), {
    params: Promise.resolve(options.params ?? {}),
    searchParams: options.searchParams ?? {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tasks api / 列表', () => {
  it('GET 应当把 searchParams 原样交给仓库并返回 json', async () => {
    const data = await loadCases();
    mocks.repository.list.mockResolvedValue(data.listResponse);

    const response = await call(handlers.GET, {
      searchParams: data.searchParams,
    });

    // 原样透传，不做客户端那样的 search() 包装
    expect(mocks.repository.list).toHaveBeenCalledTimes(1);
    expect(mocks.repository.list.mock.calls[0][0]).toBe(data.searchParams);
    expect(response.headers.get('content-type')).toContain(
      'application/json',
    );
    await expect(response.json()).resolves.toEqual(data.listResponse);
  });

  it('GET 没有查询条件时也应当调用仓库', async () => {
    const data = await loadCases();
    mocks.repository.list.mockResolvedValue(data.listResponse);

    const response = await call(handlers.GET);

    expect(mocks.repository.list).toHaveBeenCalledWith({});
    await expect(response.json()).resolves.toEqual(data.listResponse);
  });
});

describe('tasks api / 删除与重启', () => {
  it('DELETE /[id] 应当按 params 里的 id 删除并返回 null', async () => {
    const data = await loadCases();

    const response = await call(handlers['[id]'].DELETE, {
      params: { id: data.id },
    });

    expect(mocks.manager.delete).toHaveBeenCalledWith(data.id);
    await expect(response.json()).resolves.toBeNull();
  });

  it('POST /[id]/restart 应当按 params 里的 id 重启并返回 null', async () => {
    const data = await loadCases();

    const response = await call(handlers['[id]'].restart.POST, {
      params: { id: data.id },
    });

    expect(mocks.manager.restart).toHaveBeenCalledWith(data.id);
    await expect(response.json()).resolves.toBeNull();
  });

  it('两个写操作都不读请求体', async () => {
    const data = await loadCases();
    const request = new Request(`http://localhost/api/tasks/${data.id}`, {
      method: 'POST',
      body: JSON.stringify({ name: 'ignored' }),
      headers: { 'content-type': 'application/json' },
    });

    await call(handlers['[id]'].DELETE, {
      request,
      params: { id: data.id },
    });
    await call(handlers['[id]'].restart.POST, {
      request,
      params: { id: data.id },
    });

    expect(mocks.manager.delete).toHaveBeenCalledWith(data.id);
    expect(mocks.manager.restart).toHaveBeenCalledWith(data.id);
    // 请求体没有被读取过
    expect(request.bodyUsed).toBe(false);
  });
});

describe('tasks api / 历史', () => {
  it('GET /[id]/histories 应当按 id 取历史并返回 json', async () => {
    const data = await loadCases();
    mocks.repository.history.list.mockResolvedValue(data.historyResponse);

    const response = await call(handlers['[id]'].histories.GET, {
      params: { id: data.id },
    });

    expect(mocks.repository.history.list).toHaveBeenCalledWith(data.id);
    await expect(response.json()).resolves.toEqual(data.historyResponse);
  });

  it('历史为空时应当返回空数组', async () => {
    const data = await loadCases();
    mocks.repository.history.list.mockResolvedValue([]);

    const response = await call(handlers['[id]'].histories.GET, {
      params: { id: data.id },
    });

    await expect(response.json()).resolves.toEqual([]);
  });
});
