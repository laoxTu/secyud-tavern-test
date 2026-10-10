import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tool } from '@/tools';
import type { ScriptConfig } from '@/tools/scripts';

const mocks = vi.hoisted(() => {
  const historyGet = vi.fn();
  const realms: { iframe: any; history: { get: any } } = {
    iframe: null,
    history: { get: historyGet },
  };
  return { historyGet, realms };
});

// 真实的 @/components 桶会拉起 monaco，jsdom 下太重，这里换成最小桩
vi.mock('@/components', async () => {
  const React = await import('react');
  const passthrough = ({ children }: any) =>
    React.createElement('div', null, children);
  return {
    Checkbox: (props: any) =>
      React.createElement('input', { type: 'checkbox', ...props }),
    Field: passthrough,
    FieldContent: passthrough,
    FieldLabel: passthrough,
    Input: (props: any) => React.createElement('input', props),
    MonacoEditor: ({ name, value }: any) =>
      React.createElement('input', {
        type: 'hidden',
        name,
        defaultValue: value ?? '',
      }),
    Textarea: (props: any) => React.createElement('textarea', props),
    rowFull: 'row-span-8',
    rowQuat: 'row-span-2',
    spanHalf: 'lg:col-span-2',
    submitTargetFormOnKey: () => {},
  };
});
// 只读 realms.iframe 与 realms.history.get，真实实现会拉起 models / stories 一大串
vi.mock('@/stories/client/realms', () => ({ realms: mocks.realms }));
// 被测文件只用到 tools client 桶里的类型（运行期会被抹掉），挡一层避免拉起整条链
vi.mock('@/tools/client', () => ({}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { scripts as main } from '@/tools/scripts';
import { Editor, scripts } from '@/tools/scripts/client';

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

async function createScript(config: Partial<ScriptConfig>, realm: any = {}) {
  const [item] = await scripts.tool.create(
    { config: structuredClone(config) } as any,
    realm,
  );
  return item;
}

function renderEditor(config?: Partial<ScriptConfig>) {
  return render(
    <Editor
      entry={{ entryId: 1, data: { type: 'script', config } } as any}
      formRef={{ current: null }}
    />,
  );
}

function fieldNames(container: HTMLElement) {
  return [...container.querySelectorAll('input,textarea')]
    .map((u) => u.getAttribute('name'))
    .filter((u): u is string => !!u)
    .sort();
}

function fieldElement(container: HTMLElement, name: string) {
  const element = container.querySelector(`[name="${name}"]`) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  expect(element, `找不到字段 ${name}`).not.toBeNull();
  return element!;
}

/** 逐字段比较渲染结果：布尔字段看勾选状态，其余看 value */
function expectFields(container: HTMLElement, expected: Record<string, any>) {
  for (const [name, value] of Object.entries(expected)) {
    const element = fieldElement(container, name);
    if (typeof value === 'boolean') {
      expect((element as HTMLInputElement).checked, name).toBe(value);
    } else {
      expect((element as HTMLInputElement).value, name).toBe(value);
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.realms.iframe = null;
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  // schema 非法时 jsonUtils.parse 会 warn，这里静音
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tools scripts client / 注册契约', () => {
  // 注意顺序：Editor 用 jsonUtils.merge(defaultConfig, data.config) 就地合并，
  // 带配置的渲染会改写 scripts.default 本身，这条断言必须跑在渲染用例之前。
  it('应当以 script 注册，并把默认配置挂在 default 上', async () => {
    const data = await loadCases();

    expect(scripts.name).toBe('script');
    expect(scripts.tool.id).toBe(main.name);
    expect(scripts.tool.id).toBe(scripts.name);
    expect(scripts.default).toEqual(data.defaultConfig);
    expect(scripts.tool.configComponent).toBe(Editor);
    expect(typeof scripts.tool.configureObject).toBe('function');
    expect(typeof scripts.tool.create).toBe('function');
  });
});

describe('tools scripts client / configureObject', () => {
  it('应当把表单字段读成脚本配置，并校验 schema', async () => {
    const data = await loadCases();

    for (const item of data.configure) {
      const tool: Tool<ScriptConfig> = { type: 'script', config: {} as any };

      if (item.error) {
        await expect(
          scripts.tool.configureObject!(toFormData(item.fields), tool),
          item.name,
        ).rejects.toMatchObject({
          code: item.error.code,
          data: { target: item.error.target },
        });
      } else {
        await scripts.tool.configureObject!(toFormData(item.fields), tool);
        expect(tool.config, item.name).toEqual(item.expected);
      }
    }
  });
});

describe('tools scripts client / create', () => {
  it('应当按配置生成工具，名称 / 描述 / 参数都来自 config', async () => {
    const data = await loadCases();
    const item = await createScript(data.config as any);

    expect(item.name).toBe(data.config.code);
    expect(item.description).toBe(data.config.description);
    expect(item.parameters).toEqual(JSON.parse(data.config.schema));
    expect(typeof item.invoke).toBe('function');
  });

  it('description 与 schema 缺省时用空描述与空 schema', async () => {
    const item = await createScript({ code: 'bare' });

    expect(item.name).toBe('bare');
    expect(item.description).toBe('');
    expect(item.parameters).toEqual({});
  });

  it('脚本在 create 阶段就被编译，语法错误会直接失败', async () => {
    await expect(
      createScript({ code: 'bad', script: 'return (' }),
    ).rejects.toThrow();
  });
});

describe('tools scripts client / invoke', () => {
  it('应当把脚本返回值转成字符串结果', async () => {
    const data = await loadCases();

    for (const item of data.invoke) {
      const tool = await createScript({
        ...data.config,
        script: item.script,
      } as any);

      const result = await tool.invoke({
        args: item.args,
        controller: new AbortController(),
      } as any);

      expect(result, item.name).toBe(item.expected);
    }
  });

  it('脚本抛错时原样向外抛，不包装也不转成文本结果', async () => {
    const tool = await createScript({
      code: 'boom',
      script: 'throw new Error("boom");',
    });

    await expect(
      tool.invoke({ args: {}, controller: new AbortController() } as any),
    ).rejects.toThrow('boom');
  });
});

describe('tools scripts client / 上下文注入', () => {
  it('应当按 enableDoc / enableVariable 决定注入什么', async () => {
    const data = await loadCases();

    for (const item of data.context) {
      mocks.historyGet.mockReset();
      mocks.historyGet.mockResolvedValue({
        variables: structuredClone(data.variables),
      });
      mocks.realms.iframe = item.enableDoc ? structuredClone(data.iframe) : null;
      const realm = { id: 'realm-1' };

      const tool = await createScript(
        {
          code: 'ctx',
          schema: '{}',
          enableDoc: item.enableDoc,
          enableVariable: item.enableVariable,
          script: data.contextScript,
        },
        realm,
      );

      const result = await tool.invoke({
        args: {},
        controller: new AbortController(),
      } as any);

      expect(JSON.parse(result), item.name).toEqual(item.expected);
      expect(mocks.historyGet, item.name).toHaveBeenCalledTimes(
        item.enableVariable ? 1 : 0,
      );
      if (item.enableVariable) {
        expect(mocks.historyGet).toHaveBeenCalledWith(null, realm);
      }
    }
  });
});

describe('tools scripts client / Editor', () => {
  // 注意顺序：Editor 用 jsonUtils.merge(defaultConfig, data.config) 就地合并，
  // scripts.default 与源码里的 defaultConfig 是同一个对象，带配置的渲染会把它改写。
  // 这条「默认值」用例必须跑在带配置的渲染之前（见报告的未确认项）。
  it('没有条目配置时应当回落到默认配置', async () => {
    const data = await loadCases();

    const { container } = renderEditor();

    expect(fieldNames(container)).toEqual([...data.fieldNames].sort());
    expectFields(container, data.editor.defaultFields);
  });

  it('渲染出来的字段名应当与 configureObject 读取的一致', async () => {
    const data = await loadCases();

    const { container } = renderEditor(data.editor.config);

    expect(fieldNames(container)).toEqual([...data.fieldNames].sort());
    expectFields(container, data.editor.fields);
  });
});
