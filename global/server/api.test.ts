import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessError } from '@/interceptors';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  repo: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

// 仓库层换掉，避免拉起 sqlite / drizzle
vi.mock('@/global/server/repository', () => ({
  settingRepository: mocks.repo,
}));
// route 只负责拦截器编排，这里直接暴露处理函数
vi.mock('@/interceptors/server', () => ({
  route: (handler: unknown) => handler,
}));

import api from '@/global/server/api';

const handlers = api as any;

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
  return handler(options.request ?? new Request('http://localhost/api'), {
    params: Promise.resolve(options.params ?? {}),
    searchParams: options.searchParams ?? {},
  });
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
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('global api / proxy 转发', () => {
  it('应当按请求描述转发，并把上游响应原样包回去', async () => {
    const data = await loadCases();
    mocks.fetch.mockResolvedValue(
      new Response(data.proxy.responseBody, {
        status: data.proxy.responseStatus,
        statusText: data.proxy.responseStatusText,
        headers: data.proxy.responseHeaders,
      }),
    );
    const request = jsonRequest('http://localhost/api/proxy', data.proxy);

    const response = await call(handlers.proxy.POST, { request });

    expect(mocks.fetch).toHaveBeenCalledWith(data.proxy.url, {
      method: data.proxy.method,
      body: data.proxy.body,
      headers: data.proxy.headers,
      signal: request.signal,
    });
    expect(response.status).toBe(data.proxy.responseStatus);
    expect(response.statusText).toBe(data.proxy.responseStatusText);
    expect(response.headers.get('x-from-target')).toBe(
      data.proxy.responseHeaders['X-From-Target'],
    );
    await expect(response.text()).resolves.toBe(data.proxy.responseBody);
  });

  it('不给 method 时默认按 GET 转发，headers 默认空对象', async () => {
    const data = await loadCases();
    mocks.fetch.mockResolvedValue(new Response(null, { status: 200 }));

    await call(handlers.proxy.POST, {
      request: jsonRequest('http://localhost/api/proxy', {
        url: data.proxy.url,
      }),
    });

    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe(data.proxy.url);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({});
  });

  it('ignore 为真时应当取消上游响应体并返回空响应', async () => {
    const data = await loadCases();
    const upstream = new Response(data.proxy.responseBody, {
      status: data.proxy.responseStatus,
      headers: data.proxy.responseHeaders,
    });
    const cancel = vi.spyOn(upstream.body!, 'cancel');
    mocks.fetch.mockResolvedValue(upstream);

    const response = await call(handlers.proxy.POST, {
      request: jsonRequest('http://localhost/api/proxy', {
        ...data.proxy,
        ignore: true,
      }),
    });

    expect(cancel).toHaveBeenCalled();
    expect(response.status).toBe(data.proxy.responseStatus);
    await expect(response.text()).resolves.toBe('');
  });

  it('缺少 url 时应当抛 BusinessError 且不发请求', async () => {
    const data = await loadCases();

    const error = await call(handlers.proxy.POST, {
      request: jsonRequest('http://localhost/api/proxy', data.noUrl),
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(BusinessError);
    expect((error as Error).message).toBe('missing url');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('global api / settings 读取', () => {
  it('GET /[id] 应当按 id 取设置并只返回 data', async () => {
    const data = await loadCases();
    mocks.repo.get.mockResolvedValue(data.settings);

    const response = await call(handlers.settings['[id]'].GET, {
      params: { id: data.settings.id },
    });

    expect(mocks.repo.get).toHaveBeenCalledWith(data.settings.id);
    await expect(response.json()).resolves.toEqual(data.settings.data);
  });

  it('查不到或 data 为 null 时都返回空对象', async () => {
    const data = await loadCases();
    mocks.repo.get.mockResolvedValueOnce(undefined);
    mocks.repo.get.mockResolvedValueOnce({ id: data.settings.id, data: null });

    const missing = await call(handlers.settings['[id]'].GET, {
      params: { id: data.settings.id },
    });
    const nullData = await call(handlers.settings['[id]'].GET, {
      params: { id: data.settings.id },
    });

    await expect(missing.json()).resolves.toEqual({});
    await expect(nullData.json()).resolves.toEqual({});
  });

  it('缺少 id 时原样交给仓库，不做校验', async () => {
    await call(handlers.settings['[id]'].GET);

    expect(mocks.repo.get).toHaveBeenCalledWith(undefined);
  });

  it('仓库抛错时应当原样抛出', async () => {
    const data = await loadCases();
    const error = new Error('db down');
    mocks.repo.get.mockRejectedValue(error);

    await expect(
      call(handlers.settings['[id]'].GET, {
        params: { id: data.settings.id },
      }),
    ).rejects.toBe(error);
  });
});

describe('global api / settings 写入', () => {
  it('PUT /[id] 应当把请求体整包写进 data 并返回 null', async () => {
    const data = await loadCases();

    const response = await call(handlers.settings['[id]'].PUT, {
      params: { id: data.settings.id },
      request: jsonRequest(
        `http://localhost/api/global/settings/${data.settings.id}`,
        data.settings.updateData,
        'PUT',
      ),
    });

    expect(mocks.repo.set).toHaveBeenCalledWith({
      id: data.settings.id,
      data: data.settings.updateData,
    });
    await expect(response.json()).resolves.toBeNull();
  });

  it('请求体为 JSON null 时 data 也是 null', async () => {
    const data = await loadCases();

    await call(handlers.settings['[id]'].PUT, {
      params: { id: data.settings.id },
      request: jsonRequest(
        `http://localhost/api/global/settings/${data.settings.id}`,
        null,
        'PUT',
      ),
    });

    const payload = mocks.repo.set.mock.calls[0][0];
    expect(payload.id).toBe(data.settings.id);
    expect(payload.data).toBeNull();
  });
});
