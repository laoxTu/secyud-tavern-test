import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workflowGet: vi.fn(),
  paramList: vi.fn(),
  generate: vi.fn(),
  modelList: vi.fn(),
  configureSchema: vi.fn(),
  generateCalling: vi.fn(),
}));

// 请求层与第三方代理整体替换掉，用例只关心被调用的参数
vi.mock('@/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
  getBaseUrl: () => 'http://localhost:3000',
}));
vi.mock('@/comfyui/client/proxy', () => ({
  proxy: {
    generate: mocks.generate,
    model: { list: mocks.modelList },
    workflow: {
      get: mocks.workflowGet,
      param: { list: mocks.paramList },
    },
  },
}));

// 配置器注册表挂在 client 桶上，被测文件用的也是同一个
import { comfyuis } from '@/comfyui/client';
import type { ParamConfigurator } from '@/comfyui/client/configurator';
import { tool } from '@/comfyui/client/tool';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./tool.cases.json')).default);
}

/** 按组件真实的表单结构拼 FormData */
function toFormData(data: Awaited<ReturnType<typeof loadCases>>) {
  const form = new FormData();
  form.append('code', data.form.code);
  form.append('description', data.form.description);
  form.append('workflow', JSON.stringify(data.form.workflow));
  for (const param of data.form.params) {
    // 隐藏字段 param_id 每个参数一条
    form.append('param_id', `${param.id}`);
    form.append(`param_code_${param.id}`, param.code);
    form.append(`param_description_${param.id}`, param.description);
    if (param.enabled) form.append(`param_enabled_${param.id}`, 'on');
  }
  return form;
}

/** 造一个工具预设条目 */
async function createToolEntry(config?: unknown) {
  const data = await loadCases();
  return {
    type: 'auto_paint',
    name: '自动绘图',
    disabled: false,
    config: structuredClone(config ?? data.config),
  } as any;
}

const registered: string[] = [];

function registerConfigurator<T>(
  id: string,
  extra: Partial<ParamConfigurator<T>> = {},
) {
  const configurator = { id, ...extra } as ParamConfigurator<T>;
  comfyuis.configurators.registry.register(configurator);
  registered.push(id);
  return configurator;
}

/** 让 workflow.get / param.list 返回 fixture 里的数据 */
async function stubWorkflow(workflow?: unknown, params?: unknown[]) {
  const data = await loadCases();
  mocks.workflowGet.mockResolvedValue(workflow ?? data.workflow);
  mocks.paramList.mockResolvedValue({
    items: params ?? data.params,
    length: (params ?? data.params).length,
  });
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const id of registered.splice(0)) {
    comfyuis.configurators.registry.unregister(id);
  }
});

describe('comfyui tool / configureObject', () => {
  it('应当把表单读成工具配置', async () => {
    const data = await loadCases();
    const entry = await createToolEntry();

    await tool.configureObject!(toFormData(data), entry);

    expect(entry.config).toEqual(data.expectedConfig);
  });

  it('勾选框未选中表示参数被禁用', async () => {
    const data = await loadCases();
    const entry = await createToolEntry();

    await tool.configureObject!(toFormData(data), entry);

    expect(entry.config.params.find((u: any) => u.id === 3).disabled).toBe(
      false,
    );
    expect(entry.config.params.find((u: any) => u.id === 4).disabled).toBe(
      true,
    );
  });

  it('没有参数时应当得到空数组', async () => {
    const data = await loadCases();
    const entry = await createToolEntry();
    const form = new FormData();
    form.append('code', data.form.code);

    await tool.configureObject!(form, entry);

    expect(entry.config.params).toEqual([]);
    expect(entry.config.workflow).toBeNull();
  });
});

describe('comfyui tool / create', () => {
  it('没有选择工作流时应当直接报错', async () => {
    const entry = await createToolEntry({
      code: 'paint',
      description: '',
      workflow: null,
      params: [],
    });

    await expect(tool.create(entry, null as any)).rejects.toThrow(
      'workflow is not selected',
    );
  });

  it('应当返回绘图工具与模型查询工具', async () => {
    const data = await stubWorkflow();
    const entry = await createToolEntry();

    const items = await tool.create(entry, null as any);

    expect(items.map((u) => u.name)).toEqual([
      data.config.code,
      'comfyui_model_fetcher',
    ]);
    expect(mocks.workflowGet).toHaveBeenCalledWith(
      data.config.workflow.value,
    );
    expect(mocks.paramList).toHaveBeenCalledWith(data.config.workflow.value);
  });

  it('只有启用的、且注册过配置器的参数才进入 schema', async () => {
    const data = await stubWorkflow();
    const entry = await createToolEntry();
    registerConfigurator('text', { configureSchema: mocks.configureSchema });
    registerConfigurator('lora_select', {
      configureSchema: mocks.configureSchema,
    });

    const [painter] = await tool.create(entry, null as any);

    // id 3 启用且注册；id 4 被禁用；id 5 的类型没有配置器
    expect(mocks.configureSchema).toHaveBeenCalledTimes(1);
    expect(mocks.configureSchema.mock.calls[0][0]).toEqual(data.params[0]);
    expect(mocks.configureSchema.mock.calls[0][1]).toEqual(
      data.config.params[0],
    );
    expect(painter.parameters).toMatchObject({
      type: 'object',
      properties: {},
      required: [],
    });
  });

  it('绘图工具的名称与描述来自配置', async () => {
    const data = await stubWorkflow();
    const entry = await createToolEntry();

    const [painter] = await tool.create(entry, null as any);

    expect(painter.name).toBe(data.config.code);
    expect(painter.description).toBe(data.config.description);
  });
});

describe('comfyui tool / 绘图工具的 invoke', () => {
  async function createPainter(config?: unknown, workflow?: unknown) {
    const data = await stubWorkflow(workflow);
    const entry = await createToolEntry(config);
    registerConfigurator('text', { generateCalling: mocks.generateCalling });
    const [painter] = await tool.create(entry, null as any);
    return { data, painter };
  }

  it('应当按参数把工作流补全后提交给 ComfyUI', async () => {
    const { data, painter } = await createPainter();
    mocks.generate.mockResolvedValue(data.generateResponse);

    const result = await painter.invoke({
      args: data.args,
      controller: new AbortController(),
    });

    expect(mocks.generateCalling).toHaveBeenCalledTimes(1);
    expect(mocks.generateCalling.mock.calls[0][0]).toEqual(data.params[0]);
    expect(mocks.generateCalling.mock.calls[0][3]).toEqual(data.args);
    expect(mocks.generate).toHaveBeenCalledWith(data.input);
    expect(JSON.parse(result)).toEqual(data.generateResponse);
  });

  it('工作流内容不是合法 json 时应当报错', async () => {
    const data = await loadCases();
    const { painter } = await createPainter(
      undefined,
      data.invalidWorkflow,
    );

    await expect(
      painter.invoke({ args: {}, controller: new AbortController() }),
    ).rejects.toThrow('workflow is not serializable');
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('提交失败时应当把错误序列化后返回', async () => {
    const { painter } = await createPainter();
    mocks.generate.mockRejectedValue({ message: 'comfy down' });

    const result = await painter.invoke({
      args: {},
      controller: new AbortController(),
    });

    expect(JSON.parse(result)).toEqual({ message: 'comfy down' });
  });

  it('抛出的 Error 会丢掉 message（现状即设计，已确认）', async () => {
    const { painter } = await createPainter();
    mocks.generate.mockRejectedValue(new Error('comfy down'));

    const result = await painter.invoke({
      args: {},
      controller: new AbortController(),
    });

    // JSON.stringify 只看可枚举属性，Error 的 message 不可枚举，所以这里是空对象
    expect(JSON.parse(result)).toEqual({});
  });

  it('被禁用的参数不会进 schema，但提交时仍按默认流程构造（已确认为设计）', async () => {
    const data = await stubWorkflow();
    const entry = await createToolEntry();
    registerConfigurator('text', {
      configureSchema: mocks.configureSchema,
      generateCalling: mocks.generateCalling,
    });
    registerConfigurator('lora_select', {
      configureSchema: mocks.configureSchema,
      generateCalling: mocks.generateCalling,
    });
    const [painter] = await tool.create(entry, null as any);
    mocks.generate.mockResolvedValue(data.generateResponse);

    // 建 schema 时跳过被禁用的参数（模型拿不到它的入参）
    const schemaCodes = mocks.configureSchema.mock.calls.map(
      (u) => u[1].id,
    );
    expect(schemaCodes).toEqual([3]);

    await painter.invoke({
      args: data.args,
      controller: new AbortController(),
    });

    // 但提交时「禁用」只表示不从 ai 取参，默认流程仍会给它构造一次
    const callingIds = mocks.generateCalling.mock.calls.map((u) => u[1].id);
    expect(callingIds).toEqual([3, 4]);
  });
});

describe('comfyui tool / 模型查询工具', () => {
  async function createFetcher() {
    const data = await stubWorkflow(undefined, []);
    const entry = await createToolEntry();
    const [, fetcher] = await tool.create(entry, null as any);
    return { data, fetcher };
  }

  it('参数 schema 应当暴露分页与类型过滤', async () => {
    const { fetcher } = await createFetcher();

    expect(fetcher.name).toBe('comfyui_model_fetcher');
    const properties = fetcher.parameters.properties as Record<string, any>;
    expect(Object.keys(properties).sort()).toEqual([
      'fuzzy',
      'size',
      'skip',
      'types',
    ]);
    // 类型枚举来自模型类型常量
    expect(properties.types.items.enum).toEqual(comfyuis.model.types);
  });

  it('invoke 应当按参数查询模型并投影字段', async () => {
    const { data, fetcher } = await createFetcher();
    mocks.modelList.mockResolvedValue(data.modelsResponse);
    const args = { size: 5, skip: 10, fuzzy: 'a', types: ['lora'] };

    const result = JSON.parse(
      await fetcher.invoke({ args, controller: new AbortController() }),
    );

    expect(mocks.modelList).toHaveBeenCalledWith({
      size: 5,
      skip: 10,
      search: { fuzzy: 'a', types: ['lora'] },
    });
    expect(result).toEqual({
      items: [
        {
          name: data.modelsResponse.items[0].path,
          type: data.modelsResponse.items[0].type,
          base: data.modelsResponse.items[0].model,
          desc: data.modelsResponse.items[0].name,
        },
      ],
      length: data.modelsResponse.length,
    });
  });
});
