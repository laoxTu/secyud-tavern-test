import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
  fetch: vi.fn(),
}));

// 请求层整体替换掉，用例只关心拼出来的 url、参数与请求体
vi.mock('@/client', () => ({
  get: mocks.get,
  post: mocks.post,
  put: mocks.put,
  del: mocks.del,
  open: mocks.open,
}));
// 第三方代理（ComfyUI 自身的 /prompt 接口）只替换 fetch，其余保持真实实现
vi.mock('@/global/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    globals: { ...actual.globals, proxy: { fetch: mocks.fetch } },
  };
});

import { comfyuis } from '@/comfyui';
import type { ComfyUIParamRequestParam } from '@/comfyui';
import { proxy } from '@/comfyui/client/proxy';
import type { DataRequest } from '@/database';
import { useComfyUIModelSettingState } from '@/comfyui/client/state';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./proxy.cases.json')).default);
}

beforeEach(async () => {
  const data = await loadCases();
  vi.clearAllMocks();
  useComfyUIModelSettingState.setState(structuredClone(data.setting));
});

afterEach(() => {
  useComfyUIModelSettingState.setState(
    structuredClone(comfyuis.setting.default),
  );
});

describe('comfyui proxy / generate', () => {
  it('应当把 client_id 与 prompt 一起 POST 到 ComfyUI 的 /prompt', async () => {
    const data = await loadCases();

    await proxy.generate(data.prompt);

    expect(mocks.fetch).toHaveBeenCalledWith({
      method: 'POST',
      url: `${data.setting.url}/prompt`,
      body: JSON.stringify({
        client_id: data.setting.client,
        prompt: data.prompt,
      }),
    });
  });

  it('请求体应当是字符串而不是对象', async () => {
    const data = await loadCases();
    mocks.fetch.mockResolvedValue(data.generateResponse);

    const result = await proxy.generate(data.prompt);

    expect(typeof mocks.fetch.mock.calls[0][0].body).toBe('string');
    expect(result).toEqual(data.generateResponse);
  });
});

describe('comfyui proxy / model', () => {
  it('import 应当把模型数组整体提交', async () => {
    const data = await loadCases();

    await proxy.model.import(data.models as any);

    expect(mocks.post).toHaveBeenCalledWith(
      'comfyuis/models/import',
      data.models,
    );
  });

  it('download 应当只带路径参数', async () => {
    const data = await loadCases();

    await proxy.model.download(data.ids.model);

    expect(mocks.post).toHaveBeenCalledWith(
      'comfyuis/models/{id}/download',
      {},
      { params: { id: data.ids.model } },
    );
  });

  it('get 与 list 应当按 id 或查询参数请求', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.model);

    await proxy.model.get(data.ids.model);
    await proxy.model.list(data.request);

    expect(mocks.get).toHaveBeenNthCalledWith(1, 'comfyuis/models/{id}', {
      params: { id: data.ids.model },
    });
    expect(mocks.get).toHaveBeenNthCalledWith(2, 'comfyuis/models', {
      params: data.request,
    });
  });

  it('create / update / delete 应当分别走 post / put / del', async () => {
    const data = await loadCases();

    await proxy.model.create(data.model as any);
    await proxy.model.update(data.ids.model, { name: '改名' } as any);
    await proxy.model.delete(data.ids.model);

    expect(mocks.post).toHaveBeenCalledWith('comfyuis/models', data.model);
    expect(mocks.put).toHaveBeenCalledWith(
      'comfyuis/models/{id}',
      { name: '改名' },
      { params: { id: data.ids.model } },
    );
    expect(mocks.del).toHaveBeenCalledWith('comfyuis/models/{id}', {
      params: { id: data.ids.model },
    });
  });

  it('cache 只在首次真正请求，之后复用同一个对象', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.model);

    const first = await proxy.model.cache(data.ids.cache);
    const second = await proxy.model.cache(data.ids.cache);

    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(first).toEqual(data.model);
    // 第二次拿到的是同一个引用
    expect(second).toBe(first);
  });

  it('cache 拿不到模型时回落到默认模型', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(undefined);

    const result = await proxy.model.cache(data.ids.cacheMissing);

    expect(result).toEqual(comfyuis.model.default);
  });
});

describe('comfyui proxy / workflow', () => {
  it('export 应当走 open 下载，import 应当用 FormData 上传', async () => {
    const data = await loadCases();
    const file = new File(['{}'], 'workflow.json', {
      type: 'application/json',
    });
    mocks.post.mockResolvedValue(data.workflow);

    await proxy.workflow.export(data.ids.workflow);
    await proxy.workflow.import(file);

    expect(mocks.open).toHaveBeenCalledWith(
      'comfyuis/workflows/{id}/export',
      { params: { id: data.ids.workflow } },
    );
    const [url, body] = mocks.post.mock.calls[0];
    expect(url).toBe('comfyuis/workflows/import');
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBe(file);
  });

  it('get / list / create / update / delete / clone 应当走对应的请求', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.workflow);

    await proxy.workflow.get(data.ids.workflow);
    await proxy.workflow.list(data.request);
    await proxy.workflow.create(data.workflow as any);
    await proxy.workflow.update(data.ids.workflow, { name: '改名' } as any);
    await proxy.workflow.delete(data.ids.workflow);
    await proxy.workflow.clone(data.ids.workflow, { name: '副本' } as any);

    expect(mocks.get).toHaveBeenNthCalledWith(1, 'comfyuis/workflows/{id}', {
      params: { id: data.ids.workflow },
    });
    expect(mocks.get).toHaveBeenNthCalledWith(2, 'comfyuis/workflows', {
      params: data.request,
    });
    expect(mocks.post).toHaveBeenNthCalledWith(
      1,
      'comfyuis/workflows',
      data.workflow,
    );
    expect(mocks.put).toHaveBeenCalledWith(
      'comfyuis/workflows/{id}',
      { name: '改名' },
      { params: { id: data.ids.workflow } },
    );
    expect(mocks.del).toHaveBeenCalledWith('comfyuis/workflows/{id}', {
      params: { id: data.ids.workflow },
    });
    expect(mocks.post).toHaveBeenNthCalledWith(
      2,
      'comfyuis/workflows/{id}/clone',
      { name: '副本' },
      { params: { id: data.ids.workflow } },
    );
  });

  it('paint 应当把工作流与参数列表拼起来', async () => {
    const data = await loadCases();
    mocks.get.mockImplementation(async (url: string) =>
      url === 'comfyuis/workflows/{id}'
        ? data.workflow
        : { items: [data.param], length: 1 },
    );

    const result = await proxy.workflow.paint(data.ids.workflow);

    expect(result).toEqual({
      workflow: data.workflow,
      params: [data.param],
    });
  });

  it('paint 没有 id 时直接返回 null，不发请求', async () => {
    await expect(proxy.workflow.paint(undefined)).resolves.toBeNull();
    await expect(proxy.workflow.paint(null)).resolves.toBeNull();

    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('comfyui proxy / workflow.param', () => {
  it('generate 与 list 应当按工作流 id 请求参数', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue({ items: [data.param], length: 1 });

    await proxy.workflow.param.generate(data.ids.workflow);
    // data.request 是三个 list 共用的一份 fixture，search 的键是 fuzzy；
    // param.list 声明的 search 只认 filter，这里按「原样透传」的用例意图收窄
    await proxy.workflow.param.list(
      data.ids.workflow,
      data.request as unknown as DataRequest<ComfyUIParamRequestParam>,
    );

    expect(mocks.post).toHaveBeenCalledWith(
      'comfyuis/workflows/{id}/params/generate',
      {},
      { params: { id: data.ids.workflow } },
    );
    // 工作流 id 与查询参数合并成一个 params
    expect(mocks.get).toHaveBeenCalledWith(
      'comfyuis/workflows/{id}/params',
      { params: { id: data.ids.workflow, ...data.request } },
    );
  });

  it('get / add / set / del 应当带上 sequence', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.param);

    await proxy.workflow.param.get(data.ids.workflow, data.sequence);
    await proxy.workflow.param.add(data.ids.workflow, data.param as any);
    await proxy.workflow.param.set(
      data.ids.workflow,
      data.sequence,
      data.param as any,
    );
    await proxy.workflow.param.del(data.ids.workflow, data.sequence);

    expect(mocks.get).toHaveBeenCalledWith(
      'comfyuis/workflows/{id}/params/{sequence}',
      { params: { id: data.ids.workflow, sequence: data.sequence } },
    );
    expect(mocks.post).toHaveBeenCalledWith(
      'comfyuis/workflows/{id}/params',
      data.param,
      { params: { id: data.ids.workflow } },
    );
    expect(mocks.put).toHaveBeenCalledWith(
      'comfyuis/workflows/{id}/params/{sequence}',
      data.param,
      { params: { id: data.ids.workflow, sequence: data.sequence } },
    );
    expect(mocks.del).toHaveBeenCalledWith(
      'comfyuis/workflows/{id}/params/{sequence}',
      { params: { id: data.ids.workflow, sequence: data.sequence } },
    );
  });

  it('clone 应当把覆盖字段放在请求体里', async () => {
    const data = await loadCases();

    await proxy.workflow.param.clone(data.ids.workflow, data.sequence, {
      name: '副本',
    } as any);

    expect(mocks.post).toHaveBeenCalledWith(
      'comfyuis/workflows/{id}/params/{sequence}/clone',
      { name: '副本' },
      { params: { id: data.ids.workflow, sequence: data.sequence } },
    );
  });

  it('clone 不传覆盖字段时请求体是 undefined', async () => {
    const data = await loadCases();

    await proxy.workflow.param.clone(data.ids.workflow, data.sequence);

    expect(mocks.post.mock.calls[0][1]).toBeUndefined();
  });
});
