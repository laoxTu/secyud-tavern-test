import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  open: vi.fn(),
}));

import { api, del, get, getBaseUrl, handleResponse, open, post, put } from '@/client';
import { ApiError } from '@/interceptors/client';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./client.cases.json')).default);
}

/** 取最后一次 fetch 的 url 与 init */
function lastFetch() {
  const [url, init] = mocks.fetch.mock.calls.at(-1)!;
  return { url: url as string, init: init as RequestInit };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  // Response 的 body 只能读一次，每次请求都要给新的对象
  mocks.fetch.mockImplementation(async () => jsonResponse({ ok: true }));
  // jsdom 的 window.open 是原型上的 getter，spyOn 拦不住调用，这里直接盖一个自有属性
  Object.defineProperty(window, 'open', {
    configurable: true,
    writable: true,
    value: mocks.open,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as any).open;
});

describe('client / getBaseUrl', () => {
  it('浏览器环境下应当取当前 origin', () => {
    expect(getBaseUrl()).toBe(window.location.origin);
  });
});

describe('client / url 拼装', () => {
  it('应当按用例拼出 url', async () => {
    const data = await loadCases();

    for (const item of data.urls) {
      mocks.fetch.mockClear();

      await api(item.url as any, 'get', { params: item.params });

      expect(lastFetch().url, item.name).toBe(
        window.location.origin + item.expected,
      );
    }
  });

  it('参数里的 undefined 应当被丢掉', async () => {
    await api('models', 'get', { params: { a: undefined, b: 1 } as any });

    expect(lastFetch().url).toBe(`${window.location.origin}/api/models?b=1`);
  });

  it('参数对象不应当被就地改动', async () => {
    const params = { id: 'm-1', size: 10 };

    await api('models/{id}', 'get', { params });

    expect(params).toEqual({ id: 'm-1', size: 10 });
  });

  it('数字与布尔参数会被转成字符串', async () => {
    await api('models', 'get', { params: { size: 10, only: false } as any });

    expect(lastFetch().url).toBe(
      `${window.location.origin}/api/models?size=10&only=false`,
    );
  });
});

describe('client / 请求体', () => {
  it('普通对象应当被 JSON 化并补上 Content-Type', async () => {
    const data = await loadCases();

    await post('models', data.body.object);

    const { url, init } = lastFetch();
    expect(url).toBe(`${window.location.origin}/api/models`);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Content-Type')).toBe(
      'application/json',
    );
    expect(init.body).toBe(JSON.stringify(data.body.object));
  });

  it('二进制与表单类请求体应当原样透传，且不覆盖 Content-Type', async () => {
    const bodies: [string, BodyInit][] = [
      ['FormData', new FormData()],
      ['URLSearchParams', new URLSearchParams('a=1')],
      ['Blob', new Blob(['x'])],
      ['ArrayBuffer', new ArrayBuffer(8)],
      [
        'ReadableStream',
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      ],
    ];

    for (const [name, body] of bodies) {
      mocks.fetch.mockClear();

      await post('models', body as any);

      const { init } = lastFetch();
      expect(init.body, name).toBe(body);
      expect(new Headers(init.headers).get('Content-Type'), name).toBeNull();
    }
  });

  it('调用方自带 Content-Type 时普通对象不会被 JSON 化（现状）', async () => {
    await post(
      'models',
      { name: 'x' },
      { headers: { 'Content-Type': 'text/plain' } },
    );

    const { init } = lastFetch();
    expect(new Headers(init.headers).get('Content-Type')).toBe('text/plain');
    // 因为已经带了 Content-Type，这里走的是「原样透传」分支，body 仍是对象
    expect(init.body).toEqual({ name: 'x' });
  });

  it('请求体为假值时不应当带 body', async () => {
    await post('models', undefined);

    expect(lastFetch().init).not.toHaveProperty('body');
  });

  it('应当透传 method / signal / cache / next', async () => {
    const controller = new AbortController();

    await put('models/{id}', { name: 'x' }, {
      params: { id: 'm-1' },
      signal: controller.signal,
      cache: 'no-store',
      next: { revalidate: 5 },
    });

    const { init, url } = lastFetch();
    expect(url).toBe(`${window.location.origin}/api/models/m-1`);
    expect(init.method).toBe('PUT');
    expect(init.signal).toBe(controller.signal);
    expect(init.cache).toBe('no-store');
    expect((init as any).next).toEqual({ revalidate: 5 });
  });
});

describe('client / open', () => {
  it('应当直接开新窗口，不发请求', async () => {
    const data = await loadCases();

    const result = await open('models/{id}', { params: { id: data.params.id } });

    // open 走的是相对路径（浏览器会按当前 origin 解析），不像 fetch 那样拼 getBaseUrl()
    expect(mocks.open).toHaveBeenCalledWith(`/api/models/${data.params.id}`);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});

describe('client / handleResponse', () => {
  it('非 json 响应应当原样返回 Response', async () => {
    const data = await loadCases();
    const response = new Response(data.response.text, {
      headers: { 'Content-Type': 'text/plain' },
    });

    await expect(handleResponse(response)).resolves.toBe(response);
  });

  it('json 且 ok 时应当返回解析后的数据', async () => {
    const data = await loadCases();

    await expect(
      handleResponse(jsonResponse(data.response.json)),
    ).resolves.toEqual(data.response.json);
  });

  it('json 且不 ok 时应当抛 ApiError 并带上 code/data', async () => {
    const data = await loadCases();

    const error = await handleResponse(
      jsonResponse(data.response.error, 400),
    ).catch((err) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe(data.response.error.message);
    expect(error.code).toBe(data.response.error.code);
    expect(error.data).toEqual(data.response.error.data);
  });

  it('响应体没有 message 时用默认文案', async () => {
    const data = await loadCases();

    const error = await handleResponse(
      jsonResponse(data.response.noMessage, 500),
    ).catch((err) => err);

    expect(error.message).toBe('Internal Server Error');
    expect(error.code).toBe(data.response.noMessage.code);
    expect(error.data).toEqual({});
  });

  it('Content-Type 带参数时也按 json 处理', async () => {
    const data = await loadCases();
    const response = new Response(JSON.stringify(data.response.json), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });

    await expect(handleResponse(response)).resolves.toEqual(
      data.response.json,
    );
  });
});

describe('client / 便捷方法', () => {
  it('get / post / put / del 应当映射到对应的 HTTP 方法', async () => {
    const data = await loadCases();
    const expected: [string, () => Promise<any>][] = [
      ['GET', () => get('models', { params: data.params })],
      ['POST', () => post('models', data.body.object)],
      [
        'PUT',
        () =>
          put('models/{id}', data.body.object, {
            params: { id: data.params.id },
          }),
      ],
      ['DELETE', () => del('models/{id}', { params: { id: data.params.id } })],
    ];

    for (const [method, call] of expected) {
      mocks.fetch.mockClear();

      await call();

      expect(lastFetch().init.method, method).toBe(method);
    }
  });

  it('get 的查询参数应当出现在 url 上', async () => {
    const data = await loadCases();

    await get('models', { params: data.params });

    expect(lastFetch().url).toContain(`skip=${data.params.skip}`);
  });
});
