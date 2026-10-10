import { describe, expect, it } from 'vitest';

import { config, forms } from '@/global';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./index.cases.json')).default);
}

/** 按用例拼一份 FormData（同名多次 append 用于多值字段） */
function buildForm(entries: [string, string][]) {
  const data = new FormData();
  for (const [name, value] of entries) {
    data.append(name, value);
  }
  return data;
}

describe('global / 模块导出与 config', () => {
  it('config 应当只有约定的 dataDir 常量', async () => {
    const data = await loadData();

    expect(config).toEqual(data.config);
    expect(config.dataDir).toBe(data.config.dataDir);
  });

  it('类型约定不产生运行时导出，forms 只挂 7 个取值助手', async () => {
    const data = await loadData();
    const module = await import('@/global');

    // SettingModel / ProxyParam 是纯类型，运行期只剩 config 与 forms
    expect(Object.keys(module).sort()).toEqual(data.runtimeExports);
    expect(Object.keys(forms).sort()).toEqual(data.formHelpers);
  });
});

describe('global / forms 单值字段', () => {
  it('str 取字符串：缺失给 null，空串原样保留', async () => {
    const data = await loadData();
    const form = buildForm([
      ['str', data.fields.str],
      ['empty', data.fields.empty],
    ]);

    expect(forms.str(form, 'str')).toBe(data.fields.str);
    expect(forms.str(form, 'empty')).toBe(data.fields.empty);
    expect(forms.str(form, 'missing')).toBeNull();
  });

  it('bool 按「存在且非空串」判定，字符串 false / 0 也为真', async () => {
    const data = await loadData();
    const form = buildForm([
      ['true', data.fields.true],
      ['false', data.fields.false],
      ['zero', data.fields.zero],
      ['empty', data.fields.empty],
    ]);

    expect(forms.bool(form, 'true')).toBe(true);
    expect(forms.bool(form, 'false')).toBe(true);
    expect(forms.bool(form, 'zero')).toBe(true);
    expect(forms.bool(form, 'empty')).toBe(false);
    expect(forms.bool(form, 'missing')).toBe(false);
  });

  it('int 走 parseInt：前导数字可用，非数字与缺失给 NaN', async () => {
    const data = await loadData();
    const form = buildForm([
      ['int', data.fields.int],
      ['intPartial', data.fields.intPartial],
      ['intInvalid', data.fields.intInvalid],
      ['empty', data.fields.empty],
    ]);

    expect(forms.int(form, 'int')).toBe(parseInt(data.fields.int));
    expect(forms.int(form, 'intPartial')).toBe(
      parseInt(data.fields.intPartial),
    );
    expect(forms.int(form, 'intInvalid')).toBeNaN();
    expect(forms.int(form, 'empty')).toBeNaN();
    expect(forms.int(form, 'missing')).toBeNaN();
  });

  it('float 走 parseFloat：前导数字可用，非数字与缺失给 NaN', async () => {
    const data = await loadData();
    const form = buildForm([
      ['float', data.fields.float],
      ['floatPartial', data.fields.floatPartial],
      ['floatInvalid', data.fields.floatInvalid],
      ['empty', data.fields.empty],
    ]);

    expect(forms.float(form, 'float')).toBe(parseFloat(data.fields.float));
    expect(forms.float(form, 'floatPartial')).toBe(
      parseFloat(data.fields.floatPartial),
    );
    expect(forms.float(form, 'floatInvalid')).toBeNaN();
    expect(forms.float(form, 'empty')).toBeNaN();
    expect(forms.float(form, 'missing')).toBeNaN();
  });

  it('file 返回 File 本体，缺失时给 null', async () => {
    const data = await loadData();
    const file = new File([data.upload.content], data.upload.name, {
      type: data.upload.type,
    });
    const form = new FormData();
    form.append('upload', file);

    expect(forms.file(form, 'upload')).toBe(file);
    expect(forms.file(form, 'missing')).toBeNull();
  });
});

describe('global / forms 多值字段', () => {
  it('单值助手只取第一个值，多值助手取全部', async () => {
    const data = await loadData();
    const form = buildForm(
      data.multi.strs.map((value: string) => ['strs', value] as [string, string]),
    );

    expect(forms.str(form, 'strs')).toBe(data.multi.strs[0]);
    expect(forms.strs(form, 'strs')).toEqual(data.multi.strs);
    expect(forms.strs(form, 'missing')).toEqual([]);
  });

  it('ints 逐个 parseInt，非数字落成 NaN', async () => {
    const data = await loadData();
    const form = buildForm([
      ...data.multi.ints.map((value: string) => ['ints', value] as [string, string]),
      ...data.multi.intsInvalid.map(
        (value: string) => ['intsInvalid', value] as [string, string],
      ),
    ]);

    // int 与 str 一样走 get，多值时只看第一个
    expect(forms.int(form, 'ints')).toBe(parseInt(data.multi.ints[0]));
    expect(forms.ints(form, 'ints')).toEqual(
      data.multi.ints.map((value: string) => parseInt(value)),
    );
    expect(forms.ints(form, 'intsInvalid')).toEqual([NaN, NaN]);
    expect(forms.ints(form, 'missing')).toEqual([]);
  });
});
