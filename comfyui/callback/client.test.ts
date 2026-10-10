import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  base: 'http://comfy.test',
}));

// 回调要拼绝对地址，这里固定 base，避免依赖 jsdom 的 origin
vi.mock('@/client', () => ({
  getBaseUrl: () => mocks.base,
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));

import { callbacks } from '@/comfyui/callback/client';
import { images } from '@/stories/images';
import { realms } from '@/stories/client/realms';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./client.cases.json')).default);
}

type Data = Awaited<ReturnType<typeof loadCases>>;

function createParam(data: Data, config = data.config) {
  return {
    masterId: 'wf-1',
    sequence: data.sequence,
    type: 'image_callback',
    name: '回调',
    config: structuredClone(config),
  } as any;
}

function toFormData(fields: Record<string, string>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }
  return form;
}

function expectedUrl(data: Data) {
  return `${mocks.base}/api/stories/${data.realmId}/${images.name}`;
}

beforeEach(async () => {
  const data = await loadCases();
  realms.realm = { id: data.realmId } as any;
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('comfyui callback / 常量', () => {
  it('配置器 id 与默认值应当与模块一致', () => {
    expect(callbacks.name).toBe('image_callback');
    expect(callbacks.configurator.id).toBe(callbacks.name);
    expect(callbacks.default).toEqual({
      node: '',
      title: '',
      key: '',
      value: 'image',
    });
    expect(callbacks.configurator.configComponent).toBeTruthy();
    expect(callbacks.configurator.inputComponent).toBeTruthy();
  });
});

describe('comfyui callback / configureObject', () => {
  it('应当把表单读进 config', async () => {
    const data = await loadCases();
    const param = createParam(data);

    await callbacks.configurator.configureObject!(toFormData(data.form), param);

    expect(param.config).toEqual({
      node: data.form.node,
      title: data.form.title,
      key: data.form.title_key,
      value: data.form.title_value,
    });
  });

  it('表单缺字段时对应项为空值', async () => {
    const data = await loadCases();
    const param = createParam(data);

    await callbacks.configurator.configureObject!(
      toFormData({ node: data.form.node }),
      param,
    );

    expect(param.config.node).toBe(data.form.node);
    expect(param.config.title).toBeFalsy();
    expect(param.config.key).toBeFalsy();
    expect(param.config.value).toBeFalsy();
  });
});

describe('comfyui callback / configureInput', () => {
  it('应当给回调节点写入 target_url', async () => {
    const data = await loadCases();
    const input = structuredClone(data.input) as any;

    await callbacks.configurator.configureInput!(
      toFormData({ [`title_${data.sequence}`]: data.fromForm }),
      createParam(data),
      input,
    );

    expect(input[data.config.node].inputs.target_url).toBe(expectedUrl(data));
  });

  it('应当按 sequence 把标题写进标题节点', async () => {
    const data = await loadCases();
    const input = structuredClone(data.input) as any;

    await callbacks.configurator.configureInput!(
      toFormData({ [`title_${data.sequence}`]: data.fromForm }),
      createParam(data),
      input,
    );

    expect(input[data.config.title].inputs[data.config.key]).toBe(
      data.fromForm,
    );
  });

  it('节点不存在时不应报错也不写字段', async () => {
    const data = await loadCases();
    const input = structuredClone(data.input) as any;

    await expect(
      callbacks.configurator.configureInput!(
        toFormData({ [`title_${data.sequence}`]: data.fromForm }),
        createParam(data, { ...data.config, node: 'nope', title: 'nope' }),
        input,
      ),
    ).resolves.toBeUndefined();

    expect(Object.keys(input[data.config.node].inputs)).toEqual([]);
    expect(Object.keys(input[data.config.title].inputs)).toEqual([]);
  });

  it('标题节点缺字段时写入空串', async () => {
    const data = await loadCases();
    const input = structuredClone(data.input) as any;

    await callbacks.configurator.configureInput!(
      toFormData({}),
      createParam(data),
      input,
    );

    expect(input[data.config.title].inputs[data.config.key]).toBeFalsy();
  });
});

describe('comfyui callback / configureSchema', () => {
  it('应当把绘图参数加成字符串字段', async () => {
    const data = await loadCases();
    const schema: any = { type: 'object', properties: {}, required: [] };

    await callbacks.configurator.configureSchema!(
      createParam(data),
      data.paint as any,
      schema,
    );

    expect(schema.properties[data.paint.code]).toEqual({
      type: 'string',
      description: data.paint.description,
    });
  });
});

describe('comfyui callback / generateCalling', () => {
  it('应当优先用调用参数写标题', async () => {
    const data = await loadCases();
    const input = structuredClone(data.input) as any;

    await callbacks.configurator.generateCalling!(
      createParam(data),
      data.paint as any,
      input,
      { [data.paint.code]: data.fromArgs },
    );

    expect(input[data.config.title].inputs[data.config.key]).toBe(
      data.fromArgs,
    );
    expect(input[data.config.node].inputs.target_url).toBe(expectedUrl(data));
  });

  it('调用参数缺失时回落到配置里的默认值', async () => {
    const data = await loadCases();
    const input = structuredClone(data.input) as any;

    await callbacks.configurator.generateCalling!(
      createParam(data),
      data.paint as any,
      input,
      {},
    );

    expect(input[data.config.title].inputs[data.config.key]).toBe(
      data.config.value,
    );
  });

  it('节点不存在时不应报错', async () => {
    const data = await loadCases();
    const input = structuredClone(data.input) as any;

    await expect(
      callbacks.configurator.generateCalling!(
        createParam(data, { ...data.config, node: 'nope', title: 'nope' }),
        data.paint as any,
        input,
        {},
      ),
    ).resolves.toBeUndefined();
  });
});
