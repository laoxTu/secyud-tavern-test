import { describe, expect, it } from 'vitest';

import { openais } from '@/models/openai';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./index.json')).default);
}

describe('models openai / 描述信息', () => {
  it('name 应当与 fixture 一致', async () => {
    const data = await loadData();

    expect(openais.name).toBe(data.name);
  });

  it('formats 应当只声明 chat 与 responses 两种格式，且顺序与 fixture 一致', async () => {
    const data = await loadData();

    expect(openais.formats).toEqual(data.formats);
  });

  it('default.config 应当使用 fixture 里的默认值', async () => {
    const data = await loadData();

    expect(openais.default.config).toEqual(data.default.config);
  });

  it('default.options 应当使用 fixture 里的默认值', async () => {
    const data = await loadData();

    expect(openais.default.options).toEqual(data.default.options);
  });

  it('default.options 的 max_output_tokens 应当是可选字段，默认不存在', async () => {
    const data = await loadData();
    // fixture 里没有这个键，按索引访问才能断言「默认不存在」
    const options = data.default.options as Record<string, unknown>;

    expect(options.max_output_tokens).toBeUndefined();
    expect('max_output_tokens' in openais.default.options).toBe(false);
  });

  it('default.config 的 format 应当在声明的 formats 之内', async () => {
    const data = await loadData();

    expect(data.formats).toContain(openais.default.config.format);
  });
});
