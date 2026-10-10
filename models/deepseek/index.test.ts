import { describe, expect, it } from 'vitest';

import { deepseeks } from '@/models/deepseek';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./index.json')).default);
}

describe('models deepseek / 描述信息', () => {
  it('name 应当与 fixture 一致', async () => {
    const data = await loadData();

    expect(deepseeks.name).toBe(data.name);
  });

  it('models 应当是可选模型列表，且顺序与 fixture 一致', async () => {
    const data = await loadData();

    expect(deepseeks.models).toEqual(data.models);
  });

  it('默认模型应当落在可选列表里，否则选择框显示不出当前值', async () => {
    expect(deepseeks.models).toContain(deepseeks.default.options.model);
  });

  it('reasoningEfforts 应当是可选思考强度，且顺序与 fixture 一致', async () => {
    const data = await loadData();

    expect(deepseeks.reasoningEfforts).toEqual(data.reasoningEfforts);
  });
});

describe('models deepseek / 默认配置', () => {
  it('default.config 应当只声明 token，且与 fixture 一致', async () => {
    const data = await loadData();

    expect(deepseeks.default.config).toEqual(data.default.config);
    expect(Object.keys(deepseeks.default.config)).toEqual(['token']);
  });

  it('default.options 应当与 fixture 一致', async () => {
    const data = await loadData();

    expect(deepseeks.default.options).toEqual(data.default.options);
  });

  it('default.options 的键应当与 fixture 完全一致，不多不少', async () => {
    const data = await loadData();

    expect(Object.keys(deepseeks.default.options).sort()).toEqual(
      Object.keys(data.default.options).sort(),
    );
  });

  it('默认开启思考，且 reasoning_effort 落在 reasoningEfforts 之内', async () => {
    const data = await loadData();

    expect(data.default.options.thinking.type).toBe('enabled');
    expect(deepseeks.default.options.thinking.type).toBe('enabled');
    expect(deepseeks.reasoningEfforts).toContain(
      deepseeks.default.options.reasoning_effort,
    );
  });

  it('默认关闭 logprobs，max_tokens 为 0 表示不限制长度', async () => {
    const data = await loadData();

    expect(data.default.options.logprobs).toBe(false);
    expect(deepseeks.default.options.logprobs).toBe(false);
    expect(deepseeks.default.options.max_tokens).toBe(0);
    expect(deepseeks.default.config.token).toBeGreaterThan(0);
  });
});
