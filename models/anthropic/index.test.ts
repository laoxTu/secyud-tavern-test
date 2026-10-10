import { describe, expect, it } from 'vitest';

import { anthropics } from '@/models/anthropic';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./index.json')).default);
}

describe('models anthropic / 描述信息', () => {
  it('name 应当与 fixture 一致', async () => {
    const data = await loadData();

    expect(anthropics.name).toBe(data.name);
  });

  it('default.config 应当使用 fixture 里的默认 url 与 extras', async () => {
    const data = await loadData();

    expect(anthropics.default.config.url).toBe(data.default.config.url);
    expect(anthropics.default.config.extras).toBe(data.default.config.extras);
    expect(anthropics.default.config).toEqual(data.default.config);
  });

  it('default.options 应当使用 fixture 里的默认 model 与 max_tokens', async () => {
    const data = await loadData();

    expect(anthropics.default.options.model).toBe(data.default.options.model);
    expect(anthropics.default.options.max_tokens).toBe(
      data.default.options.max_tokens,
    );
  });

  it('default.options 应当使用 fixture 里的默认 temperature 与 top_p', async () => {
    const data = await loadData();

    expect(anthropics.default.options.temperature).toBe(
      data.default.options.temperature,
    );
    expect(anthropics.default.options.top_p).toBe(data.default.options.top_p);
    expect(anthropics.default.options).toEqual(data.default.options);
  });

  it('default.config.extras 应当是可直接解析的 json', () => {
    expect(() => JSON.parse(anthropics.default.config.extras)).not.toThrow();
  });
});
