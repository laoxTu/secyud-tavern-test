import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessError } from '@/interceptors';

const mocks = vi.hoisted(() => ({
  repo: {
    create: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
  },
}));

// 只把仓库层换掉，deserializeMimeType 等 files 上的真实实现保留
vi.mock('@/files/server', async (importOriginal) => {
  const actual = await importOriginal<{ files: Record<string, any> }>();
  return { files: { ...actual.files, repository: mocks.repo } };
});
// 避免真实打开 sqlite 文件
vi.mock('@/database/server', () => ({
  databases: {
    db: {},
    get: vi.fn(),
    exists: vi.fn(),
    query: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('@/database/server/provider', () => ({
  dbProvider: {
    client: {},
    db: {},
    migrate: vi.fn(),
    url: 'file::memory:',
    migrationsFolder: '',
  },
}));
// route 只负责拦截器编排，这里直接暴露处理函数
vi.mock('@/interceptors/server', () => ({
  route: (handler: unknown) => handler,
}));

import api from '@/files/server/api';

const handlers = api.files as any;

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
  return handler(options.request ?? new Request('http://localhost/api/files'), {
    params: Promise.resolve(options.params ?? {}),
    searchParams: options.searchParams ?? {},
  });
}

/**
 * jsdom 的 File 与 Node 的 Request 互不兼容，
 * 这里只伪造 handler 用到的那一小部分（formData().get 拿到的文件）
 */
function uploadRequest(upload: { type: string; bytes: number[] }) {
  const file = {
    type: upload.type,
    arrayBuffer: async () => new Uint8Array(upload.bytes).buffer,
  };
  return {
    formData: async () => ({ get: () => file }),
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('files api / 上传', () => {
  it('POST 应当把 mime 拆成 type/args，并把字节交给仓库', async () => {
    const data = await loadCases();
    const upload = data.uploads.withArgs;
    mocks.repo.create.mockResolvedValue(data.createdId);

    const response = await call(handlers.POST, {
      request: uploadRequest(upload),
    });

    expect(mocks.repo.create).toHaveBeenCalledWith({
      ...upload.mime,
      buffer: Buffer.from(upload.bytes),
    });
    await expect(response.json()).resolves.toEqual({ id: data.createdId });
  });

  it('没有 mime 参数时 args 应当是 null', async () => {
    const data = await loadCases();
    const upload = data.uploads.noArgs;

    await call(handlers.POST, { request: uploadRequest(upload) });

    expect(mocks.repo.create).toHaveBeenCalledWith({
      type: upload.mime.type,
      args: null,
      buffer: Buffer.from(upload.bytes),
    });
  });

  it('多个 mime 参数应当拼成一个 args', async () => {
    const data = await loadCases();
    const upload = data.uploads.multiArgs;

    await call(handlers.POST, { request: uploadRequest(upload) });

    expect(mocks.repo.create).toHaveBeenCalledWith({
      type: upload.mime.type,
      args: upload.mime.args,
      buffer: Buffer.from(upload.bytes),
    });
  });

  it('仓库抛错时应当原样抛出（handler 不吞异常）', async () => {
    const data = await loadCases();
    const error = new BusinessError('create failed', 'error.create');
    mocks.repo.create.mockRejectedValue(error);

    await expect(
      call(handlers.POST, { request: uploadRequest(data.uploads.withArgs) }),
    ).rejects.toBe(error);
  });
});

describe('files api / 列表', () => {
  it('GET 应当把 searchParams 原样交给仓库并返回分页结果', async () => {
    const data = await loadCases();
    mocks.repo.list.mockResolvedValue(data.listResponse);

    const response = await call(handlers.GET, {
      searchParams: data.listRequest,
    });

    expect(mocks.repo.list).toHaveBeenCalledWith(data.listRequest);
    await expect(response.json()).resolves.toEqual(data.listResponse);
  });

  it('没有查询参数时也应当把空对象交给仓库', async () => {
    const data = await loadCases();
    mocks.repo.list.mockResolvedValue(data.listResponse);

    await call(handlers.GET);

    expect(mocks.repo.list).toHaveBeenCalledWith({});
  });
});

describe('files api / 按 id 读取', () => {
  it('GET /[id] 应当只取元数据并返回 json', async () => {
    const data = await loadCases();
    mocks.repo.get.mockResolvedValue(data.file);

    const response = await call(handlers['[id]'].GET, {
      params: { id: data.file.id },
    });

    expect(mocks.repo.get).toHaveBeenCalledWith(data.file.id, false);
    await expect(response.json()).resolves.toEqual(data.file);
  });

  it('GET /[id]/resource 应当取字节并带上 content-type 与 inline 头', async () => {
    const data = await loadCases();
    mocks.repo.get.mockResolvedValue({
      ...data.file,
      buffer: Buffer.from(data.fileBytes),
    });

    const response = await call(handlers['[id]'].resource.GET, {
      params: { id: data.file.id },
    });

    expect(mocks.repo.get).toHaveBeenCalledWith(data.file.id, true);
    expect(response.headers.get('content-type')).toBe(data.file.type);
    expect(response.headers.get('content-disposition')).toBe(
      `inline; filename*=UTF-8''${encodeURIComponent(data.file.id)}`,
    );
    await expect(response.arrayBuffer()).resolves.toEqual(
      Buffer.from(data.fileBytes).buffer,
    );
  });

  it('缺少 id 时 handler 不做校验，原样交给仓库', async () => {
    await call(handlers['[id]'].GET, { params: {} });

    expect(mocks.repo.get).toHaveBeenCalledWith(undefined, false);
  });

  it('仓库报实体不存在时应当原样抛出', async () => {
    const data = await loadCases();
    const error = new BusinessError(
      'entity not found',
      'default.entity_not_found',
    );
    mocks.repo.get.mockRejectedValue(error);

    await expect(
      call(handlers['[id]'].GET, { params: { id: data.file.id } }),
    ).rejects.toBe(error);
  });
});

describe('files api / 删除', () => {
  it('DELETE /[id] 应当把 id 交给仓库，并把仓库返回值当 json 返回', async () => {
    const data = await loadCases();
    mocks.repo.delete.mockResolvedValue(null);

    const response = await call(handlers['[id]'].DELETE, {
      params: { id: data.file.id },
    });

    expect(mocks.repo.delete).toHaveBeenCalledWith(data.file.id);
    await expect(response.json()).resolves.toBeNull();
  });

  it('仓库报实体不存在时应当原样抛出', async () => {
    const data = await loadCases();
    const error = new BusinessError(
      'entity not found',
      'default.entity_not_found',
    );
    mocks.repo.delete.mockRejectedValue(error);

    await expect(
      call(handlers['[id]'].DELETE, { params: { id: data.file.id } }),
    ).rejects.toBe(error);
  });
});
