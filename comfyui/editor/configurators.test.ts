import { forwardRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ComfyUIParam, ComfyUIWorkflowInput } from '@/comfyui';
import { Registry } from '@/plugins/registry';

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
 * 只替换 agents 工具本身（纯逻辑用例不需要真实的 agent 客户端）；
 * `tool` 用真实的 configureObject（agents 表单字段 → AgentConfig 的映射），
 * `default` 刻意只给 schema，用来验证 agentText 的合并顺序。
 */
vi.mock('@/tools/agents/client', async () => {
  const mainModule = (await vi.importActual(
    '@/tools/agents/client',
  )) as Record<string, any>;
  const main = (await import('@/tools/agents')).agents;
  return {
    ...mainModule,
    agents: {
      ...main,
      tool: mainModule.agents.tool,
      default: {
        schema: '{"type":"object","additionalProperties":false}',
      },
    },
  };
});

import { editors as main } from '@/comfyui/editor';
import { editors } from '@/comfyui/editor/client';

/** 与各 InputComponent 渲染出来的 name 保持一致 */
const SEQUENCE = 3;

const configurators: Record<string, any> = editors.configurator;

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
function toFormData(fields: Record<string, any>) {
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
  return data;
}

/**
 * json 写不了 NaN，fixture 里用 '__NaN__' 占位：
 * 先把占位字段单独断言成 NaN 并剔除，再对剩下的键做整体比较。
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

const PAINT: any = {
  id: 1,
  disabled: false,
  description: '描述',
  code: 'paint',
};

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone(
    (await import('./configurators.cases.json')).default,
  );
}

describe('comfyui editor 配置器', () => {
  describe('注册信息', () => {
    it('四个配置器的 id 应当与 editor 模块的名字一一对应', () => {
      expect(editors.configurator.text.id).toBe(main.text.name);
      expect(editors.configurator.agentText.id).toBe(main.agentText.name);
      expect(editors.configurator.number.id).toBe(main.number.name);
      // prompt 曾经误用 main.text.name 顶掉 text，已按确认修正
      expect(editors.configurator.prompt.id).toBe(main.prompt.name);
      expect(
        new Set(Object.values(editors.configurator).map((u) => u.id)).size,
      ).toBe(Object.keys(editors.configurator).length);
    });

    it('editor 模块应当暴露各自的默认配置', () => {
      expect(main.text.default).toEqual({
        node: '',
        key: 'text',
        prompt: '',
      });
      expect(main.number.default).toEqual({ node: '', key: '', value: 0 });
      expect(main.prompt.default.node).toBe('');
      expect(main.prompt.default.key).toBe('text');
      expect(main.prompt.default.template).toContain('{hair}');
      // agentText 的默认值来自 agents 工具与 text 配置的合并
      expect(main.agentText.default.node).toBe('');
      expect(typeof main.agentText.default.schema).toBe('string');
    });

    it('每个配置器都应当同时提供 configComponent、inputComponent 与四个钩子', () => {
      for (const [key, configurator] of Object.entries(configurators)) {
        expect(typeof configurator.id, key).toBe('string');
        expect(typeof configurator.configureObject, key).toBe('function');
        expect(typeof configurator.configureInput, key).toBe('function');
        expect(typeof configurator.configureSchema, key).toBe('function');
        expect(typeof configurator.generateCalling, key).toBe('function');
        expect(typeof configurator.configComponent, key).toBe('function');
        expect(typeof configurator.inputComponent, key).toBe('function');
      }
    });

    it('text 配置器应当带上 generatePrompt 作为 generate', () => {
      expect(typeof (editors.configurator.text as any).generate).toBe(
        'function',
      );
    });

    it('text 与 prompt 应当各自可寻址，不再互相覆盖', () => {
      const registry = new Registry('comfyui-param-configurator-report');
      registry.register(
        editors.configurator.text,
        editors.configurator.prompt,
      );

      expect(registry.record('text')).toBe(editors.configurator.text);
      expect(registry.record('prompt')).toBe(editors.configurator.prompt);
      expect(Object.keys(registry.records).sort()).toEqual([
        'prompt',
        'text',
      ]);
    });
  });

  describe('text / configureObject', () => {
    it('应当按表单字段构造 config', async () => {
      const { textCases } = await loadCases();

      for (const item of textCases) {
        const param = createParam<any>('text', {
          node: '',
          key: '',
          prompt: '',
        });

        await configurators.text.configureObject(
          toFormData(item.fields),
          param,
        );

        expectConfig(param.config, item.expected, item.name);
      }
    });
  });

  describe('number / configureObject', () => {
    it('应当把表单值解析成整数', async () => {
      const { numberCases } = await loadCases();

      for (const item of numberCases) {
        const param = createParam<any>('number', {
          node: '',
          key: '',
          value: 0,
        });

        await configurators.number.configureObject(
          toFormData(item.fields),
          param,
        );

        expectConfig(param.config, item.expected, item.name);
      }
    });
  });

  describe('prompt / configureObject', () => {
    it('应当保留合法的 pools 文本', async () => {
      const { promptCases } = await loadCases();

      for (const item of promptCases) {
        const param = createParam<any>('prompt', {});

        await configurators.prompt.configureObject(
          toFormData(item.fields),
          param,
        );

        expectConfig(param.config, item.expected, item.name);
      }
    });

    it('pools 非法时应当抛 error.json_invalid 并带上 target', async () => {
      const cases = [
        { name: '空串', fields: { pools: '' } },
        { name: '缺字段', fields: {} },
        { name: '非 json', fields: { pools: 'not a json' } },
        // 注意：字面量 'null' 是合法 JSON（解析结果是假值），由下面的「合法 json」用例正向覆盖
      ];

      for (const item of cases) {
        const param = createParam<any>('prompt', {});

        await expect(
          configurators.prompt.configureObject(toFormData(item.fields), param),
          item.name,
        ).rejects.toMatchObject({
          code: 'error.json_invalid',
          data: { target: 'default.field' },
        });
      }
    });

    it('合法 json 原样返回，不做压缩', async () => {
      const { schemaCases } = await loadCases();

      for (const item of schemaCases) {
        if (item.target) continue;
        const param = createParam<any>('prompt', {});

        await configurators.prompt.configureObject(
          toFormData({ pools: item.input }),
          param,
        );

        expect(param.config.pools, item.name).toBe(item.expected);
      }
    });
  });

  describe('agentText / configureObject', () => {
    it('应当合并 agent 配置与 text 配置，让表单里的提示词与节点生效', async () => {
      const { agentFields } = await loadCases();
      const { fields, expected } = agentFields;
      const param = createParam<any>('agent_text', {});

      await configurators.agentText.configureObject(toFormData(fields), param);

      // text 表单的 node / key / prompt 覆盖 agent 的合并结果
      expect(param.config.node).toBe(fields.node);
      expect(param.config.key).toBe(fields.key);
      expect(param.config.prompt).toBe(fields.prompt_3);

      // agent 自己的字段来自 agents.tool.configureObject
      expect(param.config.code).toBe(expected.code);
      expect(param.config.description).toBe(expected.description);
      expect(param.config.maxLength).toBe(expected.maxLength);
      expect(param.config.disablePreset).toBe(expected.disablePreset);
      expect(param.config.disableTags).toEqual(expected.disableTags);
      expect(param.config.model).toEqual(expected.model);
      expect(param.config.presets).toEqual(expected.presets);
    });

    it('agentText 不写 template / pools，只有 text 的三个字段', async () => {
      const { agentFields } = await loadCases();
      const param = createParam<any>('agent_text', {});

      await configurators.agentText.configureObject(
        toFormData(agentFields.fields),
        param,
      );

      expect(param.config.template).toBeUndefined();
      expect(param.config.pools).toBeUndefined();
    });

    it('配置默认值不应当被 configureObject 污染', async () => {
      const { agentFields } = await loadCases();
      const before = structuredClone({
        text: main.text.default,
        agentText: main.agentText.default,
      });
      const param = createParam<any>('agent_text', {});

      await configurators.agentText.configureObject(
        toFormData(agentFields.fields),
        param,
      );

      // 两个配置器都是整体替换 param.config，不会写回 main.*.default
      expect(main.text.default).toEqual(before.text);
      expect(main.agentText.default).toEqual(before.agentText);
    });
  });

  describe('configureInput', () => {
    it('应当按各自的表单字段写入节点输入', async () => {
      const { edit, workflow } = await loadCases();

      for (const item of edit) {
        const input: ComfyUIWorkflowInput = structuredClone(workflow);
        const configurator = configurators[item.type];
        const fields: Record<string, any> = { ...item.fields };
        if (item.valueField) fields[item.valueField] = item.value;

        await configurator.configureInput(
          toFormData(fields),
          createParam<any>(item.type, item.writes),
          input,
        );

        const target = (input as any)[item.writes.node].inputs[item.writes.key];
        if (item.writes.value === '__NaN__') {
          expect(Number.isNaN(target), item.name).toBe(true);
        } else {
          expect(target, item.name).toEqual(item.writes.value);
        }
      }
    });

    it('节点不存在时不应当抛错也不应当改动输入', async () => {
      const input: ComfyUIWorkflowInput = {
        '99': { inputs: {}, class_type: 'x', _meta: { title: 'x' } },
      };

      for (const [type, configurator] of Object.entries(configurators)) {
        await expect(
          configurator.configureInput(
            toFormData({ prompt_3: 'v', text_3: 'v', value_3: '1' }),
            createParam<any>(type, { node: 'missing', key: 'text' }),
            input,
          ),
          type,
        ).resolves.toBeUndefined();
      }
      expect(input['99'].inputs).toEqual({});
    });
  });

  describe('generateCalling', () => {
    it('应当按 args / 配置回落到节点输入', async () => {
      const { generate, workflow } = await loadCases();

      for (const item of generate) {
        const input: ComfyUIWorkflowInput = structuredClone(workflow);
        const configurator = configurators[item.type];

        await configurator.generateCalling(
          createParam<any>(item.type, item.config),
          PAINT,
          input,
          item.args,
        );

        expect(
          (input as any)[item.writes.node].inputs[item.writes.key],
          item.name,
        ).toEqual(item.writes.value);
      }
    });

    it('prompt 没有 args 时应当用 template + pools 生成提示词', async () => {
      const { generate, workflow } = await loadCases();
      const item = generate.find((u) => u.type === 'prompt')!;
      // 权重 2:1 时随机数 0 必然落在第一项，结果不依赖随机性
      const random = vi.spyOn(Math, 'random').mockReturnValue(0);
      const input: ComfyUIWorkflowInput = structuredClone(workflow);

      try {
        await configurators.prompt.generateCalling(
          createParam<any>('prompt', {
            ...item.config,
            template: '1girl, {hair}',
            pools: '{"hair": [["blue hair", 2], ["green hair", 1]]}',
          }),
          PAINT,
          input,
          {},
        );
      } finally {
        random.mockRestore();
      }

      expect(input['10'].inputs.text).toBe('1girl, blue hair');
    });

    it('节点不存在时不应当抛错', async () => {
      const { generate, workflow } = await loadCases();

      for (const item of generate) {
        const input: ComfyUIWorkflowInput = structuredClone(workflow);
        const before = structuredClone(input);
        const configurator = configurators[item.type];

        await expect(
          configurator.generateCalling(
            createParam<any>(item.type, {
              ...item.config,
              node: 'missing',
            }),
            PAINT,
            input,
            item.args,
          ),
          item.name,
        ).resolves.toBeUndefined();
        expect(input, item.name).toEqual(before);
      }
    });
  });

  describe('configureSchema', () => {
    it('字符串编辑器生成 string，number 生成 number', async () => {
      const expected: Record<string, string> = {
        text: 'string',
        prompt: 'string',
        agentText: 'string',
        number: 'number',
      };

      for (const [type, jsonType] of Object.entries(expected)) {
        const schema: any = { properties: {} };

        await configurators[type].configureSchema(
          createParam<any>(type, { node: '10', key: 'text' }),
          PAINT,
          schema,
        );

        expect(schema.properties[PAINT.code], type).toEqual({
          type: jsonType,
          description: PAINT.description,
        });
      }
    });
  });
});
