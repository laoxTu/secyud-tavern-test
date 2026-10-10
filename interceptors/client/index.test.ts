import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** 真实实现在没有 i18n provider 时也是原样返回 code */
  translate: vi.fn((message: string) => message),
}));

// 只替换 UI 边界：toast 与 translator
vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock('@/components', () => ({
  translator: { t: undefined, translate: mocks.translate },
}));

import { handleResponse } from '@/client';
import { BusinessError } from '@/interceptors';
import {
  ApiError,
  error,
  handler,
  isAbortError,
  isHttpError,
  isNetworkError,
  success,
} from '@/interceptors/client';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

function jsonResponse(body: unknown, status: number, contentType: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': contentType },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('interceptors client / ApiError', () => {
  it('应当带上 message / code / data，status 默认 500', async () => {
    const data = await loadCases();

    const apiError = new ApiError(
      data.apiError.message,
      data.apiError.code,
      data.apiError.data,
    );

    expect(apiError).toBeInstanceOf(BusinessError);
    expect(apiError).toBeInstanceOf(Error);
    expect(apiError.message).toBe(data.apiError.message);
    expect(apiError.code).toBe(data.apiError.code);
    expect(apiError.data).toEqual(data.apiError.data);
    expect(apiError.status).toBe(500);
    expect(apiError.innerError).toBeUndefined();
  });

  it('data 应当是拷贝一份，不与入参共享引用', async () => {
    const data = await loadCases();
    const source = data.apiError.data;

    const apiError = new ApiError(
      data.apiError.message,
      data.apiError.code,
      source,
    );

    expect(apiError.data).toEqual(source);
    expect(apiError.data).not.toBe(source);
  });

  it('没有 data 时应当保留 BusinessError 的空 data', async () => {
    const data = await loadCases();

    expect(new ApiError(data.apiError.fallbackMessage).data).toEqual({});
  });
});

describe('interceptors client / handleResponse', () => {
  it('非 json 内容应当原样返回 Response', async () => {
    const data = await loadCases();
    const plain = new Response(data.handleResponse.plainText, {
      status: data.handleResponse.okStatus,
      headers: { 'Content-Type': data.handleResponse.htmlContentType },
    });

    await expect(handleResponse(plain)).resolves.toBe(plain);
  });

  it('json + ok 应当返回解析后的对象', async () => {
    const data = await loadCases();
    const response = jsonResponse(
      data.handleResponse.okBody,
      data.handleResponse.okStatus,
      data.handleResponse.jsonContentType,
    );

    await expect(handleResponse(response)).resolves.toEqual(
      data.handleResponse.okBody,
    );
  });

  it('json + !ok 应当抛 ApiError 并带上 message/code/data', async () => {
    const data = await loadCases();
    const response = jsonResponse(
      data.handleResponse.errorBody,
      data.handleResponse.errorStatus,
      data.handleResponse.jsonContentType,
    );

    const thrown = await handleResponse(response).catch((err) => err);

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown.message).toBe(data.handleResponse.errorBody.message);
    expect(thrown.code).toBe(data.handleResponse.errorBody.code);
    expect(thrown.data).toEqual(data.handleResponse.errorBody.data);
  });

  it('json + !ok 且缺 message 时应当回落 Internal Server Error', async () => {
    const data = await loadCases();
    const response = jsonResponse(
      data.handleResponse.emptyErrorBody,
      data.handleResponse.errorStatus,
      data.handleResponse.jsonContentType,
    );

    const thrown = await handleResponse(response).catch((err) => err);

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown.message).toBe(data.handleResponse.fallbackMessage);
    expect(thrown.code).toBe(data.handleResponse.emptyErrorBody.code);
  });
});

describe('interceptors client / 错误判定', () => {
  it('isNetworkError 只认 TypeError 里的网络类关键字', async () => {
    const data = await loadCases();

    for (const message of data.network.matched) {
      expect(isNetworkError(new TypeError(message))).toBe(true);
    }
    for (const message of data.network.unmatched) {
      expect(isNetworkError(new TypeError(message))).toBe(false);
    }
    // 关键字相同但不是 TypeError 就不算
    expect(isNetworkError(new Error(data.network.matched[0]))).toBe(false);
    expect(isNetworkError(data.network.matched[0])).toBe(false);
  });

  it('isAbortError 只认 name 为 AbortError 的 DOMException', async () => {
    const data = await loadCases();

    expect(
      isAbortError(new DOMException(data.abort.message, data.abort.name)),
    ).toBe(true);
    expect(
      isAbortError(new DOMException(data.abort.message, data.abort.otherName)),
    ).toBe(false);
    expect(isAbortError(new TypeError(data.abort.message))).toBe(false);
  });

  it('isHttpError 认 status 与 response.status 两种形态', async () => {
    const data = await loadCases();

    for (const value of data.http.matched) {
      expect(isHttpError(value)).toBe(true);
    }
    for (const value of data.http.unmatched) {
      expect(isHttpError(value)).toBe(false);
    }
    expect(isHttpError(undefined)).toBe(false);
  });
});

describe('interceptors client / success 与 error', () => {
  it('success 应当弹成功提示', async () => {
    const data = await loadCases();

    success(data.toast.successMessage);

    expect(mocks.toastSuccess).toHaveBeenCalledWith(data.toast.successMessage, {
      richColors: true,
    });
  });

  it('error 对带 code 的 BusinessError 应当交给 translator 再弹提示', async () => {
    const data = await loadCases();
    const apiError = new ApiError(
      data.apiError.message,
      data.apiError.code,
      data.apiError.data,
    );

    error(apiError);

    expect(mocks.translate).toHaveBeenCalledWith(
      data.apiError.code,
      data.apiError.data,
    );
    expect(mocks.toastError).toHaveBeenCalledWith(data.apiError.code, {
      richColors: true,
    });
    expect(console.error).toHaveBeenCalledWith(apiError);
  });

  it('error 对字符串应当原样弹提示', async () => {
    const data = await loadCases();

    error(data.toast.stringError);

    expect(mocks.toastError).toHaveBeenCalledWith(data.toast.stringError, {
      richColors: true,
    });
  });

  it('error 对网络错误 / http 错误 / abort 应当弹 message', async () => {
    const data = await loadCases();

    const networkError = new TypeError(data.network.matched[0]);
    error(networkError);
    expect(mocks.toastError).toHaveBeenCalledWith(networkError.message, {
      richColors: true,
    });

    const httpError = {
      ...data.http.matched[0],
      message: data.toast.httpMessage,
    };
    error(httpError);
    expect(mocks.toastError).toHaveBeenCalledWith(data.toast.httpMessage, {
      richColors: true,
    });

    const abortError = new DOMException(data.abort.message, data.abort.name);
    error(abortError);
    expect(mocks.toastError).toHaveBeenCalledWith(data.abort.message, {
      richColors: true,
    });
  });

  it('error 对没有 code 的 BusinessError 会落到 isHttpError 分支弹原始 message', async () => {
    const data = await loadCases();
    const noCode = new BusinessError(data.apiError.message);

    error(noCode);

    // BusinessError 的 status 默认 500，被 isHttpError 认成 http 错误，因此不翻译直接弹 message
    expect(mocks.translate).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(data.apiError.message, {
      richColors: true,
    });
  });

  it('error 对既没有 status 也无法识别的对象应当继续抛出', async () => {
    const data = await loadCases();
    const unknown = { reason: data.toast.unknownMessage };

    expect(() => error(unknown)).toThrow(unknown);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});

describe('interceptors client / handler', () => {
  it('成功时应当返回结果、跑 finish，且不弹提示', async () => {
    const data = await loadCases();
    const action = vi.fn<
      (...args: [any, any]) => Promise<any>
    >().mockResolvedValue(data.handler.result);
    const finish = vi.fn<(...args: [any, any]) => Promise<void>>()
      .mockResolvedValue(undefined);
    const wrapped = handler(action, finish);

    await expect(
      wrapped(...(data.handler.args as [any, any])),
    ).resolves.toEqual(data.handler.result);

    expect(action).toHaveBeenCalledWith(...data.handler.args);
    expect(finish).toHaveBeenCalledWith(...data.handler.args);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('失败时应当吞掉错误、弹提示、跑 finish，并返回 undefined', async () => {
    const data = await loadCases();
    const apiError = new ApiError(
      data.apiError.message,
      data.apiError.code,
      data.apiError.data,
    );
    const action = vi.fn<
      (...args: [any, any]) => Promise<any>
    >().mockRejectedValue(apiError);
    const finish = vi.fn<(...args: [any, any]) => Promise<void>>()
      .mockResolvedValue(undefined);
    const wrapped = handler(action, finish);

    await expect(
      wrapped(...(data.handler.args as [any, any])),
    ).resolves.toBeUndefined();

    expect(mocks.toastError).toHaveBeenCalledWith(data.apiError.code, {
      richColors: true,
    });
    expect(finish).toHaveBeenCalledWith(...data.handler.args);
  });

  it('未识别的错误应当先跑 finish 再继续抛出', async () => {
    const data = await loadCases();
    const unknown = { reason: data.toast.unknownMessage };
    const calls: string[] = [];
    const action = vi.fn<
      (...args: [any, any]) => Promise<any>
    >().mockRejectedValue(unknown);
    const finish = vi.fn<(...args: [any, any]) => Promise<void>>(async () => {
      calls.push('finish');
    });
    const wrapped = handler(action, finish);

    await expect(wrapped(...(data.handler.args as [any, any]))).rejects.toBe(
      unknown,
    );

    expect(calls).toEqual(['finish']);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('不传 finish 时也应当正常工作', async () => {
    const data = await loadCases();
    const wrapped = handler(async () => data.handler.result);

    await expect(wrapped()).resolves.toEqual(data.handler.result);
  });
});
