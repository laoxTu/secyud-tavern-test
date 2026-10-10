import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  /** 当前用例要返回的 locale cookie */
  cookie: undefined as string | undefined,
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'locale' && mocks.cookie !== undefined
        ? { value: mocks.cookie }
        : undefined,
  }),
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
// jsdom 里 next-intl/server 的 getRequestConfig 会直接抛「不支持 Client Component」，
// 它本身是恒等包装，这里换掉它就能直接驱动我们自己的回调
vi.mock('next-intl/server', () => ({
  getRequestConfig: (fn: unknown) => fn,
}));

import { defaultLocale, timeZones } from '@/localization/config';
import request from '@/localization/request';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./request.cases.json')).default);
}

/** 按 next-intl 的调用方式触发配置回调 */
async function resolve() {
  return await (request as any)({ requestLocale: undefined });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  mocks.cookie = undefined;
});

describe('localization request / locale 解析', () => {
  it('没有 cookie 时用默认语言', async () => {
    const result = await resolve();

    expect(result.locale).toBe(defaultLocale);
  });

  it('cookie 里的语言会被采用', async () => {
    const data = await loadCases();

    for (const locale of [data.cookies.zh, data.cookies.en]) {
      mocks.cookie = locale;

      const result = await resolve();

      expect(result.locale).toBe(locale);
    }
  });

  it('不支持的语言会走 notFound', async () => {
    const data = await loadCases();
    mocks.cookie = data.cookies.unsupported;

    await expect(resolve()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });

  it('只有 locales 里精确列出的值才被接受（带地区后缀的会被拒）', async () => {
    const data = await loadCases();
    mocks.cookie = data.cookies.withRegion;

    await expect(resolve()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('localization request / messages 合并', () => {
  it('应当按 locale 合并出对应语言的文案', async () => {
    const data = await loadCases();

    for (const [locale, expected] of Object.entries(data.locales)) {
      mocks.cookie = locale;

      const result = await resolve();

      expect(result.messages.theme.dark, locale).toBe(expected.themeDark);
      expect(result.messages.theme.light, locale).toBe(expected.themeLight);
    }
  });

  it('应当合并多个模块的文案，而不是只有最后一个', async () => {
    const result = await resolve();

    // files 模块的 file.id 与 global 模块的 default.name 应当同时存在
    expect(result.messages.file.id).toBeTruthy();
    expect(result.messages.default.name).toBeTruthy();
    expect(result.messages.message.create.success).toBeTruthy();
  });

  it('messages 不该是空对象', async () => {
    const result = await resolve();

    expect(Object.keys(result.messages).length).toBeGreaterThan(0);
  });
});

describe('localization request / 其它字段', () => {
  it('应当带上时区与当前时间', async () => {
    const before = Date.now();

    const result = await resolve();

    expect(result.timeZone).toBe(timeZones.CN);
    expect(result.now).toBeInstanceOf(Date);
    expect(result.now!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('每个用例拿到的是新的 now', async () => {
    const first = await resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await resolve();

    expect(second.now!.getTime()).toBeGreaterThan(first.now!.getTime());
  });
});
