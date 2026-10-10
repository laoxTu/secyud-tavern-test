import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessError } from '@/interceptors';
import type { NextRecord } from '@/interceptors/server';
import { errorInterceptor } from '@/interceptors/server/error';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./error.cases.json')).default);
}

/** 直接把 errorInterceptor 当成链路最后一环来调用 */
function callInterceptor(
  url: string,
  method: string,
  next: () => Promise<NextResponse>,
) {
  return errorInterceptor.handle(
    new NextRequest(url, { method }),
    {} as NextRecord,
    next,
  );
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('interceptors server / errorInterceptor 透传', () => {
  it('next 正常返回时应当原样透传响应', async () => {
    const data = await loadCases();
    const expected = NextResponse.json(data.passthrough, { status: 201 });

    const response = await callInterceptor(
      data.request.url,
      data.request.readMethod,
      async () => expected,
    );

    expect(response).toBe(expected);
  });
});

describe('interceptors server / errorInterceptor 错误映射', () => {
  it('BusinessError 应当按 status/code/data 转成 json 响应', async () => {
    const data = await loadCases();
    const businessError = new BusinessError(
      data.businessError.message,
      data.businessError.code,
      new Error(data.businessError.innerMessage),
      data.businessError.status,
    ).withValues(data.businessError.data);

    const response = await callInterceptor(
      data.request.url,
      data.request.readMethod,
      async () => {
        throw businessError;
      },
    );

    expect(response.status).toBe(data.businessError.status);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({
      message: data.businessError.message,
      code: data.businessError.code,
      data: data.businessError.data,
    });
    // 读请求不打印日志
    expect(console.error).not.toHaveBeenCalled();
  });

  it('BusinessError 缺少 status 时应当落到 500', async () => {
    const data = await loadCases();
    const businessError = new BusinessError(
      data.defaultError.message,
      data.defaultError.code,
    ).withValues(data.defaultError.data);

    const response = await callInterceptor(
      data.request.url,
      data.request.readMethod,
      async () => {
        throw businessError;
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: data.defaultError.message,
      code: data.defaultError.code,
      data: data.defaultError.data,
    });
  });

  it('写请求上的 BusinessError 应当额外打印日志', async () => {
    const data = await loadCases();
    const businessError = new BusinessError(
      data.businessError.message,
      data.businessError.code,
      undefined,
      data.businessError.status,
    );

    const response = await callInterceptor(
      data.request.url,
      data.request.writeMethod,
      async () => {
        throw businessError;
      },
    );

    expect(response.status).toBe(data.businessError.status);
    expect(console.error).toHaveBeenCalledWith(businessError);
  });

  it('普通 Error 应当转成 500 且 data 为空对象', async () => {
    const data = await loadCases();
    const plainError = new Error(data.plainError.message);

    const response = await callInterceptor(
      data.request.url,
      data.request.readMethod,
      async () => {
        throw plainError;
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      message: data.plainError.message,
      data: {},
    });
    expect(console.error).toHaveBeenCalledWith(plainError);
  });

  it('非 Error 抛出应当原样再抛，不转响应', async () => {
    const data = await loadCases();

    await expect(
      callInterceptor(data.request.url, data.request.readMethod, async () => {
        throw data.reason;
      }),
    ).rejects.toBe(data.reason);
  });
});
