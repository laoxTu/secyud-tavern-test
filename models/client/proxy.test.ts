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

import { proxy } from '@/models/client/proxy';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./proxy.cases.json')).default);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('models proxy / 读取', () => {
  it('get 应当把 id 放进路径参数', async () => {
    const data = await loadCases();

    await proxy.get(data.params.id);

    expect(mocks.get).toHaveBeenCalledWith('models/{id}', {
      params: { id: data.params.id },
    });
  });

  it('list 应当把分页与搜索条件整体透传', async () => {
    const data = await loadCases();

    await proxy.list(data.params);

    expect(mocks.get).toHaveBeenCalledWith('models', { params: data.params });
  });

  it('list 不传参数时应当原样交给请求层', async () => {
    await proxy.list();

    expect(mocks.get).toHaveBeenCalledWith('models', { params: undefined });
  });
});

describe('models proxy / 写入', () => {
  it('create 应当把模型放在请求体里', async () => {
    const data = await loadCases();

    await proxy.create(data.body);

    expect(mocks.post).toHaveBeenCalledWith('models', data.body);
  });

  it('clone 应当同时带上源 id 与覆盖字段', async () => {
    const data = await loadCases();
    const body = { name: data.body.name };

    await proxy.clone(data.params.id, body);

    expect(mocks.post).toHaveBeenCalledWith('models/{id}/clone', body, {
      params: { id: data.params.id },
    });
  });

  it('update 应当把改动放在请求体里', async () => {
    const data = await loadCases();

    await proxy.update(data.params.id, data.update);

    expect(mocks.put).toHaveBeenCalledWith('models/{id}', data.update, {
      params: { id: data.params.id },
    });
  });

  it('delete 应当只带路径参数', async () => {
    const data = await loadCases();

    await proxy.delete(data.params.id);

    expect(mocks.del).toHaveBeenCalledWith('models/{id}', {
      params: { id: data.params.id },
    });
  });
});

describe('models proxy / 生成', () => {
  it('generate 应当把输入与中断信号一起传给请求层', async () => {
    const data = await loadCases();
    const signal = new AbortController().signal;

    await proxy.engine.generate(data.params.id, data.input, signal);

    expect(mocks.post).toHaveBeenCalledWith(
      'models/{id}/engine/generate',
      data.input,
      { params: { id: data.params.id }, signal },
    );
  });

  it('请求层的返回值应当原样返回', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.entities);

    await expect(proxy.get(data.params.id)).resolves.toBe(data.entities);
  });
});
