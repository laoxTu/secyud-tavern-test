import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tool } from '@/tools';
import type { FetchConfig } from '@/tools/fetchers';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

// 请求层整体替换，用例只断言调用形状（url / body / signal），不真发请求
vi.mock('@/client', () => ({
  post: mocks.post,
  getBaseUrl: () => 'http://localhost:3000',
}));
// 真实的 @/components 桶会拉起 monaco，jsdom 下太重，这里换成最小桩
vi.mock('@/components', async () => {
  const React = await import('react');
  const passthrough = ({ children }: any) =>
    React.createElement('div', null, children);
  return {
    Field: passthrough,
    FieldContent: passthrough,
    FieldLabel: passthrough,
    Input: (props: any) => React.createElement('input', props),
  };
});
// ApiError 是请求层失败时抛的错，它所在的模块会顺带加载 sonner
vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
// 被测文件只用到 tools client 桶里的类型（运行期会被抹掉），挡一层避免拉起整条链
vi.mock('@/tools/client', () => ({}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { ApiError } from '@/interceptors/client';
import { fetchers as main } from '@/tools/fetchers';
import { Editor, fetchers } from '@/tools/fetchers/client';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

/** 按 Editor 渲染出来的 name 拼 FormData */
function toFormData(fields: Record<string, any>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    data.append(name, `${value}`);
  }
  return data;
}

/**
 * json 写不了 NaN，fixture 里用 '__NaN__' 占位：
 * 先把占位字段单独断言成 NaN 并剔除，再对剩下的键做整体比较。
 */
function expectConfig(actual: any, expected: any, message?: string) {
  const skip = Object.entries(expected)
    .filter(([, value]) => value === '__NaN__')
    .map(([key]) => key);
  for (const key of skip) {
    expect(Number.isNaN(actual[key]), `${message} / ${key} 应当是 NaN`).toBe(
      true,
    );
  }
  const rest = Object.fromEntries(
    Object.entries(expected).filter(([key]) => !skip.includes(key)),
  );
  const normalized = { ...actual };
  for (const key of skip) delete normalized[key];
  expect(normalized, message).toEqual(rest);
}

/** 按 fixture 里的配置造一个 url_fetch 工具 */
async function createTool(config?: FetchConfig) {
  const data = await loadCases();
  const [item] = await fetchers.create(
    { config: structuredClone(config ?? data.config) } as any,
    {} as any,
  );
  return { data, item };
}

function renderEditor(config?: FetchConfig) {
  return render(
    <Editor
      entry={{ entryId: 1, data: { type: 'fetcher', config } } as any}
      formRef={{ current: null }}
    />,
  );
}

/**
 * 中止时请求层抛的错误。
 * 不用 `new DOMException(..., 'AbortError')`：jsdom 里 DOMException.prototype 的
 * 原型链挂在另一个 Error realm 上，`instanceof Error` 为 false（见报告未确认项），
 * 这里用同一个 realm 的 Error 带上 name 来驱动被测试的超时分支。
 */
function abortError() {
  return Object.assign(new Error('The operation was aborted.'), {
    name: 'AbortError',
  });
}

/** 渲染结果里 name → value 的映射 */
function fieldValues(container: HTMLElement) {
  return Object.fromEntries(
    [...container.querySelectorAll('input')].map((u) => [
      u.getAttribute('name'),
      u.value,
    ]),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.post.mockReset();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tools fetchers client / 注册契约', () => {
  it('应当以 fetcher 注册，并提供配置表单与两个钩子', () => {
    expect(fetchers.id).toBe('fetcher');
    expect(fetchers.id).toBe(main.name);
    expect(fetchers.configComponent).toBe(Editor);
    expect(typeof fetchers.configureObject).toBe('function');
    expect(typeof fetchers.create).toBe('function');
  });
});

describe('tools fetchers client / configureObject', () => {
  it('应当把表单字段解析成 maxResults / timeout / maxLength', async () => {
    const data = await loadCases();

    for (const item of data.configure) {
      const tool: Tool<FetchConfig> = { type: 'fetcher', config: {} as any };

      await fetchers.configureObject!(toFormData(item.fields), tool);

      expectConfig(tool.config, item.expected, item.name);
    }
  });
});

describe('tools fetchers client / create', () => {
  it('应当按配置生成单个 url_fetch 工具，并声明 urls 入参', async () => {
    const { data, item } = await createTool();
    const urls = (item.parameters as any).properties.urls;

    expect(item.name).toBe('url_fetch');
    expect(item.description).toContain(`${data.config.maxResults}`);
    expect(item.parameters.required).toEqual(['urls']);
    expect(item.parameters.additionalProperties).toBe(false);
    expect(urls.type).toBe('array');
    expect(urls.description).toContain(`${data.config.maxResults}`);
    expect(urls.items).toEqual({ type: 'string', description: 'URL' });
    expect(typeof item.invoke).toBe('function');
  });

  it('maxResults 只写进描述文本，不改变入参 schema 的结构', async () => {
    const one = await createTool({ maxResults: 1, timeout: 1, maxLength: 10 });
    const five = await createTool({
      maxResults: 5,
      timeout: 1,
      maxLength: 10,
    });
    const urlsOf = (item: any) => item.parameters.properties.urls;

    expect(urlsOf(one.item).items).toEqual(urlsOf(five.item).items);
    expect(urlsOf(one.item).type).toBe(urlsOf(five.item).type);
    expect(one.item.parameters.required).toEqual(five.item.parameters.required);
    expect(one.item.parameters.additionalProperties).toBe(false);
    // 只有描述里的上限随配置变化
    expect(urlsOf(one.item).description).not.toBe(
      urlsOf(five.item).description,
    );
    expect(urlsOf(one.item).description).toContain('1');
    expect(urlsOf(five.item).description).toContain('5');
  });
});

describe('tools fetchers client / invoke', () => {
  it('应当逐个请求 proxy，并把正文拼成文本结果', async () => {
    const { data, item } = await createTool();
    mocks.post.mockResolvedValue(structuredClone(data.plain));
    const [url] = data.urls;

    const result = await item.invoke({
      args: { urls: [url] },
      controller: new AbortController(),
    });

    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith(
      'proxy',
      { url },
      { signal: expect.any(AbortSignal) },
    );
    expect(result).toBe(`${url}\r\n${data.plain.content}`);
  });

  it('urls 超过 maxResults 时应当截断，并按换行拼接每条结果', async () => {
    const { data, item } = await createTool();
    mocks.post.mockResolvedValue(structuredClone(data.plain));

    const result = await item.invoke({
      args: { urls: data.urls },
      controller: new AbortController(),
    });

    const fetched = data.urls.slice(0, data.config.maxResults);
    expect(mocks.post).toHaveBeenCalledTimes(fetched.length);
    expect(mocks.post.mock.calls.map((u) => u[1].url)).toEqual(fetched);
    expect(result).toBe(
      fetched.map((u) => `${u}\r\n${data.plain.content}`).join('\n'),
    );
  });

  it('正文超过 maxLength 时应当截断', async () => {
    const { data, item } = await createTool();
    mocks.post.mockResolvedValue(structuredClone(data.long));

    const result = await item.invoke({
      args: { urls: [data.longUrl] },
      controller: new AbortController(),
    });

    expect(data.long.content.length).toBeGreaterThan(data.config.maxLength);
    expect(result).toBe(
      `${data.longUrl}\r\n${data.long.content.substring(0, data.config.maxLength)}`,
    );
  });

  it('正文与错误都为空时结果里不应当出现字面量 undefined', async () => {
    const { data, item } = await createTool();
    mocks.post.mockResolvedValue(structuredClone(data.empty));
    const [url] = data.urls;

    const result = await item.invoke({
      args: { urls: [url] },
      controller: new AbortController(),
    });

    // 请求成功但没有正文（content 与 error 都是空），修复前会拼出 'undefined'
    expect(result).toBe(`${url}\r\nno content`);
  });

  it('html / xml 内容应当经 Readability 提取纯文本', async () => {
    const data = await loadCases();

    for (const key of ['html', 'xml'] as const) {
      const { item } = await createTool(data.readerConfig);
      const source = data[key];
      mocks.post.mockResolvedValue(structuredClone(source));

      const result = await item.invoke({
        args: { urls: [data.longUrl] },
        controller: new AbortController(),
      });

      expect(result, key).toContain(source.expectContain);
      for (const exclude of source.expectExclude ?? []) {
        expect(result, key).not.toContain(exclude);
      }
    }
  });

  it('请求失败时应当把错误信息写进结果', async () => {
    const data = await loadCases();
    const [url] = data.urls;

    for (const item of data.failures) {
      const { item: tool } = await createTool();
      mocks.post.mockRejectedValue(
        item.api
          ? new ApiError(item.message, 'error.internal')
          : new Error(item.message),
      );

      const result = await tool.invoke({
        args: { urls: [url] },
        controller: new AbortController(),
      });

      expect(result, item.name).toBe(`${url}\r\n${item.message}`);
    }
  });

  it('请求超过 timeout 秒时应当中止并返回超时提示', async () => {
    const { data, item } = await createTool();

    vi.useFakeTimers();
    try {
      mocks.post.mockImplementation(
        (_url, _body, options: any) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () =>
              reject(abortError()),
            );
          }),
      );

      const promise = item.invoke({
        args: { urls: [data.urls[0]] },
        controller: new AbortController(),
      });
      const assertion = expect(promise).resolves.toBe(
        `${data.urls[0]}\r\nRequest timeout`,
      );

      // timeout 配置的单位是秒，请求层拿到的截止时间是 *1000
      await vi.advanceTimersByTimeAsync(data.config.timeout * 1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('引擎的 signal 应当被转成子信号传给请求层', async () => {
    const { data, item } = await createTool();
    let received: AbortSignal | undefined;
    mocks.post.mockImplementation((_url, _body, options: any) => {
      received = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(abortError()));
      });
    });

    vi.useFakeTimers();
    try {
      const outer = new AbortController();
      const promise = item.invoke({
        args: { urls: [data.urls[0]] },
        controller: outer,
      });

      expect(received).toBeDefined();
      expect(received).not.toBe(outer.signal);
      expect(received!.aborted).toBe(false);

      outer.abort();

      expect(received!.aborted).toBe(true);
      await promise;
      vi.clearAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('tools fetchers client / Editor', () => {
  // Editor 现在先克隆 defaultConfig 再 merge，默认值不再被渲染改写，
  // 「默认值」用例与带配置的渲染之间没有顺序依赖。
  it('没有条目配置时应当回落到默认配置', async () => {
    const data = await loadCases();

    const { container } = renderEditor();

    expect(fieldValues(container)).toEqual(
      Object.fromEntries(
        data.editor.defaultFields.map((u) => [u.name, u.value]),
      ),
    );
  });

  it('渲染带配置的编辑器后默认值不应当被改写', async () => {
    const data = await loadCases();

    // 先渲染一次带配置的编辑器，再渲染空配置：修复前 merge 就地合并会让第二次
    // 渲染回落到上一个条目的配置，而不是 data.editor.defaultFields。
    renderEditor(data.editor.config);
    const { container } = renderEditor();

    expect(fieldValues(container)).toEqual(
      Object.fromEntries(
        data.editor.defaultFields.map((u) => [u.name, u.value]),
      ),
    );
  });

  it('应当渲染出与 configureObject 一致的三个表单字段', async () => {
    const data = await loadCases();

    const { container } = renderEditor(data.editor.config);

    expect(fieldValues(container)).toEqual(
      Object.fromEntries(data.editor.fields.map((u) => [u.name, u.value])),
    );
  });
});
