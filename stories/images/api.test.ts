import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessError } from '@/interceptors';
import { images } from '@/stories/images';

const mocks = vi.hoisted(() => ({
  filesRepo: { create: vi.fn() },
  repo: { entry: { add: vi.fn() } },
}));

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
// 只把文件仓库换掉，deserializeMimeType 等 files 上的真实实现保留
vi.mock('@/files/server', async (importOriginal) => {
  const actual = await importOriginal<{ files: Record<string, any> }>();
  return { files: { ...actual.files, repository: mocks.filesRepo } };
});
vi.mock('@/stories/server', () => ({
  stories: { repository: mocks.repo },
}));
// route 只负责拦截器编排，这里直接暴露处理函数
vi.mock('@/interceptors/server', () => ({
  route: (handler: unknown) => handler,
}));

import { image } from '@/stories/images/server/api';

const handler = (image as any).POST;

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./api.cases.json')).default);
}

type Upload = {
  name?: string;
  mime?: string;
  bytes: number[];
  expected: { type: string; args: string | null };
};

/**
 * jsdom 的 File 与 Node 的 Request 互不兼容，
 * 这里只伪造 handler 用到的那一小部分（formData().get 拿到的文件与名字）
 */
function uploadRequest(upload: Upload) {
  const file = {
    type: upload.mime,
    arrayBuffer: async () => new Uint8Array(upload.bytes).buffer,
  };
  const data = {
    get: (name: string) =>
      name === 'image' ? file : name === 'name' ? (upload.name ?? null) : null,
  };
  return { formData: async () => data } as unknown as Request;
}

/** 按 Next.js 的签名调用处理函数（route 已被替换为直通） */
function call(options: { request: Request; params?: Record<string, string> }) {
  return handler(options.request, {
    params: Promise.resolve(options.params ?? {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stories images api / 上传', () => {
  it('应当拆分 mime、把字节交给文件仓库，并登记一条 image 条目', async () => {
    const data = await loadCases();
    const upload: Upload = data.uploads.withArgs;
    mocks.filesRepo.create.mockResolvedValue(data.fileId);
    mocks.repo.entry.add.mockResolvedValue(1);

    const response = await call({
      request: uploadRequest(upload),
      params: { id: data.storyId },
    });

    expect(mocks.filesRepo.create).toHaveBeenCalledWith({
      ...upload.expected,
      buffer: Buffer.from(upload.bytes),
    });

    expect(mocks.repo.entry.add).toHaveBeenCalledTimes(1);
    const [masterId, entryType, entry] = mocks.repo.entry.add.mock.calls[0];
    expect(masterId).toBe(data.storyId);
    expect(entryType).toBe(images.name);
    expect(entry).toMatchObject({
      data: { image: data.fileId },
      masterId: data.storyId,
      entryType: images.name,
      entryId: 0,
      name: upload.name,
    });
    // updateAt 是调用时刻的日期字符串
    expect(typeof entry.data.updateAt).toBe('string');
    expect(Number.isNaN(Date.parse(entry.data.updateAt))).toBe(false);

    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it('mime 没有参数时 args 应当是 null', async () => {
    const data = await loadCases();
    const upload: Upload = data.uploads.noArgs;
    mocks.filesRepo.create.mockResolvedValue(data.fileId);

    await call({
      request: uploadRequest(upload),
      params: { id: data.storyId },
    });

    expect(upload.expected.args).toBeNull();
    expect(mocks.filesRepo.create).toHaveBeenCalledWith({
      ...upload.expected,
      buffer: Buffer.from(upload.bytes),
    });
  });

  it('文件没有 type 时应当落成空 type', async () => {
    const data = await loadCases();
    const upload: Upload = data.uploads.noMime;
    mocks.filesRepo.create.mockResolvedValue(data.fileId);

    await call({
      request: uploadRequest(upload),
      params: { id: data.storyId },
    });

    expect(mocks.filesRepo.create).toHaveBeenCalledWith({
      ...upload.expected,
      buffer: Buffer.from(upload.bytes),
    });
  });

  it('表单没有 name 字段时条目名应当照原样写入（当前为 null）', async () => {
    const data = await loadCases();
    const upload: Upload = data.uploads.noName;
    mocks.filesRepo.create.mockResolvedValue(data.fileId);

    await call({
      request: uploadRequest(upload),
      params: { id: data.storyId },
    });

    const entry = mocks.repo.entry.add.mock.calls[0][2];
    expect(entry.name).toBeNull();
  });

  it('缺少 id 参数时 handler 不做校验，原样交给仓库', async () => {
    const data = await loadCases();
    const upload: Upload = data.uploads.noArgs;
    mocks.filesRepo.create.mockResolvedValue(data.fileId);

    await call({ request: uploadRequest(upload) });

    expect(mocks.repo.entry.add).toHaveBeenCalledWith(
      undefined,
      images.name,
      expect.objectContaining({ masterId: undefined }),
    );
  });
});

describe('stories images api / 错误路径', () => {
  it('文件仓库抛错时应当原样抛出', async () => {
    const data = await loadCases();
    const error = new BusinessError('create failed', 'error.create');
    mocks.filesRepo.create.mockRejectedValue(error);

    await expect(
      call({
        request: uploadRequest(data.uploads.withArgs),
        params: { id: data.storyId },
      }),
    ).rejects.toBe(error);
    expect(mocks.repo.entry.add).not.toHaveBeenCalled();
  });

  it('条目仓库抛错时应当原样抛出', async () => {
    const data = await loadCases();
    const error = new BusinessError('add failed', 'error.add');
    mocks.filesRepo.create.mockResolvedValue(data.fileId);
    mocks.repo.entry.add.mockRejectedValue(error);

    await expect(
      call({
        request: uploadRequest(data.uploads.withArgs),
        params: { id: data.storyId },
      }),
    ).rejects.toBe(error);
  });
});
