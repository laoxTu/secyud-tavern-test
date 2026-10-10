import { forwardRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ComfyUIParam, ComfyUIWorkflowInput } from '@/comfyui';
import type {
  ModelSelectConfig,
  PowerLoraSelectConfig,
  SelectConfig,
} from '@/comfyui/select';
import { selects } from '@/comfyui/select/client';

/**
 * Monaco 编辑器只在浏览器里可用，导入 `@/components/input` 一次要 6s 以上；
 * 这里只做纯逻辑用例，用最小桩替换掉输入控件，其它组件保持真实。
 */
vi.mock('@/components/input', () => {
  const Input = forwardRef<HTMLInputElement, any>((props, ref) => {
    return null!;
  });
  const Textarea = forwardRef<HTMLTextAreaElement, any>((props, ref) => {
    return null!;
  });
  return {
    Input,
    Textarea,
    MonacoEditor: () => null,
    TagBox: () => null,
  };
});

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

/**
 * 与 SelectConfigComponent / ModelSelectComponent 渲染出来的 name 保持一致，
 * 组件改了命名规则这里也要跟着改。
 */
const SEQUENCE = 3;

function createParam<TConfig>(
  type: string,
  config: TConfig,
): ComfyUIParam<TConfig> {
  return {
    masterId: 'workflow',
    sequence: SEQUENCE,
    type,
    name: 'param',
    config,
  };
}

/** FormData 由用例数据驱动；对象字段按真实表单的写法序列化成 json */
function toFormData(fields: Record<string, any>, items?: Record<string, any>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) data.append(name, `${item}`);
    } else if (typeof value === 'object') {
      data.append(name, JSON.stringify(value));
    } else {
      data.append(name, `${value}`);
    }
  }
  for (const [name, value] of Object.entries(items ?? {})) {
    if (value === undefined || value === null) continue;
    data.append(
      name,
      typeof value === 'object' ? JSON.stringify(value) : `${value}`,
    );
  }
  return data;
}

/**
 * 只比较用例关心的字段：strength 用 json 里的 null 表示 NaN，
 * lora 逐个比较（fixture 里没写的字段不参与）。
 */
function expectLoras(actual: any[], expected: any[], message?: string) {
  expect(actual, message).toHaveLength(expected.length);
  expected.forEach((item, i) => {
    expect(actual[i].lora, `${message} / lora[${i}]`).toEqual(item.lora);
    expect(actual[i].on, `${message} / on[${i}]`).toEqual(item.on);
    if (item.strength === null) {
      expect(
        Number.isNaN(actual[i].strength),
        `${message} / strength[${i}] 应当是 NaN，实际 ${actual[i].strength}`,
      ).toBe(true);
    } else {
      expect(actual[i].strength, `${message} / strength[${i}]`).toEqual(
        item.strength,
      );
    }
  });
}

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadConfigs() {
  return structuredClone((await import('./power-lora.cases.json')).default);
}

async function loadSelectCases() {
  return structuredClone((await import('./client.cases.json')).default);
}

async function loadModelSelectCases() {
  return structuredClone(
    (await import('./model-select.cases.json')).default,
  );
}

describe('comfyui select 配置器', () => {
  describe('注册信息', () => {
    it('三个配置器的 id 应当与 select 模块的名字一致', () => {
      expect(selects.configurator.select.id).toBe(selects.select.name);
      expect(selects.configurator.modelSelect.id).toBe(
        selects.modelSelect.name,
      );
      expect(selects.configurator.powerLoraSelect.id).toBe(
        selects.powerLoraSelect.name,
      );
    });

    it('三个配置器的 id 应当互不相同', () => {
      const ids = Object.values(selects.configurator).map((u) => u.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('每个配置器都应当同时提供 configComponent、inputComponent 与四个钩子', () => {
      for (const [key, configurator] of Object.entries(
        selects.configurator,
      )) {
        expect(typeof configurator.id, key).toBe('string');
        expect(typeof configurator.configureObject, key).toBe('function');
        expect(typeof configurator.configureInput, key).toBe('function');
        expect(typeof configurator.configureSchema, key).toBe('function');
        expect(typeof configurator.generateCalling, key).toBe('function');
        expect(typeof configurator.configComponent, key).toBe('function');
        expect(typeof configurator.inputComponent, key).toBe('function');
      }
    });

    it('注册表里的默认配置应当来自 select 模块且互不共享', () => {
      expect(selects.select.default.items).toEqual([]);
      expect(selects.modelSelect.default.type).toBe('diffusion_model');
      expect(selects.powerLoraSelect.default.loras).toEqual([]);
      // select 与 modelSelect 的默认对象不是同一个引用
      expect(selects.select.default).not.toBe(selects.modelSelect.default);
    });
  });

  describe('select / configureObject', () => {
    it('应当按表单字段构造 config', async () => {
      const { cases } = await loadSelectCases();

      for (const item of cases) {
        const param = createParam<SelectConfig>('select', {
          node: '',
          key: '',
          items: [],
        });

        await selects.configurator.select.configureObject!(
          toFormData(item.fields),
          param,
        );

        expect(param.config, item.name).toEqual(item.expected);
      }
    });

    it('多个同名 item 字段应当按顺序收集', async () => {
      const { cases } = await loadSelectCases();
      const item = cases.find((u) => u.expected.items.length > 1)!;
      const param = createParam<SelectConfig>('select', {
        node: '',
        key: '',
        items: [],
      });

      await selects.configurator.select.configureObject!(
        toFormData(item.fields),
        param,
      );

      expect(param.config.items).toHaveLength(item.fields.item.length);
      expect(param.config.items).toEqual(item.expected.items);
    });
  });

  describe('select / configureInput', () => {
    it('应当把选中的值写进节点输入', async () => {
      const { configureInput, workflow } = await loadSelectCases();

      for (const item of configureInput) {
        const input: ComfyUIWorkflowInput = structuredClone(workflow);
        const param = createParam<SelectConfig>('select', {
          node: item.fields.node ?? '',
          key: item.fields.key ?? '',
          items: [],
        });

        await selects.configurator.select.configureInput!(
          toFormData(item.fields),
          param,
          input,
        );

        const key = param.config.key ?? 'null';
        expect(input[param.config.node!].inputs[key], item.name).toEqual(
          item.expected,
        );
      }
    });

    it('节点不存在时不应当抛错也不应当改动输入', async () => {
      const { configureInput } = await loadSelectCases();
      const item = configureInput[0];
      const input: ComfyUIWorkflowInput = {
        '99': {
          inputs: {},
          class_type: 'Nothing',
          _meta: { title: 'Nothing' },
        },
      };

      await expect(
        selects.configurator.select.configureInput!(
          toFormData(item.fields),
          createParam<SelectConfig>('select', {
            node: '99x',
            key: 'text',
            items: [],
          }),
          input,
        ),
      ).resolves.toBeUndefined();
      expect(input['99'].inputs).toEqual({});
    });

    it('节点存在但 key 是空串时应当新建一个空键', async () => {
      const input: ComfyUIWorkflowInput = {
        '10': { inputs: {}, class_type: 'x', _meta: { title: 'x' } },
      };

      await selects.configurator.select.configureInput!(
        toFormData({ value_3: 'v' }),
        createParam<SelectConfig>('select', { node: '10', key: '', items: [] }),
        input,
      );

      expect(input['10'].inputs['']).toBe('v');
    });
  });

  describe('select / generateCalling', () => {
    it('应当优先使用工具参数，缺失时回落到 config.value', async () => {
      const { generateCalling, workflow } = await loadSelectCases();

      for (const item of generateCalling) {
        const input: ComfyUIWorkflowInput = structuredClone(workflow);
        const paint = {
          id: 1,
          disabled: false,
          code: 'paint',
        };

        await selects.configurator.select.generateCalling!(
          createParam<SelectConfig>('select', item.config),
          paint,
          input,
          item.args,
        );

        if (item.absent) {
          // args 与 config.value 都缺失时是 `undefined`，赋值后该键变成 undefined
          expect(input['10'].inputs[item.config.key], item.name).toBeUndefined();
        } else {
          expect(input['10'].inputs[item.config.key], item.name).toEqual(
            item.expected,
          );
        }
      }
    });

    it('节点不存在时应当原样返回', async () => {
      const { generateCalling, workflow } = await loadSelectCases();
      const item = generateCalling[0];
      const input: ComfyUIWorkflowInput = structuredClone(workflow);
      const before = structuredClone(input);

      await selects.configurator.select.generateCalling!(
        createParam<SelectConfig>('select', { ...item.config, node: 'missing' }),
        { id: 1, disabled: false, code: 'paint' },
        input,
        item.args,
      );

      expect(input).toEqual(before);
    });
  });

  describe('select / configureSchema', () => {
    it('应当把候选值写成枚举', async () => {
      const { schema } = await loadSelectCases();
      const target = { properties: {} } as any;

      await selects.configurator.select.configureSchema!(
        createParam<SelectConfig>('select', schema.config),
        schema.paint,
        target,
      );

      expect(target.properties[schema.paint.code]).toEqual(schema.expected);
    });
  });

  describe('modelSelect / configureObject', () => {
    it('应当按表单字段构造 config', async () => {
      const { modelSelectCases } = await loadModelSelectCases();

      for (const item of modelSelectCases) {
        const param = createParam<ModelSelectConfig>('model_select', {
          node: '',
          key: '',
        });

        await selects.configurator.modelSelect.configureObject!(
          toFormData(item.fields),
          param,
        );

        expect(param.config, item.name).toEqual(item.expected);
      }
    });

    it('读出来的模型应当是 combobox 的 NameValue 而不是字符串', async () => {
      const { modelSelectCases } = await loadModelSelectCases();
      const item = modelSelectCases.find((u) => u.expected.model)!;
      const param = createParam<ModelSelectConfig>('model_select', {
        node: '',
        key: '',
      });

      await selects.configurator.modelSelect.configureObject!(
        toFormData(item.fields),
        param,
      );

      expect(param.config.model).toEqual(item.fields.model_3);
    });
  });

  describe('modelSelect / configureInput', () => {
    it('写入的是表单里的原始字符串', async () => {
      const { modelSelectInput, workflow } = await loadModelSelectCases();

      for (const item of modelSelectInput) {
        const input: ComfyUIWorkflowInput = structuredClone(workflow);
        const param = createParam<ModelSelectConfig>('model_select', {
          node: item.fields.node ?? '',
          key: item.fields.key ?? '',
        });

        await selects.configurator.modelSelect.configureInput!(
          toFormData(item.fields),
          param,
          input,
        );

        // configureInput 走 forms.str 原样透传（combobox 字段就是那段 json 文本），
        // 不像 configureObject 那样过 combobox.get，也不像 generateCalling 那样取 model.name。
        // 这个不一致用户已确认为设计，这里按现状断言；FormData 放什么就等于什么。
        expect(input['4'].inputs[param.config.key!], item.name).toEqual(
          item.raw,
        );
      }
    });

    it('节点不存在时不应当抛错', async () => {
      const { modelSelectInput, workflow } = await loadModelSelectCases();
      const item = modelSelectInput[0];
      const input: ComfyUIWorkflowInput = structuredClone(workflow);

      await expect(
        selects.configurator.modelSelect.configureInput!(
          toFormData(item.fields),
          createParam<ModelSelectConfig>('model_select', {
            node: 'missing',
            key: 'ckpt_name',
          }),
          input,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('modelSelect / generateCalling', () => {
    it('应当优先使用工具参数，缺失时回落到 config.model.name', async () => {
      const { modelSelectGenerate, workflow } = await loadModelSelectCases();

      for (const item of modelSelectGenerate) {
        const input: ComfyUIWorkflowInput = structuredClone(workflow);

        await selects.configurator.modelSelect.generateCalling!(
          createParam<ModelSelectConfig>('model_select', item.config),
          { id: 2, disabled: false, code: 'paint' },
          input,
          item.args,
        );

        if (item.absent) {
          expect(input['4'].inputs[item.config.key], item.name).toBeUndefined();
        } else {
          expect(input['4'].inputs[item.config.key], item.name).toEqual(
            item.expected,
          );
        }
      }
    });
  });

  describe('modelSelect / configureSchema', () => {
    it('应当生成不带枚举的字符串属性', async () => {
      const { modelSelectSchema } = await loadModelSelectCases();
      const target = { properties: {} } as any;

      await selects.configurator.modelSelect.configureSchema!(
        createParam<ModelSelectConfig>('model_select', modelSelectSchema.config),
        modelSelectSchema.paint,
        target,
      );

      expect(target.properties[modelSelectSchema.paint.code]).toEqual(
        modelSelectSchema.expected,
      );
    });
  });

  describe('powerLoraSelect / configureObject', () => {
    it('应当按数量读取每个 lora 的字段', async () => {
      const { powerLoraConfig } = await loadConfigs();

      for (const item of powerLoraConfig) {
        const param = createParam<PowerLoraSelectConfig>('power_lora_select', {
          node: '',
          loras: [],
        });

        await selects.configurator.powerLoraSelect.configureObject!(
          toFormData(item.fields, item.fields.items),
          param,
        );

        expect(param.config.node, item.name).toEqual(item.expected.node);
        expectLoras(param.config.loras, item.expected.loras, item.name);
      }
    });

    it('缺字段的强度应当是 NaN 而不是 0', async () => {
      const { powerLoraConfig } = await loadConfigs();
      // 用例数据里用 null 占位表示 NaN
      const item = powerLoraConfig.find(
        (u: any) => u.expected.loras[0]?.strength === null,
      )!;
      const param = createParam<PowerLoraSelectConfig>('power_lora_select', {
        node: '',
        loras: [],
      });

      await selects.configurator.powerLoraSelect.configureObject!(
        toFormData(item.fields, item.fields.items),
        param,
      );

      expect(Number.isNaN(param.config.loras[0].strength)).toBe(true);
    });
  });

  describe('powerLoraSelect / configureInput', () => {
    it('应当按数量写入 lora_i 并清理多余的位置', async () => {
      const { powerLoraInput, workflow } = await loadConfigs();

      for (const item of powerLoraInput) {
        const input: ComfyUIWorkflowInput = structuredClone(workflow);
        for (const name of item.stale) {
          input['20'].inputs[name] = { lora: `stale-${name}` };
        }

        await selects.configurator.powerLoraSelect.configureInput!(
          toFormData(item.fields, item.fields.items),
          createParam<PowerLoraSelectConfig>('power_lora_select', {
            node: item.fields.node ?? '',
            loras: [],
          }),
          input,
        );

        for (const [name, value] of Object.entries(item.expected.writes)) {
          expect(input['20'].inputs[name], `${item.name} / ${name}`).toEqual(
            value,
          );
        }
        for (const name of item.expected.deleted) {
          expect(input['20'].inputs[name], `${item.name} / ${name}`).toBe(
            undefined,
          );
        }
        for (const name of item.expected.kept) {
          expect(input['20'].inputs[name], `${item.name} / ${name}`).toBeDefined();
        }
      }
    });

    it('节点不存在时不应当抛错', async () => {
      const input: ComfyUIWorkflowInput = {};

      await expect(
        selects.configurator.powerLoraSelect.configureInput!(
          toFormData({ count_3: '1' }),
          createParam<PowerLoraSelectConfig>('power_lora_select', {
            node: '20',
            loras: [],
          }),
          input,
        ),
      ).resolves.toBeUndefined();
      expect(input).toEqual({});
    });
  });

  describe('powerLoraSelect / generateCalling', () => {
    it('应当按 args 重建 lora_i，并保留 model 与 header', async () => {
      const { powerLoraCalling, workflow } = await loadConfigs();

      for (const item of powerLoraCalling) {
        const input: ComfyUIWorkflowInput = structuredClone(workflow);

        await selects.configurator.powerLoraSelect.generateCalling!(
          createParam<PowerLoraSelectConfig>(
            'power_lora_select',
            item.config,
          ),
          { id: 3, disabled: false, code: 'paint' },
          input,
          item.args,
        );

        expect(input['20'].inputs, item.name).toEqual(item.expected);
      }
    });

    it('重建后除了 args 里的 lora 外不应当残留旧的 lora_i', async () => {
      const { powerLoraCalling, workflow } = await loadConfigs();
      const item = powerLoraCalling[0];
      const input: ComfyUIWorkflowInput = structuredClone(workflow);
      input['20'].inputs['lora_1'] = { lora: 'stale-1' };
      input['20'].inputs['lora_3'] = { lora: 'stale-3' };

      await selects.configurator.powerLoraSelect.generateCalling!(
        createParam<PowerLoraSelectConfig>('power_lora_select', item.config),
        { id: 3, disabled: false, code: 'paint' },
        input,
        item.args,
      );

      // inputs 整体被替换，旧的 lora_3 不再存在
      expect(input['20'].inputs['lora_3']).toBeUndefined();
      expect(Object.keys(input['20'].inputs).filter((u) => u.startsWith('lora')))
        .toHaveLength(item.args.paint.length);
    });

    it('节点不存在时应当原样返回', async () => {
      const { powerLoraCalling, workflow } = await loadConfigs();
      const item = powerLoraCalling[0];
      const input: ComfyUIWorkflowInput = structuredClone(workflow);
      const before = structuredClone(input);

      await selects.configurator.powerLoraSelect.generateCalling!(
        createParam<PowerLoraSelectConfig>('power_lora_select', {
          ...item.config,
          node: 'missing',
        }),
        { id: 3, disabled: false, code: 'paint' },
        input,
        item.args,
      );

      expect(input).toEqual(before);
    });
  });

  describe('powerLoraSelect / configureSchema', () => {
    it('应当生成数组属性并带 lora / strength 约束', async () => {
      const { powerLoraSchema } = await loadConfigs();
      const target = { properties: {} } as any;

      await selects.configurator.powerLoraSelect.configureSchema!(
        createParam<PowerLoraSelectConfig>(
          'power_lora_select',
          powerLoraSchema.config,
        ),
        powerLoraSchema.paint,
        target,
      );

      expect(target.properties[powerLoraSchema.paint.code]).toEqual(
        powerLoraSchema.expected,
      );
    });
  });
});
