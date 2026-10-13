import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ raw: vi.fn() }));

// 只拦代理层：用例关心的是工具映射与调用形状，不真发请求
vi.mock('@/global/client/proxy', () => ({ proxy: { raw: mocks.raw } }));
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
    Textarea: (props: any) => React.createElement('textarea', props),
    rowQuat: 'row-span-2',
    spanHalf: 'lg:col-span-2',
    submitTargetFormOnKey: () => {},
  };
});
// 被测文件只用到 tools client 桶里的类型（运行期会被抹掉），挡一层避免拉起整条链
vi.mock('@/tools/client', () => ({}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { BusinessError } from '@/interceptors';
import type { Tool } from '@/tools';
import { mcp as main, McpConfig } from '@/tools/mcp';
import { Editor, mcp } from '@/tools/mcp/client';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

/** json 响应，会话id按 Streamable HTTP 的约定放在响应头里 */
function jsonResponse(payload: any, session?: string) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...(session ? { 'mcp-session-id': session } : {}),
    },
  });
}

function ok(id: number, result: any) {
  return { jsonrpc: '2.0', id, result };
}

/** 按方法分发响应，模拟一个最小的 mcp 服务器 */
function serve(
  data: any,
  handlers: Record<string, (payload: any) => Response> = {},
) {
  mocks.raw.mockImplementation(async (param: any) => {
    const payload = JSON.parse(param.body);
    const routes: Record<string, (payload: any) => Response> = {
      initialize: (p: any) =>
        jsonResponse(ok(p.id, data.initializeResult), data.sessionId),
      'notifications/initialized': () => new Response(null, { status: 202 }),
      'tools/list': (p: any) => jsonResponse(ok(p.id, data.tools)),
      ...handlers,
    };
    const handler = routes[payload.method];
    if (!handler) throw new Error(`unexpected method: ${payload.method}`);
    return handler(payload);
  });
}

/** 造一个工具条目，只用到 config 字段 */
async function createTools(config?: Partial<McpConfig>) {
  const data = await loadCases();
  const items = await mcp.tool.create(
    { config: { ...data.config, ...config } } as any,
    {} as any,
  );
  return { data, items };
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

function renderEditor(config?: Partial<McpConfig>) {
  return render(
    <Editor
      entry={{ entryId: 1, data: { type: 'mcp', config } } as any}
      formRef={{ current: null }}
    />,
  );
}

/** 渲染结果里 name → value 的映射，输入框与大段文本一起收 */
function fieldValues(container: HTMLElement) {
  return Object.fromEntries(
    [...container.querySelectorAll('input, textarea')].map((u) => [
      u.getAttribute('name'),
      (u as HTMLInputElement).value,
    ]),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.raw.mockReset();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tools mcp client / 注册契约', () => {
  it('应当以 mcp 注册，并提供配置表单与两个钩子', () => {
    expect(mcp.tool.id).toBe('mcp');
    expect(mcp.tool.id).toBe(main.name);
    expect(mcp.tool.configComponent).toBe(Editor);
    expect(typeof mcp.tool.configureObject).toBe('function');
    expect(typeof mcp.tool.create).toBe('function');
  });
});

describe('tools mcp client / configureObject', () => {
  it('应当按用例把表单字段解析成配置', async () => {
    const data = await loadCases();

    for (const item of data.configure) {
      const tool: Tool<McpConfig> = { type: 'mcp', config: {} as any };

      const run = mcp.tool.configureObject!(toFormData(item.fields), tool);

      if (item.error) {
        await expect(run, item.name).rejects.toMatchObject({
          code: item.error.code,
          data: { target: item.error.target },
        });
        continue;
      }

      await run;
      expect(tool.config, item.name).toEqual(item.expected);
    }
  });

  it('超时与长度不是数字时是 NaN，交给上层回落默认值', async () => {
    const tool: Tool<McpConfig> = { type: 'mcp', config: {} as any };

    await mcp.tool.configureObject!(
      toFormData({ headers: '{}', timeout: 'abc', max_length: '' }),
      tool,
    );

    expect(Number.isNaN(tool.config.timeout)).toBe(true);
    expect(Number.isNaN(tool.config.maxLength)).toBe(true);
  });

  it('请求头非法时抛的是 BusinessError', async () => {
    const tool: Tool<McpConfig> = { type: 'mcp', config: {} as any };

    await expect(
      mcp.tool.configureObject!(toFormData({ headers: 'x' }), tool),
    ).rejects.toThrow(BusinessError);
  });
});

describe('tools mcp client / create', () => {
  it('应当按前缀生成服务器上的工具，并把 schema 原样透传', async () => {
    const data = await loadCases();
    serve(data);

    const { items } = await createTools();

    expect(items.map((u) => u.name)).toEqual([
      'demo_echo',
      'demo_secret',
      'demo_bare',
    ]);
    expect(items[0].description).toBe(data.tools.tools[0].description);
    expect(items[0].parameters).toEqual(data.tools.tools[0].inputSchema);
    expect(typeof items[0].invoke).toBe('function');
  });

  it('没有 schema 的工具应当兜底成空对象 schema', async () => {
    const data = await loadCases();
    serve(data);

    const { items } = await createTools();

    const bare = items.find((u) => u.name === 'demo_bare')!;
    expect(bare.parameters).toEqual({
      type: 'object',
      additionalProperties: false,
    });
  });

  it('includes 非空时只暴露白名单里的工具', async () => {
    const data = await loadCases();
    serve(data);

    const { items } = await createTools({ includes: ['echo', 'bare'] });

    expect(items.map((u) => u.name)).toEqual(['demo_echo', 'demo_bare']);
  });

  it('没有前缀时用工具原名', async () => {
    const data = await loadCases();
    serve(data);

    const { items } = await createTools({ code: '' });

    expect(items.map((u) => u.name)).toEqual(['echo', 'secret', 'bare']);
  });

  it('服务器拿不到工具列表时返回空数组，不让整个预设加载失败', async () => {
    mocks.raw.mockRejectedValue(new Error('network down'));

    const { items } = await createTools();

    expect(items).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('tools mcp client / invoke', () => {
  it('应当调 tools/call，并截断超长结果', async () => {
    const data = await loadCases();
    const sent: any[] = [];
    serve(data, {
      'tools/call': (p) => {
        sent.push(p);
        return jsonResponse(
          ok(p.id, { content: [{ type: 'text', text: data.longText }] }),
        );
      },
    });

    const { items } = await createTools({ code: '', maxLength: 10 });

    const result = await items[0].invoke({
      args: { text: 'hi' },
      controller: new AbortController(),
    });

    expect(result).toBe(data.longText.substring(0, 10));
    expect(sent.at(-1)!.params).toEqual({
      name: 'echo',
      arguments: { text: 'hi' },
    });
  });

  it('长度限制为 0 时不截断', async () => {
    const data = await loadCases();
    serve(data, {
      'tools/call': (p) =>
        jsonResponse(
          ok(p.id, { content: [{ type: 'text', text: data.longText }] }),
        ),
    });

    const { items } = await createTools({ code: '', maxLength: 0 });

    const result = await items[0].invoke({
      args: {},
      controller: new AbortController(),
    });

    expect(result).toBe(data.longText);
  });
});

describe('tools mcp client / Editor', () => {
  it('没有条目配置时应当回落到默认配置', async () => {
    const data = await loadCases();

    const { container } = renderEditor();

    expect(fieldValues(container)).toEqual(data.editor.defaultFields);
  });

  it('渲染带配置的编辑器后默认值不应当被改写', async () => {
    const data = await loadCases();

    // merge 是就地合并，修复前渲染一次带配置的编辑器会让第二次渲染回落到上一个条目
    renderEditor(data.editor.config);
    const { container } = renderEditor();

    expect(fieldValues(container)).toEqual(data.editor.defaultFields);
  });

  it('应当渲染出与 configureObject 一致的表单字段', async () => {
    const data = await loadCases();

    const { container } = renderEditor(data.editor.config);

    expect(fieldValues(container)).toEqual(data.editor.fields);
  });
});
