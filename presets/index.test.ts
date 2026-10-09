import { describe, expect, it } from 'vitest';

import { Preset, presets } from '@/presets';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

describe('presets / toNameValue', () => {
  it('应当拼接为 名称-版本，值取预设 id', async () => {
    const { cases } = await loadCases();

    for (const item of cases) {
      expect(presets.toNameValue(item.preset as Preset)).toEqual(item.expected);
    }
  });

  it('名称与版本变化时应当反映到展示名上', async () => {
    const [, renamed] = (await loadCases()).cases;

    const item = presets.toNameValue(renamed.preset as Preset);

    expect(item.name).toBe(renamed.expected.name);
    expect(item.value).toBe(renamed.preset.id);
  });
});

describe('presets / 模块常量', () => {
  it('注册表用的 name 与 entries 的复数键应当保持不变', () => {
    expect(presets.name).toBe('preset');
    expect(presets.plural).toBe('presets');
  });

  it('标签集合应当覆盖预设编辑器里可选的分类', async () => {
    const { requiredTags } = await loadCases();

    for (const tag of requiredTags) {
      expect(presets.tags).toContain(tag);
    }
  });
});
