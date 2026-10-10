import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  /** import 分支按 code 查重的链式调用终点 */
  const findByCode = vi.fn();
  const dbSelect = vi.fn(() => ({
    from: () => ({ where: () => ({ get: findByCode }) }),
  }));
  return {
    findByCode,
    dbSelect,
    modelRepo: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      exist: vi.fn(),
    },
    getDownloadParams: vi.fn(),
    taskCreate: vi.fn(),
    /** src/comfyui/server/importers.ts 里注册的任务 id */
    taskProviderId: 'comfyui-model-download',
  };
});

// 不连真实 sqlite：import 分支的按 code 查重自己拼一条最小链
vi.mock('@/database/server', () => ({
  databases: { db: { select: mocks.dbSelect } },
}));
// schema 会经 @/database/server/factory 加载 provider，避免真实创建 libsql client
vi.mock('@/database/server/provider', () => ({
  dbProvider: {
    client: {},
    db: {},
    migrate: vi.fn(),
    url: 'file::memory:',
    migrationsFolder: '',
  },
}));
vi.mock('@/comfyui/server', () => ({
  comfyuis: { repository: { model: mocks.modelRepo } },
}));
vi.mock('@/comfyui/server/importers', () => ({
  getDownloadParams: mocks.getDownloadParams,
  importers: { tasks: { id: mocks.taskProviderId } },
}));
vi.mock('@/tasks/server', () => ({
  tasks: { manager: { create: mocks.taskCreate } },
}));
// route 只负责拦截器编排，这里直接暴露处理函数
vi.mock('@/interceptors/server', () => ({
  route: (handler: unknown) => handler,
}));

import { models } from '@/comfyui/server/api-models';

const handlers = models as any;

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./api-models.cases.json')).default);
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
    options.request ?? new Request('http://localhost/api/comfyuis/models'),
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

describe('comfyui api-models / 模型 CRUD', () => {
  it('GET 列表应当把查询参数原样交给仓库', async () => {
    const data = await loadCases();
    mocks.modelRepo.list.mockResolvedValue(data.listResponse);

    const response = await call(handlers.GET, { searchParams: data.listRequest });

    expect(mocks.modelRepo.list).toHaveBeenCalledWith(data.listRequest);
    await expect(response.json()).resolves.toEqual(data.listResponse);
  });

  it('POST 应当用请求体创建模型并返回 id', async () => {
    const data = await loadCases();
    mocks.modelRepo.create.mockResolvedValue(data.createdId);

    const response = await call(handlers.POST, {
      request: jsonRequest(
        'http://localhost/api/comfyuis/models',
        data.createBody,
      ),
    });

    expect(mocks.modelRepo.create).toHaveBeenCalledWith(data.createBody);
    await expect(response.json()).resolves.toEqual({ id: data.createdId });
  });

  it('GET /[id] 应当按 id 读取并返回模型', async () => {
    const data = await loadCases();
    mocks.modelRepo.get.mockResolvedValue(data.model);

    const response = await call(handlers['[id]'].GET, {
      params: { id: data.model.id },
    });

    expect(mocks.modelRepo.get).toHaveBeenCalledWith(data.model.id);
    await expect(response.json()).resolves.toEqual(data.model);
  });

  it('PUT /[id] 应当把路径 id 与请求体分别传给仓库', async () => {
    const data = await loadCases();
    mocks.modelRepo.update.mockResolvedValue(data.updatedId);

    const response = await call(handlers['[id]'].PUT, {
      params: { id: data.model.id },
      request: jsonRequest(
        `http://localhost/api/comfyuis/models/${data.model.id}`,
        data.updateBody,
        'PUT',
      ),
    });

    expect(mocks.modelRepo.update).toHaveBeenCalledWith(
      data.model.id,
      data.updateBody,
    );
    await expect(response.json()).resolves.toEqual({ id: data.updatedId });
  });

  it('DELETE /[id] 应当删除并返回 null', async () => {
    const data = await loadCases();

    const response = await call(handlers['[id]'].DELETE, {
      params: { id: data.model.id },
    });

    expect(mocks.modelRepo.delete).toHaveBeenCalledWith(data.model.id);
    await expect(response.json()).resolves.toBeNull();
  });
});

describe('comfyui api-models / import', () => {
  it('code 已存在时应当更新原记录，不存在的才新建', async () => {
    const data = await loadCases();
    const [existing, fresh] = data.importModels;
    mocks.findByCode
      .mockResolvedValueOnce({ id: data.existingId })
      .mockResolvedValueOnce(undefined);
    mocks.modelRepo.create.mockResolvedValue(data.importedId);

    const response = await call(handlers.import.POST, {
      request: jsonRequest(
        'http://localhost/api/comfyuis/models/import',
        data.importModels,
      ),
    });

    // 逐个 code 查重
    expect(mocks.dbSelect).toHaveBeenCalledTimes(data.importModels.length);
    expect(mocks.findByCode).toHaveBeenCalledTimes(data.importModels.length);
    expect(mocks.modelRepo.update).toHaveBeenCalledWith(
      data.existingId,
      existing,
    );
    expect(mocks.modelRepo.create).toHaveBeenCalledWith(fresh);
    await expect(response.json()).resolves.toEqual([
      { id: data.existingId },
      { id: data.importedId },
    ]);
  });

  it('空数组时不应查库也不应写入', async () => {
    const response = await call(handlers.import.POST, {
      request: jsonRequest('http://localhost/api/comfyuis/models/import', []),
    });

    expect(mocks.dbSelect).not.toHaveBeenCalled();
    expect(mocks.modelRepo.create).not.toHaveBeenCalled();
    expect(mocks.modelRepo.update).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual([]);
  });
});

describe('comfyui api-models / download', () => {
  it('应当用模型 code 命名下载任务，并只把 id 交给任务层', async () => {
    const data = await loadCases();
    mocks.getDownloadParams.mockResolvedValue({
      model: data.downloadModel,
      filename: `models/checkpoints/${data.downloadModel.path}`,
    });

    const response = await call(handlers['[id]'].download.POST, {
      params: { id: data.downloadModel.id },
    });

    expect(mocks.getDownloadParams).toHaveBeenCalledWith(data.downloadModel.id);
    expect(mocks.taskCreate).toHaveBeenCalledWith(
      `download ${data.downloadModel.code}`,
      { provider: mocks.taskProviderId, id: data.downloadModel.id },
    );
    await expect(response.json()).resolves.toBeNull();
  });
});

describe('comfyui api-models / 错误', () => {
  it('仓库抛错时应当原样抛出（handler 不吞异常）', async () => {
    const data = await loadCases();
    const error = new Error('model.id not found');
    mocks.modelRepo.get.mockRejectedValue(error);

    await expect(
      call(handlers['[id]'].GET, { params: { id: data.model.id } }),
    ).rejects.toBe(error);
  });
});
