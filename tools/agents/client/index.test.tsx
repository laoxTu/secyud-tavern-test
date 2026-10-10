import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const controls: Record<string, any[]> = {};
  return {
    controls,
    /** 收集桩控件的 props，同时把 children 透传下去（否则嵌套控件不会被 React 调用） */
    record(tag: string, props: any) {
      (controls[tag] ??= []).push(props);
      return props?.children ?? null;
    },
    setRealmInfo: vi.fn(),
    realmGet: vi.fn(),
    initialize: vi.fn(),
    generate: vi.fn(),
    info: vi.fn(),
  };
});

/**
 * 真实 `@/components` 桶会把 monaco 一起拉起来，jsdom 下很重；
 * 这里只保留 Editor 用到的控件并把 props 记下来，用来断言「表单字段 ↔ configureObject 读取的字段」一致。
 * `combobox.get/getAll` 与 `@/components/combobox` 的真实实现保持一致（forms + jsonUtils.parse）。
 */
vi.mock('@/components', async () => {
  const { forms } = await import('@/global');
  const { jsonUtils } = await import('@/utils');
  return {
    Checkbox: (props: any) => mocks.record('Checkbox', props),
    Field: (props: any) => mocks.record('Field', props),
    FieldContent: (props: any) => mocks.record('FieldContent', props),
    FieldLabel: (props: any) => mocks.record('FieldLabel', props),
    Input: (props: any) => mocks.record('Input', props),
    MonacoEditor: (props: any) => mocks.record('MonacoEditor', props),
    TagBox: (props: any) => mocks.record('TagBox', props),
    Textarea: (props: any) => mocks.record('Textarea', props),
    combobox: {
      get: (data: FormData, name: string) =>
        jsonUtils.parse(forms.str(data, name)),
      getAll: (data: FormData, name: string) =>
        forms.strs(data, name).map((u) => jsonUtils.parse(u)),
    },
    rowFull: 'row-full',
    rowQuat: 'row-quat',
    spanHalf: 'span-half',
    submitTargetFormOnKey: () => {},
  };
});

/** 用例只关心 agent 工具对 models.processers 的调用形状，模型层整体换成桩 */
vi.mock('@/models/client', async () => {
  const { models: main } = await import('@/models');
  return {
    models: {
      toNameValue: main.toNameValue,
      processers: {
        initialize: mocks.initialize,
        generate: mocks.generate,
      },
    },
    ModelNameValueField: (props: any) =>
      mocks.record('ModelNameValueField', props),
  };
});

vi.mock('@/presets/client', async () => {
  const { presets: main } = await import('@/presets');
  return {
    presets: { toNameValue: main.toNameValue, tags: main.tags },
    PresetNameValuesField: (props: any) =>
      mocks.record('PresetNameValuesField', props),
  };
});

vi.mock('@/stories/client', () => ({
  stories: { proxy: { realm: { get: mocks.realmGet } } },
}));

vi.mock('@/stories/client/realms', () => ({
  useRealmState: { getState: () => ({ setRealmInfo: mocks.setRealmInfo }) },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import type { Model } from '@/models';
import { models as mainModels } from '@/models';
import { presets as mainPresets } from '@/presets';
import { agents, Editor } from '@/tools/agents/client';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

/**
 * Editor 里的 `jsonUtils.merge` 曾经就地改写模块级 defaultConfig；现在它先克隆再合并，
 * 这里保留用例开头的一份快照 + 每个用例结束后恢复，作为防回归的兜底。
 */
const defaultSnapshot = structuredClone(agents.default);

/** 按控件真实的表单结构拼 FormData；数组字段每个值一条 */
function toFormData(fields: Record<string, any>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) form.append(name, `${item}`);
    } else {
      form.append(name, `${value}`);
    }
  }
  return form;
}

/**
 * json 写不了 NaN，fixture 里用 '__NaN__' 占位：
 * 先把占位字段单独断言成 NaN 并剔除，再对剩下的键做整体比较。
 * 同时把 null 与 undefined 视作同一件事（FormData 缺字段与空串的差别见「可疑」一节）。
 */
function expectConfig(actual: any, expected: any, message?: string) {
  const normalize = (value: any): any => {
    if (value === null) return undefined;
    if (Array.isArray(value)) return value.map(normalize);
    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, normalize(item)]),
      );
    }
    return value;
  };
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
  const normalized = normalize(actual);
  for (const key of skip) delete normalized[key];
  expect(normalized, message).toEqual(normalize(rest));
}

/** 把桩控件记录到的 name 收集起来 */
function controlNames() {
  return Object.values(mocks.controls)
    .flat()
    .map((u) => u.name)
    .filter((u) => typeof u === 'string') as string[];
}

function controlProps(tag: string, name?: string) {
  const items = mocks.controls[tag] ?? [];
  return name ? items.find((u) => u.name === name) : items[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  for (const key of Object.keys(mocks.controls)) delete mocks.controls[key];
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(agents.default)) {
    delete (agents.default as any)[key];
  }
  Object.assign(agents.default, structuredClone(defaultSnapshot));
});

describe('agents client / 注册契约', () => {
  it('应当注册成 agent 工具并暴露默认配置与创建入口', () => {
    expect(agents.name).toBe('agent');
    expect(Object.keys(agents).sort()).toEqual([
      'create',
      'default',
      'name',
      'tool',
    ]);
    expect(agents.tool.id).toBe(agents.name);
    expect(agents.tool.configComponent).toBe(Editor);
    // agents.create 与 tool.create 是同一个函数（注册用的是 tool）
    expect(agents.create).toBe(agents.tool.create);
    expect(typeof agents.tool.configureObject).toBe('function');
  });

  it('默认配置应当与源码里的 defaultConfig 一致', () => {
    expect(agents.default).toEqual({
      disablePreset: false,
      maxLength: 0,
      code: '',
      description: '',
      disableTags: [],
      model: null,
      presets: [],
      schema: JSON.stringify(
        { type: 'object', additionalProperties: false },
        null,
        2,
      ),
    });
  });
});

describe('agents client / configureObject', () => {
  it('应当按表单字段构造 config', async () => {
    const data = await loadCases();
    const tool = { type: 'agent', config: {} } as any;

    await agents.tool.configureObject!(toFormData(data.form), tool);

    expectConfig(tool.config, data.expectedConfig);
  });

  it('表单缺字段时应当落到空值', async () => {
    const data = await loadCases();
    const tool = { type: 'agent', config: {} } as any;

    await agents.tool.configureObject!(toFormData(data.minimalForm), tool);

    expectConfig(tool.config, data.minimalExpectedConfig);
  });

  it('schema 非法时应当抛 error.json_invalid 并带上 target', async () => {
    const data = await loadCases();

    for (const item of data.invalidSchemas) {
      const tool = { type: 'agent', config: {} } as any;

      await expect(
        agents.tool.configureObject!(toFormData(item.fields), tool),
        item.name,
      ).rejects.toMatchObject({
        code: 'error.json_invalid',
        data: { target: 'default.schema' },
      });
    }
  });

  it('解析结果是假值但合法的 schema（null 字面量）应当通过', async () => {
    const data = await loadCases();
    const tool = { type: 'agent', config: {} } as any;

    await agents.tool.configureObject!(
      toFormData({ schema: data.falsySchema }),
      tool,
    );

    // 修复前 validJson 用解析结果的真值判断，'null' 会被误判成 error.json_invalid
    expect(tool.config.schema).toBe(data.falsySchema);
  });
});

describe('agents client / Editor 表单契约', () => {
  it('渲染出的控件 name 应当与 configureObject 读取的字段一一对应', async () => {
    const data = await loadCases();

    render(
      <Editor
        entry={{ entryId: 7, data: { type: 'agent', config: {} } } as any}
        formRef={{ current: null }}
      />,
    );

    expect(controlNames().sort()).toEqual([...data.fields].sort());
  });

  it('空配置时控件应当回落到默认配置', () => {
    render(
      <Editor
        entry={{ entryId: 7, data: { type: 'agent', config: {} } } as any}
        formRef={{ current: null }}
      />,
    );

    expect(controlProps('Input', 'code').defaultValue).toBe(
      agents.default.code,
    );
    expect(controlProps('Textarea', 'description').defaultValue).toBe(
      agents.default.description,
    );
    expect(controlProps('MonacoEditor', 'schema').value).toBe(
      agents.default.schema,
    );
    expect(controlProps('Checkbox', 'disable_preset').defaultChecked).toBe(
      agents.default.disablePreset,
    );
    expect(controlProps('Input', 'max_length').defaultValue).toBe(
      agents.default.maxLength,
    );
    expect(controlProps('ModelNameValueField', 'model').value).toBe(
      agents.default.model,
    );
    expect(controlProps('PresetNameValuesField', 'preset').value).toEqual(
      agents.default.presets,
    );
    expect(controlProps('TagBox', 'disable_tags').value).toEqual(
      agents.default.disableTags,
    );
    // schema 用 monaco 编辑，表单提交靠它把值写进 FormData
    expect(controlProps('MonacoEditor', 'schema').language).toBe('json');
  });

  it('entry 里的配置应当回填到控件上', async () => {
    const data = await loadCases();

    render(
      <Editor
        entry={
          {
            entryId: 1,
            data: { type: 'agent', config: data.expectedConfig },
          } as any
        }
        formRef={{ current: null }}
      />,
    );

    expect(controlProps('Input', 'code').defaultValue).toBe(
      data.expectedConfig.code,
    );
    expect(controlProps('Textarea', 'description').defaultValue).toBe(
      data.expectedConfig.description,
    );
    expect(controlProps('MonacoEditor', 'schema').value).toBe(
      data.expectedConfig.schema,
    );
    expect(controlProps('Checkbox', 'disable_preset').defaultChecked).toBe(
      data.expectedConfig.disablePreset,
    );
    expect(controlProps('Input', 'max_length').defaultValue).toBe(
      data.expectedConfig.maxLength,
    );
    expect(controlProps('ModelNameValueField', 'model').value).toEqual(
      data.expectedConfig.model,
    );
    expect(controlProps('PresetNameValuesField', 'preset').value).toEqual(
      data.expectedConfig.presets,
    );
    expect(controlProps('TagBox', 'disable_tags').value).toEqual(
      data.expectedConfig.disableTags,
    );
    // 标签候选取自预设模块的常量
    expect(controlProps('TagBox', 'disable_tags').items).toEqual(
      mainPresets.tags,
    );
  });

  it('渲染带配置的编辑器后 agents.default 不应当被改写', async () => {
    const data = await loadCases();

    render(
      <Editor
        entry={
          {
            entryId: 1,
            data: { type: 'agent', config: data.expectedConfig },
          } as any
        }
        formRef={{ current: null }}
      />,
    );

    // 修复前 merge 就地合并，渲染一次就把模块级 defaultConfig 改成了 expectedConfig，
    // 于是新建工具会预填上一个条目的配置。这里对着用例开头的快照断言它没被动过。
    expect(agents.default).toEqual(defaultSnapshot);
  });

  it('code 字段应当带注册表用的正则、max_length 限定为非负整数', () => {
    render(
      <Editor
        entry={{ entryId: 7, data: { type: 'agent', config: {} } } as any}
        formRef={{ current: null }}
      />,
    );

    expect(controlProps('Input', 'code').pattern).toBe('[A-Za-z0-9_]+');
    expect(controlProps('Input', 'max_length').min).toBe(0);
    expect(controlProps('Input', 'max_length').step).toBe(1);
  });
});

describe('agents client / create', () => {
  /** 造一个子代理工具；realmGet 返回 fixture 里的预设列表 */
  async function createAgent(
    overrides: { config?: any; realm?: any; output?: any } = {},
  ) {
    const data = await loadCases();
    const config = { ...data.config, ...overrides.config };
    const realm = { ...structuredClone(data.realm), ...overrides.realm };
    mocks.realmGet.mockResolvedValue(structuredClone(data.result));

    const items = (await agents.create(
      { config, output: overrides.output } as any,
      realm as any,
    )) as any[];

    return { data, config, realm, item: items[0], items };
  }

  it('父级已经是 agent 时不再创建子代理', async () => {
    const { items } = await createAgent({
      realm: { properties: { agent: 1 } },
    });

    expect(items).toEqual([]);
    expect(mocks.realmGet).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it('应当按配置组装故事、取回预设并初始化 realm', async () => {
    const { data, config, realm, item } = await createAgent();

    // 故事：名字固定为工具名，预设 = 自己配置的 + 父级预设（转成 NameValue）
    expect(mocks.realmGet).toHaveBeenCalledTimes(1);
    expect(mocks.realmGet.mock.calls[0][0]).toEqual({
      id: agents.name,
      name: agents.name,
      presets: [
        ...config.presets,
        ...data.realm.presets.map((u: any) => mainPresets.toNameValue(u)),
      ],
      model: mainModels.toNameValue(data.realm.model as Model),
      properties: realm.properties,
    });

    // 初始化：id / entries / histories 沿用父级，properties 打上 agent 标记
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    const initRealm = mocks.initialize.mock.calls[0][0].realm;
    expect(mocks.initialize.mock.calls[0][0].realm).toMatchObject({
      id: data.realm.id,
      properties: { agent: 1 },
    });
    expect(initRealm.entries).toBe(realm.entries);
    expect(initRealm.histories).toBe(realm.histories);

    // 被 disableTags 命中的预设会被剔除（preset-b 带 agent 标签，preset-c 没有标签）
    expect(initRealm.presets.map((u: any) => u.id)).toEqual([
      'preset-a',
      'preset-c',
    ]);

    // 工具项：name/description 取自配置，parameters 来自 schema
    expect(item.name).toBe(config.code);
    expect(item.description).toBe(config.description);
    expect(item.parameters).toEqual(JSON.parse(config.schema));
    expect(typeof item.invoke).toBe('function');
  });

  it('disablePreset 为真时不继承父级预设', async () => {
    const { config, realm } = await createAgent({
      config: { disablePreset: true },
    });

    expect(mocks.realmGet.mock.calls[0][0].presets).toEqual(config.presets);
    expect(mocks.realmGet.mock.calls[0][0].properties).toBe(realm.properties);
  });

  it('配置了模型时优先于故事模型', async () => {
    const model = { name: '模型B', value: 'model-b' };
    await createAgent({ config: { model } });

    expect(mocks.realmGet.mock.calls[0][0].model).toEqual(model);
  });

  it('缺少 description 时工具描述回落成空串', async () => {
    const { item } = await createAgent({ config: { description: null } });

    expect(item.description).toBe('');
  });
});

describe('agents client / invoke', () => {
  async function createAgent(
    overrides: { config?: any; realm?: any; output?: any } = {},
  ) {
    const data = await loadCases();
    const config = { ...data.config, ...overrides.config };
    const realm = { ...structuredClone(data.realm), ...overrides.realm };
    mocks.realmGet.mockResolvedValue(structuredClone(data.result));

    const items = (await agents.create(
      { config, output: overrides.output } as any,
      realm as any,
    )) as any[];

    return { data, config, realm, item: items[0] };
  }

  /** 按 fixture 的 chunks 造一个假的生成器 */
  async function stubGenerate(chunks: any[]) {
    mocks.generate.mockImplementation(async function* () {
      for (const chunk of chunks) {
        yield { outputs: [], output: structuredClone(chunk) };
      }
    });
  }

  const toolcall = { index: 0, id: 'call-1', name: 'sub_agent', arguments: '{}' };

  it('应当把参数与克隆后的历史交给 processers.generate，并返回最后一段正文', async () => {
    const { data, realm, item } = await createAgent({ output: mocks.info });
    await stubGenerate(data.chunks);
    const args = { task: '写一段话' };
    const controller = new AbortController();

    const result = await item.invoke({ args, controller, toolcall } as any);

    expect(result).toBe(data.chunks.at(-1)!.content);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    const ctx = mocks.generate.mock.calls[0][0];
    expect(ctx.args).toEqual(args);
    expect(ctx.controller).toBe(controller);
    // 历史是深拷贝：改的是副本，父级历史不受影响
    expect(ctx.realm.histories).not.toBe(realm.histories);
    expect(ctx.realm.histories.at(-1).outputs).toEqual([]);
    expect(ctx.realm.histories.at(-1).output).toBe(-1);
    expect(realm.histories.at(-1).outputs).toHaveLength(1);
    expect(realm.histories.at(-1).output).toBe(
      data.realm.histories.at(-1)!.output,
    );
    // maxLength 只取最近几条（fixture 里是 2，父级有 3 条）
    expect(ctx.realm.histories.map((u: any) => u.sequence)).toEqual([1, 2]);
    expect(ctx.realm.id).toBe(realm.id);
  });

  it('maxLength 为 0（默认值）时按 slice(-0) 语义保留全部历史（现状）', async () => {
    const { data, item } = await createAgent({
      config: { maxLength: 0 },
      output: mocks.info,
    });
    await stubGenerate(data.chunks);

    await item.invoke({
      args: {},
      controller: new AbortController(),
      toolcall,
    } as any);

    const ctx = mocks.generate.mock.calls[0][0];
    expect(ctx.realm.histories.map((u: any) => u.sequence)).toEqual([0, 1, 2]);
  });

  it('没有历史时应当补一条空历史再生成', async () => {
    const { data, item } = await createAgent({
      realm: { histories: [] },
      output: mocks.info,
    });
    await stubGenerate(data.chunks);

    await item.invoke({
      args: {},
      controller: new AbortController(),
      toolcall,
    } as any);

    const ctx = mocks.generate.mock.calls[0][0];
    expect(ctx.realm.histories).toEqual([
      {
        masterId: data.realm.id,
        output: -1,
        sequence: 0,
        prompts: [],
        outputs: [],
        summary: false,
        variables: {},
      },
    ]);
  });

  it('有工具调用时应当按 thought / arguments 的长度上报进度', async () => {
    const { data, item } = await createAgent({ output: mocks.info });
    await stubGenerate(data.chunks);
    const [c0, c1, c2, c3, c4] = data.chunks;

    await item.invoke({
      args: {},
      controller: new AbortController(),
      toolcall,
    } as any);

    // 第一片正文里没有思考也没有参数长度变化 → generating
    // 第二片思考变长 → thinking
    // 第三、四片只有 arguments 变长 → generating_tool
    // 第五片两个长度都没变 → 回到 generating
    expect(mocks.info.mock.calls.map((u) => u[0])).toEqual(
      data.chunks.map(() => toolcall.id),
    );
    expect(mocks.info.mock.calls.map((u) => u[1])).toEqual([
      {
        content: `${c0.content.length}`,
        title: 'agent.generating',
        text: c0.content,
      },
      {
        content: `${c1.thought.length}`,
        title: 'agent.thinking',
        text: c1.content,
      },
      {
        content: `${c2.callings[0].arguments.length}`,
        title: 'agent.generating_tool',
        text: c2.content,
      },
      {
        content: `${c3.callings[0].arguments.length}`,
        title: 'agent.generating_tool',
        text: c3.content,
      },
      {
        content: `${c4.content.length}`,
        title: 'agent.generating',
        text: c4.content,
      },
    ]);
  });

  it('没有 toolcall 时不上报进度，但仍返回正文', async () => {
    const { data, item } = await createAgent({ output: mocks.info });
    await stubGenerate(data.chunks);

    const result = await item.invoke({
      args: {},
      controller: new AbortController(),
    } as any);

    expect(result).toBe(data.chunks.at(-1)!.content);
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it('create 未传 output 时应当回落到 useRealmState.setRealmInfo', async () => {
    const { data, item } = await createAgent();
    await stubGenerate(data.chunks);

    await item.invoke({
      args: {},
      controller: new AbortController(),
      toolcall,
    } as any);

    expect(mocks.setRealmInfo).toHaveBeenCalledTimes(data.chunks.length);
    expect(mocks.setRealmInfo.mock.calls[0][0]).toBe(toolcall.id);
    expect(mocks.setRealmInfo.mock.calls.at(-1)![1]).toEqual({
      content: `${data.chunks.at(-1)!.content.length}`,
      title: 'agent.generating',
      text: data.chunks.at(-1)!.content,
    });
  });

  it('生成器没有产出时返回空内容的错误占位', async () => {
    const { item } = await createAgent({ output: mocks.info });
    await stubGenerate([]);

    const result = await item.invoke({
      args: {},
      controller: new AbortController(),
    } as any);

    expect(result).toBe('error: empty content');
  });
});
