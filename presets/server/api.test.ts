import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Preset, PresetEntry } from '@/presets';
import { cache } from '@/utils/server';

const mocks = vi.hoisted(() => ({
  repo: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    exist: vi.fn(),
    traversal: vi.fn(),
    entry: {
      list: vi.fn(),
      get: vi.fn(),
      add: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      make: vi.fn(),
      types: vi.fn(),
    },
  },
  storage: {
    save: vi.fn(),
    load: vi.fn(),
    loadArchive: vi.fn(),
    saveArchive: vi.fn(),
    registry: { register: vi.fn(), use: vi.fn() },
    manager: { load: vi.fn(), save: vi.fn(), criteria: vi.fn() },
  },
  archives: {
    zipToArchive: vi.fn(),
    archiveToZip: vi.fn(),
  },
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
vi.mock('@/presets/server/repository', () => ({ repository: mocks.repo }));
vi.mock('@/presets/server/storage', () => ({ storage: mocks.storage }));
// 只替换 zip 相关函数，archives.get/set 仍然用真实实现
vi.mock('@/utils/archive', async (importOriginal) => {
  const actual = await importOriginal<{ archives: Record<string, unknown> }>();
  return {
    ...actual,
    archives: { ...actual.archives, ...mocks.archives },
  };
});
// route 只负责拦截器编排，这里直接暴露处理函数
vi.mock('@/interceptors/server', () => ({
  route: (handler: unknown) => handler,
}));

import api from '@/presets/server/api';

const handlers = api.presets as any;

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
  return handler(
    options.request ?? new Request('http://localhost/api/presets'),
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

function entryHandler(head: string, method: string) {
  return handlers['[id]'].entries['[entryType]']['[entryId]'][head][method];
}

async function importKey() {
  const data = await loadCases();
  return `preset_import_${data.sessionId}`;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await cache.delete(await importKey());
});

describe('presets api / 预设 CRUD', () => {
  it('GET 列表应当把查询参数交给仓库', async () => {
    const data = await loadCases();
    mocks.repo.list.mockResolvedValue({ items: [], length: 0 });

    const response = await call(handlers.GET, {
      searchParams: data.listRequest,
    });

    expect(mocks.repo.list).toHaveBeenCalledWith(data.listRequest);
    await expect(response.json()).resolves.toEqual({ items: [], length: 0 });
  });

  it('POST 应当用请求体创建预设并返回 id', async () => {
    const data = await loadCases();
    mocks.repo.create.mockResolvedValue(data.preset.id);

    const response = await call(handlers.POST, {
      request: jsonRequest('http://localhost/api/presets', data.preset),
    });

    expect(mocks.repo.create).toHaveBeenCalledWith(data.preset);
    await expect(response.json()).resolves.toEqual({ id: data.preset.id });
  });

  it('GET /[id] 应当把查询参数当作选项透传', async () => {
    const data = await loadCases();
    mocks.repo.get.mockResolvedValue(data.preset);

    const response = await call(handlers['[id]'].GET, {
      params: { id: data.preset.id },
      searchParams: data.listRequest,
    });

    expect(mocks.repo.get).toHaveBeenCalledWith(
      data.preset.id,
      data.listRequest,
    );
    await expect(response.json()).resolves.toMatchObject({
      id: data.preset.id,
    });
  });

  it('PUT /[id] 应当更新并返回生效 id', async () => {
    const data = await loadCases();
    mocks.repo.update.mockResolvedValue(data.preset.id);

    const response = await call(handlers['[id]'].PUT, {
      params: { id: data.preset.id },
      request: jsonRequest(
        'http://localhost/api/presets/p1',
        data.updateBody,
      ),
    });

    expect(mocks.repo.update).toHaveBeenCalledWith(
      data.preset.id,
      data.updateBody,
    );
    await expect(response.json()).resolves.toEqual({ id: data.preset.id });
  });

  it('DELETE /[id] 应当删除并返回 null', async () => {
    const data = await loadCases();

    const response = await call(handlers['[id]'].DELETE, {
      params: { id: data.preset.id },
    });

    expect(mocks.repo.delete).toHaveBeenCalledWith(data.preset.id);
    await expect(response.json()).resolves.toBeNull();
  });
});

describe('presets api / clone', () => {
  it('应当复制预设本体，并按条目类型整组复制', async () => {
    const data = await loadCases();
    mocks.repo.get.mockResolvedValue(data.preset);
    mocks.repo.create.mockResolvedValue('p2');
    mocks.repo.entry.list.mockResolvedValue({
      items: data.entries,
      length: data.entries.length,
    });

    const response = await call(handlers['[id]'].clone.POST, {
      params: { id: data.preset.id },
      request: jsonRequest(
        'http://localhost/api/presets/p1/clone',
        data.cloneBody,
      ),
    });

    expect(mocks.repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: data.preset.id, name: data.cloneBody.name }),
    );
    expect(mocks.repo.entry.list).toHaveBeenCalledWith(data.preset.id);
    const calls = mocks.repo.entry.make.mock.calls;
    const macros = data.entries.filter((u) => u.entryType === 'macros');
    const styles = data.entries.filter((u) => u.entryType === 'styles');
    expect(calls.map((u) => u[0])).toEqual(['p2', 'p2']);
    expect(calls.map((u) => u[1]).sort()).toEqual(['macros', 'styles']);
    expect(calls.find((u) => u[1] === 'macros')![2]).toHaveLength(
      macros.length,
    );
    expect(calls.find((u) => u[1] === 'styles')![2]).toHaveLength(
      styles.length,
    );
    await expect(response.json()).resolves.toEqual({ id: 'p2' });
  });
});

describe('presets api / 条目', () => {
  it('GET 条目列表应当把 id 与查询参数分别传入', async () => {
    const data = await loadCases();
    mocks.repo.entry.list.mockResolvedValue({ items: [], length: 0 });

    await call(handlers['[id]'].entries.GET, {
      params: { id: data.preset.id },
      searchParams: data.entryListRequest,
    });

    expect(mocks.repo.entry.list).toHaveBeenCalledWith(
      data.preset.id,
      data.entryListRequest,
    );
  });

  it('POST 条目应当返回 entryId', async () => {
    const data = await loadCases();
    mocks.repo.entry.add.mockResolvedValue(data.entry.entryId);

    const response = await call(handlers['[id]'].entries['[entryType]'].POST, {
      params: { id: data.preset.id, entryType: data.entry.entryType },
      request: jsonRequest('http://localhost/api/presets/p1/entries', {
        name: data.entryBody.name,
      }),
    });

    expect(mocks.repo.entry.add).toHaveBeenCalledWith(
      data.preset.id,
      data.entry.entryType,
      { name: data.entryBody.name },
    );
    await expect(response.json()).resolves.toEqual({
      entryId: data.entry.entryId,
    });
  });

  it('条目 clone 缺少 masterId 时应当报错', async () => {
    const data = await loadCases();

    await expect(
      call(entryHandler('clone', 'POST'), {
        params: {
          id: data.preset.id,
          entryType: data.entry.entryType,
          entryId: `${data.entry.entryId}`,
        },
        request: jsonRequest(
          'http://localhost/api/presets/p1/entries/clone',
          data.entryWithoutMaster,
        ),
      }),
    ).rejects.toThrow(/masterId is not specified/);
  });

  it('条目 clone 应当把源条目合并到目标预设下', async () => {
    const data = await loadCases();
    mocks.repo.entry.get.mockResolvedValue(data.entry as PresetEntry);
    mocks.repo.entry.add.mockResolvedValue(9);

    const response = await call(entryHandler('clone', 'POST'), {
      params: {
        id: data.preset.id,
        entryType: data.entry.entryType,
        entryId: `${data.entry.entryId}`,
      },
      request: jsonRequest(
        'http://localhost/api/presets/p1/entries/clone',
        data.entryCloneBody,
      ),
    });

    expect(mocks.repo.entry.add).toHaveBeenCalledWith(
      data.entryCloneBody.masterId,
      data.entry.entryType,
      expect.objectContaining({
        name: data.entryCloneBody.name,
        masterId: data.entryCloneBody.masterId,
      }),
    );
    await expect(response.json()).resolves.toEqual({ entryId: 9 });
  });
});

describe('presets api / 导入导出', () => {
  it('import POST 应当解析 zip 并缓存解析结果', async () => {
    const data = await loadCases();
    mocks.archives.zipToArchive.mockResolvedValue({
      [data.preset.id]: data.archiveNode,
    });
    mocks.storage.save.mockResolvedValue(data.preset);
    // jsdom 的 File 与 Node 的 FormData 互不兼容，这里只伪造 handler 用到的那一小部分
    const upload = {
      arrayBuffer: async () => new Uint8Array(data.uploadBytes).buffer,
    };
    const request = {
      formData: async () => ({ get: () => upload }),
    } as unknown as Request;

    const response = await call(handlers.import.POST, {
      searchParams: { sessionId: data.sessionId },
      request,
    });

    expect(mocks.archives.zipToArchive).toHaveBeenCalledWith(
      expect.any(Buffer),
    );
    expect(mocks.storage.save).toHaveBeenCalledWith(
      expect.any(Object),
      data.archiveNode,
      expect.any(Function),
    );
    await expect(response.json()).resolves.toEqual([
      { name: `${data.preset.name}-${data.preset.version}`, value: data.preset.id },
    ]);
    // 解析结果进了缓存，供确认阶段使用
    await expect(cache.get(await importKey(), async () => [])).resolves.toHaveLength(
      1,
    );
  });

  it('import PUT 应当只写入选中的预设，已存在的先删后建', async () => {
    const data = await loadCases();
    await cache.set(await importKey(), data.cachedPresets);
    mocks.repo.exist.mockResolvedValue(true);
    mocks.repo.create.mockResolvedValue(data.preset.id);

    const response = await call(handlers.import.PUT, {
      searchParams: { sessionId: data.sessionId },
      request: jsonRequest(
        'http://localhost/api/presets/import',
        data.importSelection,
        'PUT',
      ),
    });

    expect(mocks.repo.exist).toHaveBeenCalledTimes(data.importSelection.length);
    expect(mocks.repo.delete).toHaveBeenCalledWith(data.importSelection[0]);
    expect(mocks.repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: data.importSelection[0] }),
    );
    await expect(response.json()).resolves.toEqual({
      id: data.preset.id,
    });
    // 缓存用完即删
    await expect(
      cache.get(await importKey(), async () => []),
    ).resolves.toEqual([]);
  });
});
