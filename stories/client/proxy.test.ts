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

import { proxy } from '@/stories/client/proxy';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./proxy.cases.json')).default);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stories proxy / 故事本体', () => {
  it('get 应当把 id 与选项合并进路径参数', async () => {
    const data = await loadCases();

    await proxy.get(data.ids.story, data.options);

    expect(mocks.get).toHaveBeenCalledWith('stories/{id}', {
      params: { id: data.ids.story, ...data.options },
    });
  });

  it('get 不传选项时只有 id', async () => {
    const data = await loadCases();

    await proxy.get(data.ids.story);

    expect(mocks.get).toHaveBeenCalledWith('stories/{id}', {
      params: { id: data.ids.story },
    });
  });

  it('list / create / update / clone / delete 应当走对应的请求', async () => {
    const data = await loadCases();

    await proxy.list(data.request);
    await proxy.create(data.story as any);
    await proxy.update(data.ids.story, { name: '改名' } as any);
    await proxy.clone(data.ids.story);
    await proxy.delete(data.ids.story);

    expect(mocks.get).toHaveBeenCalledWith('stories', {
      params: data.request,
    });
    expect(mocks.post).toHaveBeenNthCalledWith(1, 'stories', data.story);
    expect(mocks.put).toHaveBeenCalledWith(
      'stories/{id}',
      { name: '改名' },
      { params: { id: data.ids.story } },
    );
    expect(mocks.post).toHaveBeenNthCalledWith(2, 'stories/{id}/clone', {}, {
      params: { id: data.ids.story },
    });
    expect(mocks.del).toHaveBeenCalledWith('stories/{id}', {
      params: { id: data.ids.story },
    });
  });
});

describe('stories proxy / history', () => {
  it('get / add / set / del 应当带上 sequence', async () => {
    const data = await loadCases();

    await proxy.history.get(data.ids.story, 2);
    await proxy.history.add(data.ids.story, data.history as any);
    await proxy.history.set(data.ids.story, 2, data.history as any);
    await proxy.history.del(data.ids.story, 2);

    expect(mocks.get).toHaveBeenCalledWith(
      'stories/{id}/histories/{sequence}',
      { params: { id: data.ids.story, sequence: 2 } },
    );
    expect(mocks.post).toHaveBeenCalledWith(
      'stories/{id}/histories',
      data.history,
      { params: { id: data.ids.story } },
    );
    expect(mocks.put).toHaveBeenCalledWith(
      'stories/{id}/histories/{sequence}',
      data.history,
      { params: { id: data.ids.story, sequence: 2 } },
    );
    expect(mocks.del).toHaveBeenCalledWith(
      'stories/{id}/histories/{sequence}',
      { params: { id: data.ids.story, sequence: 2 } },
    );
  });
});

describe('stories proxy / realm', () => {
  it('get 应当把故事整包 POST 过去', async () => {
    const data = await loadCases();

    await proxy.realm.get(data.story as any);

    expect(mocks.post).toHaveBeenCalledWith('stories/realm', data.story);
  });

  it('id 应当走 GET 并带路径参数', async () => {
    const data = await loadCases();

    await proxy.realm.id(data.ids.story);

    expect(mocks.get).toHaveBeenCalledWith('stories/realm/{id}', {
      params: { id: data.ids.story },
    });
  });
});

describe('stories proxy / entry', () => {
  it('list 应当把 id 与请求参数合并', async () => {
    const data = await loadCases();

    await proxy.entry.list(data.ids.story, data.entryRequest);

    expect(mocks.get).toHaveBeenCalledWith('stories/{id}/entries', {
      params: { id: data.ids.story, ...data.entryRequest },
    });
  });

  it('add / set / del / clone 应当带上 entryType 与 entryId', async () => {
    const data = await loadCases();

    await proxy.entry.add(data.ids.story, data.entryType, data.entry as any);
    await proxy.entry.set(
      data.ids.story,
      data.entryType,
      data.ids.entry,
      data.entry as any,
    );
    await proxy.entry.del(data.ids.story, data.entryType, data.ids.entry);
    await proxy.entry.clone(
      data.ids.story,
      data.entryType,
      data.ids.entry,
      data.entry as any,
    );

    expect(mocks.post).toHaveBeenNthCalledWith(
      1,
      'stories/{id}/entries/{entryType}',
      data.entry,
      { params: { id: data.ids.story, entryType: data.entryType } },
    );
    expect(mocks.put).toHaveBeenCalledWith(
      'stories/{id}/entries/{entryType}/{entryId}',
      data.entry,
      {
        params: {
          id: data.ids.story,
          entryType: data.entryType,
          entryId: data.ids.entry,
        },
      },
    );
    expect(mocks.del).toHaveBeenCalledWith(
      'stories/{id}/entries/{entryType}/{entryId}',
      {
        params: {
          id: data.ids.story,
          entryType: data.entryType,
          entryId: data.ids.entry,
        },
      },
    );
    expect(mocks.post).toHaveBeenNthCalledWith(
      2,
      'stories/{id}/entries/{entryType}/{entryId}/clone',
      data.entry,
      {
        params: {
          id: data.ids.story,
          entryType: data.entryType,
          entryId: data.ids.entry,
        },
      },
    );
  });
});
