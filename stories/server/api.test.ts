import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validate } from 'uuid';

const mocks = vi.hoisted(() => ({
  repo: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getRealm: vi.fn(),
    history: {
      get: vi.fn(),
      add: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    },
    entry: {
      list: vi.fn(),
      make: vi.fn(),
      get: vi.fn(),
      add: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    },
  },
  storage: {
    registry: { register: vi.fn() },
    manager: { load: vi.fn(), save: vi.fn(), criteria: vi.fn() },
  },
  image: { POST: vi.fn() },
}));

// 避免真实打开 sqlite 文件（storage 的注册链会走到 factory 的 provider）
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
vi.mock('@/stories/server/repository', () => ({ repository: mocks.repo }));
vi.mock('@/stories/server/storage', () => ({ storage: mocks.storage }));
// 图片上传本身在 tests/stories/images/api.test.ts 覆盖，这里只验证挂载点
vi.mock('@/stories/images/server/api', () => ({ image: mocks.image }));
// route 只负责拦截器编排，这里直接暴露处理函数
vi.mock('@/interceptors/server', () => ({
  route: (handler: unknown) => handler,
}));

import api from '@/stories/server/api';

const handlers = (api as any).stories;

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./api.cases.json')).default);
}

async function loadStory() {
  return structuredClone((await import('./story.json')).default);
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
    options.request ?? new Request('http://localhost/api/stories'),
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

function entryHandler(head: 'GET' | 'PUT' | 'DELETE') {
  return handlers['[id]'].entries['[entryType]']['[entryId]'][head];
}

function entryCloneHandler() {
  return handlers['[id]'].entries['[entryType]']['[entryId]'].clone.POST;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stories api / 故事 CRUD', () => {
  it('GET 列表应当把查询参数交给仓库', async () => {
    const data = await loadCases();
    mocks.repo.list.mockResolvedValue(data.listResponse);

    const response = await call(handlers.GET, {
      searchParams: data.listRequest,
    });

    expect(mocks.repo.list).toHaveBeenCalledWith(data.listRequest);
    await expect(response.json()).resolves.toEqual(data.listResponse);
  });

  it('POST 应当用请求体创建并返回 id', async () => {
    const data = await loadCases();
    mocks.repo.create.mockResolvedValue(data.newId);

    const response = await call(handlers.POST, {
      request: jsonRequest('http://localhost/api/stories', data.createBody),
    });

    expect(mocks.repo.create).toHaveBeenCalledWith(data.createBody);
    await expect(response.json()).resolves.toEqual({ id: data.newId });
  });

  it('GET /[id] 应当把 searchParams 当作选项原样透传', async () => {
    const story = await loadStory();
    const data = await loadCases();
    mocks.repo.get.mockResolvedValue(story);

    const response = await call(handlers['[id]'].GET, {
      params: { id: story.id },
      searchParams: data.options,
    });

    expect(mocks.repo.get).toHaveBeenCalledWith(story.id, data.options);
    await expect(response.json()).resolves.toMatchObject({ id: story.id });
  });

  it('没有查询参数时选项应当是空对象', async () => {
    const story = await loadStory();
    mocks.repo.get.mockResolvedValue(story);

    await call(handlers['[id]'].GET, { params: { id: story.id } });

    expect(mocks.repo.get).toHaveBeenCalledWith(story.id, {});
  });

  it('PUT /[id] 应当更新并返回生效 id', async () => {
    const data = await loadCases();
    const story = await loadStory();
    mocks.repo.update.mockResolvedValue(story.id);

    const response = await call(handlers['[id]'].PUT, {
      params: { id: story.id },
      request: jsonRequest(
        `http://localhost/api/stories/${story.id}`,
        data.updateBody,
        'PUT',
      ),
    });

    expect(mocks.repo.update).toHaveBeenCalledWith(story.id, data.updateBody);
    await expect(response.json()).resolves.toEqual({ id: story.id });
  });

  it('DELETE /[id] 应当删除并返回 null', async () => {
    const story = await loadStory();

    const response = await call(handlers['[id]'].DELETE, {
      params: { id: story.id },
    });

    expect(mocks.repo.delete).toHaveBeenCalledWith(story.id);
    await expect(response.json()).resolves.toBeNull();
  });
});

describe('stories api / realm', () => {
  it('realm POST 应当用请求体直接组装 realm', async () => {
    const data = await loadCases();
    const story = await loadStory();
    mocks.repo.getRealm.mockResolvedValue(data.realm);

    const response = await call(handlers.realm.POST, {
      request: jsonRequest('http://localhost/api/stories/realm', story),
    });

    expect(mocks.repo.getRealm).toHaveBeenCalledWith(story);
    await expect(response.json()).resolves.toEqual(data.realm);
  });

  it('realm GET /[id] 应当先取实体再组装 realm', async () => {
    const data = await loadCases();
    const story = await loadStory();
    mocks.repo.get.mockResolvedValue(story);
    mocks.repo.getRealm.mockResolvedValue(data.realm);

    const response = await call(handlers.realm['[id]'].GET, {
      params: { id: story.id },
    });

    expect(mocks.repo.get).toHaveBeenCalledWith(story.id, { entities: true });
    expect(mocks.repo.getRealm).toHaveBeenCalledWith(story);
    await expect(response.json()).resolves.toEqual(data.realm);
  });

  it('realm GET /[id] 取不到实体时应当由 handler 抛实体不存在', async () => {
    const story = await loadStory();
    mocks.repo.get.mockResolvedValue(undefined);

    await expect(
      call(handlers.realm['[id]'].GET, { params: { id: story.id } }),
    ).rejects.toThrow('entity not found');
    expect(mocks.repo.getRealm).not.toHaveBeenCalled();
  });
});

describe('stories api / clone', () => {
  // 语义由源码注释明确：故事克隆是「新存档」，只复制故事本体，
  // 有意不复制条目、也不消费请求体（与 presets 的 clone 不同）。
  it('应当只克隆故事本体：换新 id、不复制条目、忽略请求体', async () => {
    const data = await loadCases();
    const story = await loadStory();
    mocks.repo.get.mockResolvedValue(story);
    // 真实 create 返回写入用的 id（见 repository.create），这里如实模拟
    mocks.repo.create.mockImplementation(async (target: any) => target.id);
    // 即便源故事有条目，也不应该被复制
    mocks.repo.entry.list.mockResolvedValue(data.cloneEntries);

    const response = await call(handlers['[id]'].clone.POST, {
      params: { id: story.id },
      request: jsonRequest(
        `http://localhost/api/stories/${story.id}/clone`,
        data.cloneBody,
      ),
    });

    expect(mocks.repo.get).toHaveBeenCalledWith(story.id);

    const created = mocks.repo.create.mock.calls[0][0];
    // 请求体被忽略：改名不生效，名字仍来自源故事
    expect(created.name).toBe(story.name);
    expect(created.name).not.toBe(data.cloneBody.name);
    // 源故事的其余字段保留
    expect(created.presets).toEqual(story.presets);
    expect(created.model).toEqual(story.model);
    // 必须换新 id：不能沿用源故事的 id
    expect(created.id).not.toBe(story.id);
    expect(validate(created.id)).toBe(true);

    // 有意不复制条目
    expect(mocks.repo.entry.list).not.toHaveBeenCalled();
    expect(mocks.repo.entry.make).not.toHaveBeenCalled();

    await expect(response.json()).resolves.toEqual({ id: created.id });
  });

  it('请求体为空时同样不报错，仍按源故事克隆', async () => {
    const story = await loadStory();
    mocks.repo.get.mockResolvedValue(story);
    mocks.repo.create.mockImplementation(async (target: any) => target.id);

    const response = await call(handlers['[id]'].clone.POST, {
      params: { id: story.id },
      request: new Request(`http://localhost/api/stories/${story.id}/clone`, {
        method: 'POST',
      }),
    });

    const created = mocks.repo.create.mock.calls[0][0];
    expect(created.name).toBe(story.name);
    expect(created.presets).toEqual(story.presets);
    expect(created.id).not.toBe(story.id);
    expect(validate(created.id)).toBe(true);
    expect(mocks.repo.entry.make).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ id: created.id });
  });
});

describe('stories api / histories', () => {
  it('POST 应当按 id 追加历史并返回序号', async () => {
    const data = await loadCases();
    const story = await loadStory();
    mocks.repo.history.add.mockResolvedValue(data.sequence.row.sequence);

    const response = await call(handlers['[id]'].histories.POST, {
      params: { id: story.id },
      request: jsonRequest(
        `http://localhost/api/stories/${story.id}/histories`,
        data.history,
      ),
    });

    expect(mocks.repo.history.add).toHaveBeenCalledWith(story.id, data.history);
    await expect(response.json()).resolves.toEqual({
      sequence: data.sequence.row.sequence,
    });
  });

  it('GET /[sequence] 应当把段落参数原样传给仓库（不转数字）', async () => {
    const data = await loadCases();
    const story = await loadStory();
    mocks.repo.history.get.mockResolvedValue(data.sequence.row);

    const response = await call(handlers['[id]'].histories['[sequence]'].GET, {
      params: { id: story.id, sequence: data.sequence.param },
    });

    expect(mocks.repo.history.get).toHaveBeenCalledWith(
      story.id,
      data.sequence.param,
    );
    await expect(response.json()).resolves.toEqual(data.sequence.row);
  });

  it('PUT /[sequence] 应当更新并返回 null', async () => {
    const data = await loadCases();
    const story = await loadStory();

    const response = await call(handlers['[id]'].histories['[sequence]'].PUT, {
      params: { id: story.id, sequence: data.sequence.param },
      request: jsonRequest(
        `http://localhost/api/stories/${story.id}/histories/${data.sequence.param}`,
        data.history,
        'PUT',
      ),
    });

    expect(mocks.repo.history.set).toHaveBeenCalledWith(
      story.id,
      data.sequence.param,
      data.history,
    );
    await expect(response.json()).resolves.toBeNull();
  });

  it('DELETE /[sequence] 应当删除并返回 null', async () => {
    const data = await loadCases();
    const story = await loadStory();

    const response = await call(
      handlers['[id]'].histories['[sequence]'].DELETE,
      { params: { id: story.id, sequence: data.sequence.param } },
    );

    expect(mocks.repo.history.del).toHaveBeenCalledWith(
      story.id,
      data.sequence.param,
    );
    await expect(response.json()).resolves.toBeNull();
  });
});

describe('stories api / entries', () => {
  it('GET 列表应当把 id 与查询参数分别传入', async () => {
    const data = await loadCases();
    const story = await loadStory();
    mocks.repo.entry.list.mockResolvedValue(data.entry.entryListResponse);

    const response = await call(handlers['[id]'].entries.GET, {
      params: { id: story.id },
      searchParams: data.entry.entryListRequest,
    });

    expect(mocks.repo.entry.list).toHaveBeenCalledWith(
      story.id,
      data.entry.entryListRequest,
    );
    await expect(response.json()).resolves.toEqual(data.entry.entryListResponse);
  });

  it('POST /[entryType] 应当追加条目并返回 entryId', async () => {
    const data = await loadCases();
    const story = await loadStory();
    mocks.repo.entry.add.mockResolvedValue(data.entry.newEntryId);

    const response = await call(
      handlers['[id]'].entries['[entryType]'].POST,
      {
        params: { id: story.id, entryType: data.entry.entryType },
        request: jsonRequest(
          `http://localhost/api/stories/${story.id}/entries/${data.entry.entryType}`,
          data.entry.body,
        ),
      },
    );

    expect(mocks.repo.entry.add).toHaveBeenCalledWith(
      story.id,
      data.entry.entryType,
      data.entry.body,
    );
    await expect(response.json()).resolves.toEqual({
      entryId: data.entry.newEntryId,
    });
  });

  it('GET /[entryType]/[entryId] 应当按三段主键读取', async () => {
    const data = await loadCases();
    const story = await loadStory();
    mocks.repo.entry.get.mockResolvedValue(data.entry.row);

    const response = await call(entryHandler('GET'), {
      params: {
        id: story.id,
        entryType: data.entry.entryType,
        entryId: data.entry.entryIdParam,
      },
    });

    expect(mocks.repo.entry.get).toHaveBeenCalledWith(
      story.id,
      data.entry.entryType,
      data.entry.entryIdParam,
    );
    await expect(response.json()).resolves.toEqual(data.entry.row);
  });

  it('PUT /[entryType]/[entryId] 应当更新并返回 null', async () => {
    const data = await loadCases();
    const story = await loadStory();

    const response = await call(
      handlers['[id]'].entries['[entryType]']['[entryId]'].PUT,
      {
        params: {
          id: story.id,
          entryType: data.entry.entryType,
          entryId: data.entry.entryIdParam,
        },
        request: jsonRequest(
          `http://localhost/api/stories/${story.id}/entries`,
          data.entry.patch,
          'PUT',
        ),
      },
    );

    expect(mocks.repo.entry.set).toHaveBeenCalledWith(
      story.id,
      data.entry.entryType,
      data.entry.entryIdParam,
      data.entry.patch,
    );
    await expect(response.json()).resolves.toBeNull();
  });

  it('DELETE /[entryType]/[entryId] 应当删除并返回 null', async () => {
    const data = await loadCases();
    const story = await loadStory();

    const response = await call(entryHandler('DELETE'), {
      params: {
        id: story.id,
        entryType: data.entry.entryType,
        entryId: data.entry.entryIdParam,
      },
    });

    expect(mocks.repo.entry.del).toHaveBeenCalledWith(
      story.id,
      data.entry.entryType,
      data.entry.entryIdParam,
    );
    await expect(response.json()).resolves.toBeNull();
  });

  it('entry clone 缺少 masterId 时应当报错', async () => {
    const data = await loadCases();
    const story = await loadStory();

    await expect(
      call(entryCloneHandler(), {
        params: {
          id: story.id,
          entryType: data.entry.entryType,
          entryId: data.entry.entryIdParam,
        },
        request: jsonRequest(
          `http://localhost/api/stories/${story.id}/entries/clone`,
          data.entry.cloneWithoutMaster,
        ),
      }),
    ).rejects.toThrow(/masterId is not specified/);
    expect(mocks.repo.entry.get).not.toHaveBeenCalled();
  });

  it('entry clone 应当把源条目合并到目标故事下', async () => {
    const data = await loadCases();
    const story = await loadStory();
    mocks.repo.entry.get.mockResolvedValue(data.entry.row);
    mocks.repo.entry.add.mockResolvedValue(data.entry.clonedEntryId);

    const response = await call(entryCloneHandler(), {
      params: {
        id: story.id,
        entryType: data.entry.entryType,
        entryId: data.entry.entryIdParam,
      },
      request: jsonRequest(
        `http://localhost/api/stories/${story.id}/entries/clone`,
        data.entry.cloneBody,
      ),
    });

    expect(mocks.repo.entry.get).toHaveBeenCalledWith(
      story.id,
      data.entry.entryType,
      data.entry.entryIdParam,
    );
    expect(mocks.repo.entry.add).toHaveBeenCalledWith(
      data.entry.cloneBody.masterId,
      data.entry.entryType,
      { ...data.entry.row, ...data.entry.cloneBody },
    );
    await expect(response.json()).resolves.toEqual({
      entryId: data.entry.clonedEntryId,
    });
  });
});

describe('stories api / 图片路由挂载', () => {
  it('[id].image 应当直接复用 images/server/api 的 handler', () => {
    expect(handlers['[id]'].image).toBe(mocks.image);
  });
});
