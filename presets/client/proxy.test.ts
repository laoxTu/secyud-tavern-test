import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Preset } from '@/presets';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));

// proxy 只是 URL/参数的薄封装，把请求层整体替换掉
vi.mock('@/client', () => ({
  get: mocks.get,
  post: mocks.post,
  put: mocks.put,
  del: mocks.del,
  open: mocks.open,
}));

import { proxy } from '@/presets/client/proxy';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./fixtures.json')).default);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('presets client proxy / 预设', () => {
  it('get 应当带上 id 与查询选项', async () => {
    const data = await loadData();
    mocks.get.mockResolvedValue(data.preset);

    await expect(proxy.get(data.preset.id, { entities: true })).resolves.toEqual(
      data.preset,
    );
    expect(mocks.get).toHaveBeenCalledWith('presets/{id}', {
      params: { id: data.preset.id, entities: true },
    });
  });

  it('list 应当把分页请求作为查询参数', async () => {
    const data = await loadData();

    await proxy.list(data.listRequest);

    expect(mocks.get).toHaveBeenCalledWith('presets', {
      params: data.listRequest,
    });
  });

  it('create 应当 POST 预设本体', async () => {
    const data = await loadData();
    const preset = data.preset as Preset;

    await proxy.create(preset);

    expect(mocks.post).toHaveBeenCalledWith('presets', preset);
  });

  it('update 应当 PUT 到 /presets/{id}', async () => {
    const data = await loadData();

    await proxy.update(data.preset.id, data.presetPatch);

    expect(mocks.put).toHaveBeenCalledWith('presets/{id}', data.presetPatch, {
      params: { id: data.preset.id },
    });
  });

  it('delete 应当 DELETE 到 /presets/{id}', async () => {
    const data = await loadData();

    await proxy.delete(data.preset.id);

    expect(mocks.del).toHaveBeenCalledWith('presets/{id}', {
      params: { id: data.preset.id },
    });
  });

  it('clone 应当 POST 到 clone 路径', async () => {
    const data = await loadData();

    await proxy.clone(data.preset.id, data.presetClone);

    expect(mocks.post).toHaveBeenCalledWith(
      'presets/{id}/clone',
      data.presetClone,
      { params: { id: data.preset.id } },
    );
  });

  it('export 应当走 open（新窗口打开下载地址）', async () => {
    const data = await loadData();

    await proxy.export(data.preset.id);

    expect(mocks.open).toHaveBeenCalledWith('presets/{id}/export', {
      params: { id: data.preset.id },
    });
  });
});

describe('presets client proxy / 条目', () => {
  it('list 应当带上 id 与条目查询参数', async () => {
    const data = await loadData();
    mocks.get.mockResolvedValue(data.emptyResponse);

    await proxy.entry.list(data.preset.id, data.entryListRequest);

    expect(mocks.get).toHaveBeenCalledWith('presets/{id}/entries', {
      params: { id: data.preset.id, ...data.entryListRequest },
    });
  });

  it('add 应当把 entryType 放在路径上', async () => {
    const data = await loadData();

    await proxy.entry.add(data.preset.id, data.entry.entryType, data.entry);

    expect(mocks.post).toHaveBeenCalledWith(
      'presets/{id}/entries/{entryType}',
      data.entry,
      { params: { id: data.preset.id, entryType: data.entry.entryType } },
    );
  });

  it('set 应当带上 entryId', async () => {
    const data = await loadData();

    await proxy.entry.set(
      data.preset.id,
      data.entry.entryType,
      data.entry.entryId,
      data.entryPatch,
    );

    expect(mocks.put).toHaveBeenCalledWith(
      'presets/{id}/entries/{entryType}/{entryId}',
      data.entryPatch,
      {
        params: {
          id: data.preset.id,
          entryType: data.entry.entryType,
          entryId: data.entry.entryId,
        },
      },
    );
  });

  it('del 应当 DELETE 到条目路径', async () => {
    const data = await loadData();

    await proxy.entry.del(
      data.preset.id,
      data.entry.entryType,
      data.entry.entryId,
    );

    expect(mocks.del).toHaveBeenCalledWith(
      'presets/{id}/entries/{entryType}/{entryId}',
      {
        params: {
          id: data.preset.id,
          entryType: data.entry.entryType,
          entryId: data.entry.entryId,
        },
      },
    );
  });

  it('clone 应当 POST 到条目 clone 路径', async () => {
    const data = await loadData();

    await proxy.entry.clone(
      data.preset.id,
      data.entry.entryType,
      data.entry.entryId,
      data.entryClone,
    );

    expect(mocks.post).toHaveBeenCalledWith(
      'presets/{id}/entries/{entryType}/{entryId}/clone',
      data.entryClone,
      {
        params: {
          id: data.preset.id,
          entryType: data.entry.entryType,
          entryId: data.entry.entryId,
        },
      },
    );
  });
});

describe('presets client proxy / 导入导出', () => {
  it('import.prepare 应当以 multipart 上传并把 sessionId 带在查询上', async () => {
    const data = await loadData();
    mocks.post.mockResolvedValue(data.nameValues);
    const file = new File([data.uploadContent], data.fileName);

    const result = await proxy.import.prepare(file);

    expect(result.nameValues).toEqual(data.nameValues);
    expect(result.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    const [url, formData, options] = mocks.post.mock.calls[0];
    expect(url).toBe('presets/import');
    expect(formData).toBeInstanceOf(FormData);
    expect((formData as FormData).get('file')).toBe(file);
    expect(options.params).toEqual({ sessionId: result.sessionId });
  });

  it('import.confirm 应当把选中的 id 列表 PUT 回去', async () => {
    const data = await loadData();
    const selection = [data.preset.id];
    mocks.put.mockResolvedValue({ id: data.preset.id });

    await proxy.import.confirm(data.sessionId, selection);

    expect(mocks.put).toHaveBeenCalledWith('presets/import', selection, {
      params: { sessionId: data.sessionId },
    });
  });
});
