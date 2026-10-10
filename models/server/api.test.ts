import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  repo: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    exist: vi.fn(),
  },
  generate: vi.fn(),
  pack: vi.fn(),
}));

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
vi.mock('@/models/server/repository', () => ({ repository: mocks.repo }));
vi.mock('@/models/server/engine', () => ({
  engines: { registry: { records: {} }, generate: mocks.generate },
}));
// 只替换打包函数，其余信号工具保持真实实现
vi.mock('@/signal', async (importOriginal) => {
  const actual = await importOriginal<{ sseUtils: Record<string, unknown> }>();
  return {
    ...actual,
    sseUtils: { ...actual.sseUtils, pack: mocks.pack },
  };
});
// route 只负责拦截器编排，这里直接暴露处理函数
vi.mock('@/interceptors/server', () => ({
  route: (handler: unknown) => handler,
}));

import api from '@/models/server/api';

const handlers = (api as any).models;

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./api.cases.json')).default);
}

async function loadModel() {
  return structuredClone((await import('../model.json')).default);
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
  return handler(
    options.request ?? new Request('http://localhost/api/models'),
    {
      params: Promise.resolve(options.params ?? {}),
      searchParams: options.searchParams ?? {},
    },
  );
}

function jsonRequest(url: string, body: unknown, method = 'POST') {
  return new Request(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('models api / 模型 CRUD', () => {
  it('GET 列表应当把查询参数交给仓库', async () => {
    const data = await loadCases();
    mocks.repo.list.mockResolvedValue({ items: [], length: 0 });

    const response = await call(handlers.GET, {
      searchParams: data.listRequest,
    });

    expect(mocks.repo.list).toHaveBeenCalledWith(data.listRequest);
    await expect(response.json()).resolves.toEqual({ items: [], length: 0 });
  });

  it('POST 应当剥掉 key 与 iv 后再创建', async () => {
    const data = await loadCases();
    mocks.repo.create.mockResolvedValue(data.newId);

    const response = await call(handlers.POST, {
      request: jsonRequest('http://localhost/api/models', data.createBody),
    });

    const created = mocks.repo.create.mock.calls[0][0];
    expect(created.name).toBe(data.createBody.name);
    expect(created.key).toBeUndefined();
    expect(created.iv).toBeUndefined();
    await expect(response.json()).resolves.toEqual({ id: data.newId });
  });

  it('GET /[id] 应当按 id 读取并返回模型', async () => {
    const model = await loadModel();
    mocks.repo.get.mockResolvedValue(model);

    const response = await call(handlers['[id]'].GET, {
      params: { id: model.id },
    });

    expect(mocks.repo.get).toHaveBeenCalledWith(model.id);
    await expect(response.json()).resolves.toMatchObject({ id: model.id });
  });

  it('PUT /[id] 应当更新并返回 null', async () => {
    const data = await loadCases();
    const model = await loadModel();

    const response = await call(handlers['[id]'].PUT, {
      params: { id: model.id },
      request: jsonRequest(
        `http://localhost/api/models/${model.id}`,
        data.updateBody,
        'PUT',
      ),
    });

    expect(mocks.repo.update).toHaveBeenCalledWith(model.id, data.updateBody);
    await expect(response.json()).resolves.toBeNull();
  });

  it('DELETE /[id] 应当删除并返回 null', async () => {
    const model = await loadModel();

    const response = await call(handlers['[id]'].DELETE, {
      params: { id: model.id },
    });

    expect(mocks.repo.delete).toHaveBeenCalledWith(model.id);
    await expect(response.json()).resolves.toBeNull();
  });
});

describe('models api / clone', () => {
  it('应当以源模型为底，用请求体覆盖并清空主键', async () => {
    const data = await loadCases();
    const model = await loadModel();
    mocks.repo.get.mockResolvedValue(model);
    mocks.repo.create.mockResolvedValue(data.newId);

    const response = await call(handlers['[id]'].clone.POST, {
      params: { id: model.id },
      request: jsonRequest(
        `http://localhost/api/models/${model.id}/clone`,
        data.cloneBody,
      ),
    });

    expect(mocks.repo.get).toHaveBeenCalledWith(model.id);
    const target = mocks.repo.create.mock.calls[0][0];
    expect(target.name).toBe(data.cloneBody.name);
    expect(target.iterations).toBe(model.iterations);
    expect(target.id).toBeNull();
    await expect(response.json()).resolves.toEqual({ id: data.newId });
  });
});

describe('models api / generate', () => {
  it('流式模型应当打包成 SSE 响应', async () => {
    const data = await loadCases();
    const model = { ...(await loadModel()), stream: true };
    mocks.repo.get.mockResolvedValue(model);
    mocks.generate.mockResolvedValue(data.result);
    mocks.pack.mockResolvedValue(data.packed);
    const request = jsonRequest(
      `http://localhost/api/models/${model.id}/engine/generate`,
      data.input,
    );

    const response = await call(handlers['[id]'].engine.generate.POST, {
      params: { id: model.id },
      request,
    });

    expect(mocks.generate).toHaveBeenCalledWith(
      model,
      data.input,
      request.signal,
    );
    expect(mocks.pack).toHaveBeenCalledWith(data.result);
    expect(response.headers.get('content-type')).toContain(
      'text/event-stream',
    );
    await expect(response.text()).resolves.toBe(data.packed);
  });

  it('非流式模型应当直接返回 json', async () => {
    const data = await loadCases();
    const model = { ...(await loadModel()), stream: false };
    mocks.repo.get.mockResolvedValue(model);
    mocks.generate.mockResolvedValue(data.result);

    const response = await call(handlers['[id]'].engine.generate.POST, {
      params: { id: model.id },
      request: jsonRequest(
        `http://localhost/api/models/${model.id}/engine/generate`,
        data.input,
      ),
    });

    expect(mocks.pack).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual(data.result);
  });
});
