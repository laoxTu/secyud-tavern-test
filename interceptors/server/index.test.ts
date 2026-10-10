import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerServerPlugin: vi.fn(),
}));

// 注册编排是边界：真实实现会把所有 server 模块拉起来，这里只关心 route 有没有等它
vi.mock('@/generated/server-registerer', () => ({
  registerServerPlugin: mocks.registerServerPlugin,
}));

import { BusinessError } from '@/interceptors';
import type { InterceptorHandler } from '@/interceptors/server';
import { manager, route } from '@/interceptors/server';
import { errorInterceptor } from '@/interceptors/server/error';
import { getRegistry } from '@/plugins';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

/** 只记录 id 的假拦截器，behavior 决定 next 前后做什么 */
function fakeInterceptor(
  seed: { id: string; sequence?: number; requires?: string[] },
  log: string[],
  behavior: (next: () => Promise<NextResponse>) => Promise<NextResponse> = (
    next,
  ) => next(),
): InterceptorHandler {
  return {
    id: seed.id,
    sequence: seed.sequence,
    requires: seed.requires,
    async handle(_request, _records, next) {
      log.push(seed.id);
      return behavior(next);
    },
  } as InterceptorHandler;
}

function buildUrl(base: string, query: Record<string, string>) {
  const search = new URLSearchParams(query).toString();
  return search ? `${base}?${search}` : base;
}

function clearState() {
  for (const id of Object.keys(manager.records)) manager.unregister(id);
  delete (globalThis as { __initialized?: boolean }).__initialized;
}

beforeEach(() => {
  // 注意要用 mockReset：clearAllMocks 不会移除上一条用例留下的 mockImplementation
  mocks.registerServerPlugin.mockReset();
  // 链路与注册表的 debug 日志会刷屏，用例里静音
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  clearState();
});

afterEach(() => {
  clearState();
  vi.restoreAllMocks();
});

describe('interceptors server / route 首次注册', () => {
  it('首次调用应当注册服务端插件并写入 __initialized', async () => {
    const data = await loadCases();
    const handler = route(async () => NextResponse.json(data.request.body));

    await handler(new NextRequest(data.request.url), {
      params: Promise.resolve(data.request.params),
    });

    expect(mocks.registerServerPlugin).toHaveBeenCalledTimes(1);
    expect((globalThis as { __initialized?: boolean }).__initialized).toBe(
      true,
    );
  });

  it('已初始化时再次调用不应重复注册', async () => {
    const data = await loadCases();
    const handler = route(async () => NextResponse.json(data.request.body));
    const context = { params: Promise.resolve(data.request.params) };

    await handler(new NextRequest(data.request.url), context);
    await handler(new NextRequest(data.request.url), context);

    expect(mocks.registerServerPlugin).toHaveBeenCalledTimes(1);
  });

  it('首次注册应当在拦截器链路执行前完成', async () => {
    const data = await loadCases();
    const log: string[] = [];
    mocks.registerServerPlugin.mockImplementation(async () => {
      manager.register(fakeInterceptor(data.interceptors.early, log));
    });
    const handler = route(async () => NextResponse.json(data.request.body));
    const request = new NextRequest(data.request.url);

    await handler(request, { params: Promise.resolve(data.request.params) });

    expect(log).toEqual([data.interceptors.early.id]);
  });

  it('manager 应当就是 interceptor 注册表单例', () => {
    expect(manager).toBe(getRegistry('interceptor'));
  });
});

describe('interceptors server / records 反序列化', () => {
  it('params 应当保持 Promise，searchParams 应当已是反序列化后的对象', async () => {
    const data = await loadCases();
    let records: any = undefined;
    const handler = route(async (_request, received) => {
      records = received;
      return NextResponse.json(data.request.body);
    });

    await handler(
      new NextRequest(buildUrl(data.request.url, data.request.query)),
      { params: Promise.resolve(data.request.params) },
    );

    expect(records.params).toBeInstanceOf(Promise);
    await expect(records.params).resolves.toEqual(data.request.params);
    // 空串与纯空白会被丢掉，其余按 json 解析，解析失败的保留原字符串
    expect(records.searchParams).toEqual(data.request.deserialized);
  });
});

describe('interceptors server / 拦截器链', () => {
  it('没有拦截器时应当直接执行路由处理函数并透传响应', async () => {
    const data = await loadCases();
    const expected = NextResponse.json(data.request.body, { status: 201 });
    const handler = route(async () => expected);

    const response = await handler(new NextRequest(data.request.url), {
      params: Promise.resolve(data.request.params),
    });

    expect(response).toBe(expected);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(data.request.body);
  });

  it('拦截器应当按 sequence 排序后依次执行，并能在 next 前后包裹', async () => {
    const data = await loadCases();
    const seeds = [
      data.interceptors.late,
      data.interceptors.middle,
      data.interceptors.early,
    ];
    const log: string[] = [];
    // 故意打乱注册顺序，验证执行顺序来自 sequence 而不是注册顺序
    for (const seed of seeds) {
      manager.register(
        fakeInterceptor(seed, log, async (next) => {
          const response = await next();
          response.headers.set(`x-${seed.id}`, '1');
          return response;
        }),
      );
    }
    const handler = route(async () => NextResponse.json(data.request.body));

    const response = await handler(new NextRequest(data.request.url), {
      params: Promise.resolve(data.request.params),
    });

    const expectedOrder = [...seeds]
      .sort((a, b) => a.sequence - b.sequence)
      .map((seed) => seed.id);
    expect(log).toEqual(expectedOrder);
    // next() 之后还能改响应，且外层拿到的是最终响应
    for (const seed of seeds) {
      expect(response.headers.get(`x-${seed.id}`)).toBe('1');
    }
    await expect(response.json()).resolves.toEqual(data.request.body);
  });

  it('requires 应当优先于 sequence', async () => {
    const data = await loadCases();
    const log: string[] = [];
    manager.register(fakeInterceptor(data.interceptors.dependent, log));
    manager.register(fakeInterceptor(data.interceptors.early, log));
    const handler = route(async () => NextResponse.json(data.request.body));

    await handler(new NextRequest(data.request.url), {
      params: Promise.resolve(data.request.params),
    });

    // dependent 的 sequence 更小，但声明依赖 early，所以 early 先跑
    expect(data.interceptors.dependent.sequence).toBeLessThan(
      data.interceptors.early.sequence,
    );
    expect(log).toEqual([
      data.interceptors.early.id,
      data.interceptors.dependent.id,
    ]);
  });

  it('拦截器不调用 next 时应当短路，不再执行后面的链路', async () => {
    const data = await loadCases();
    const log: string[] = [];
    const shorted = NextResponse.json({ shorted: true }, { status: 202 });
    manager.register(
      fakeInterceptor(data.interceptors.shortCircuit, log, async () => shorted),
    );
    const routeHandler = vi.fn(async () =>
      NextResponse.json(data.request.body),
    );
    const handler = route(routeHandler);

    const response = await handler(new NextRequest(data.request.url), {
      params: Promise.resolve(data.request.params),
    });

    expect(response).toBe(shorted);
    expect(log).toEqual([data.interceptors.shortCircuit.id]);
    expect(routeHandler).not.toHaveBeenCalled();
  });

  it('拦截器依赖不存在的 id 时排序会抛错', async () => {
    const data = await loadCases();
    manager.register(fakeInterceptor(data.missing, []));
    const handler = route(async () => NextResponse.json(data.request.body));

    await expect(
      handler(new NextRequest(data.request.url), {
        params: Promise.resolve(data.request.params),
      }),
    ).rejects.toThrow(/Sort Error/);
  });

  it('注册 error 拦截器后，handler 抛出的 BusinessError 应当转成响应', async () => {
    const data = await loadCases();
    manager.register(errorInterceptor);
    const handler = route(async () => {
      throw new BusinessError(
        data.businessError.message,
        data.businessError.code,
        undefined,
        data.businessError.status,
      ).withValues(data.businessError.data);
    });

    const response = await handler(new NextRequest(data.request.url), {
      params: Promise.resolve(data.request.params),
    });

    expect(response.status).toBe(data.businessError.status);
    await expect(response.json()).resolves.toEqual({
      message: data.businessError.message,
      code: data.businessError.code,
      data: data.businessError.data,
    });
  });
});
