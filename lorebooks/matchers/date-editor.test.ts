import { describe, expect, it } from 'vitest';

import { getDate } from '@/lorebooks/client/matchers/date-editor';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./date-editor.cases.json')).default);
}

function toFormData(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.append(name, value);
  }
  return data;
}

describe('lorebooks matcher / date-editor', () => {
  it('应当按 name 前缀读取年、月、日', async () => {
    const data = await loadCases();

    expect(getDate(toFormData(data.full.fields), data.name)).toEqual(
      data.full.expected,
    );
  });

  it('数字应当按整数解析，去掉前导零', async () => {
    const data = await loadCases();

    expect(getDate(toFormData(data.negative.fields), data.name)).toEqual(
      data.negative.expected,
    );
    expect(getDate(toFormData(data.full.fields), data.name).month).toBe(7);
  });

  it('缺少字段时解析结果不是数字', async () => {
    const data = await loadCases();
    const result = getDate(toFormData(data.partial.fields), data.name);

    expect(result.year).toBe(2024);
    for (const key of data.partial.missing) {
      expect(Number.isNaN(result[key as 'month' | 'day'])).toBe(true);
    }
  });
});
