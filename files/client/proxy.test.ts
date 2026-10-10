import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));

// 请求层整体替换掉，用例只关心拼出来的 url、参数与请求体
vi.mock('@/client', () => ({
  get: mocks.get,
  post: mocks.post,
  put: mocks.put,
  del: mocks.del,
  open: mocks.open,
}));

import { proxy } from '@/files/client/proxy';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./proxy.cases.json')).default);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('files proxy / get 与 delete', () => {
  it('get 应当按 id 请求文件并透传结果', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.file);

    const result = await proxy.get(data.ids.file);

    expect(mocks.get).toHaveBeenCalledWith('files/{id}', {
      params: { id: data.ids.file },
    });
    expect(result).toEqual(data.file);
  });

  it('delete 应当按 id 请求且不返回任何值', async () => {
    const data = await loadCases();
    mocks.del.mockResolvedValue('ignored');

    const result = await proxy.delete(data.ids.file);

    expect(mocks.del).toHaveBeenCalledWith('files/{id}', {
      params: { id: data.ids.file },
    });
    expect(result).toBeUndefined();
  });

  it('get 与 delete 都只依赖传入的 id，不做 url 转换', async () => {
    const data = await loadCases();

    await proxy.get(data.ids.missing);
    await proxy.delete(data.ids.missing);

    // 参数原样透传，转义与资源地址拼接由请求层负责
    expect(mocks.get.mock.calls[0][1].params.id).toBe(data.ids.missing);
    expect(mocks.del.mock.calls[0][1].params.id).toBe(data.ids.missing);
  });
});

describe('files proxy / create', () => {
  it('应当用 FormData 上传文件并透传创建的 id', async () => {
    const data = await loadCases();
    const file = new File([data.upload.content], data.upload.name, {
      type: data.upload.type,
    });
    mocks.post.mockResolvedValue({ id: data.createdId });

    const result = await proxy.create(file);

    expect(mocks.post).toHaveBeenCalledTimes(1);
    const [url, body] = mocks.post.mock.calls[0];
    expect(url).toBe('files');
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBe(file);
    expect(result).toEqual({ id: data.createdId });
  });

  it('同一个文件只应当出现在 file 字段上', async () => {
    const data = await loadCases();
    const file = new File([data.upload.content], data.upload.name, {
      type: data.upload.type,
    });

    await proxy.create(file);

    const body = mocks.post.mock.calls[0][1] as FormData;
    expect([...body.keys()]).toEqual(['file']);
    expect(body.get('file')).toBe(file);
  });

  it('上传不应当额外带请求选项', async () => {
    const data = await loadCases();
    const file = new File([data.upload.content], data.upload.name, {
      type: data.upload.type,
    });

    await proxy.create(file);

    // post 只收到 url 与 FormData 两个参数
    expect(mocks.post.mock.calls[0]).toHaveLength(2);
  });
});

describe('files proxy / list', () => {
  it('应当把查询参数放进 params 并透传分页结果', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.listResponse);

    const result = await proxy.list(data.request);

    expect(mocks.get).toHaveBeenCalledWith('files', {
      params: data.request,
    });
    expect(result).toEqual(data.listResponse);
  });

  it('不传查询参数时 params 应当是 undefined', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.listResponse);

    const result = await proxy.list();

    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls[0][0]).toBe('files');
    expect('params' in mocks.get.mock.calls[0][1]).toBe(true);
    expect(mocks.get.mock.calls[0][1].params).toBeUndefined();
    expect(result).toEqual(data.listResponse);
  });
});
