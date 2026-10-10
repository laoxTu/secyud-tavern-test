import { describe, expect, it } from 'vitest';

import { Model, models } from '@/models';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

describe('models / 模块常量', () => {
  it('设置项、配置与选项的属性键应当保持不变', async () => {
    const data = await loadCases();

    expect(models.state.setting).toBe(data.state.setting);
    expect(models.names.config).toBe(data.names.config);
    expect(models.names.options).toBe(data.names.options);
  });

  it('配置与选项应当是两个不同的键，避免互相覆盖', () => {
    expect(models.names.config).not.toBe(models.names.options);
  });
});

describe('models / toNameValue', () => {
  it('展示名取模型名，值取模型 id', async () => {
    const data = await loadCases();

    for (const item of data.models) {
      expect(models.toNameValue(item as Model)).toEqual({
        name: item.name,
        value: item.id,
      });
    }
  });

  it('其余字段不应出现在下拉项里', async () => {
    const [item] = (await loadCases()).models;

    expect(Object.keys(models.toNameValue(item as Model)).sort()).toEqual([
      'name',
      'value',
    ]);
  });

  it('名称为空时也应当原样返回，由调用方决定展示', async () => {
    const [item] = (await loadCases()).models;

    expect(models.toNameValue({ ...item, name: '' } as Model)).toEqual({
      name: '',
      value: item.id,
    });
  });
});
