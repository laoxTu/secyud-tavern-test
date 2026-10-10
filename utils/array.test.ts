import { describe, expect, it } from 'vitest';

import { arrUtils } from '@/utils';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./array.cases.json')).default);
}

describe('arrUtils / intersperse', () => {
  it('应当在相邻项之间插入分隔项', async () => {
    const data = await loadCases();
    const { multi } = data.intersperse;

    const result = arrUtils.intersperse(
      multi.items as string[],
      (t) => `|${t}`,
      (t) => t,
    );

    expect(result).toEqual(multi.expected);
  });

  it('空数组与单项都不需要分隔', async () => {
    const data = await loadCases();

    for (const key of ['empty', 'single'] as const) {
      const item = data.intersperse[key];

      expect(
        arrUtils.intersperse(
          item.items as string[],
          (t) => `|${t}`,
          (t) => t,
        ),
        key,
      ).toEqual(item.expected);
    }
  });

  it('取值回调应当收到原始下标，首项下标为 -1', async () => {
    const data = await loadCases();
    const seen: number[] = [];

    arrUtils.intersperse(
      data.intersperse.multi.items as string[],
      (_, i) => {
        seen.push(i);
        return '';
      },
      () => '',
    );

    // 分隔项只会拿到 1 之后的下标
    expect(seen).toEqual([1, 2]);
  });
});

describe('arrUtils / join', () => {
  it('应当按用例拼接数组', async () => {
    const data = await loadCases();

    for (const item of data.join) {
      const value = item.useValue
        ? (u: any) => u.value
        : undefined;

      expect(
        arrUtils.join(item.items as any[], item.separator, value as any),
        item.name,
      ).toBe(item.expected);
    }
  });
});

describe('arrUtils / joinPath', () => {
  it('应当用斜杠连接并丢掉空段', async () => {
    const { joinPath } = await loadCases();

    for (const item of joinPath) {
      expect(arrUtils.joinPath(...item.parts)).toBe(item.expected);
    }
  });
});

describe('arrUtils / groupSerial', () => {
  it('应当只把相邻的同值分到一组', async () => {
    const data = await loadCases();
    const { serial } = data.groupSerial;

    const groups = arrUtils.groupSerial(serial.items as string[], (u) => u);

    expect(groups.map((u) => u.key)).toEqual(['a', 'b', 'a']);
    expect(groups.map((u) => u.items)).toEqual(serial.expected);
  });

  it('空数组与单项也应当得到正确的分组', async () => {
    const data = await loadCases();

    for (const key of ['empty', 'single'] as const) {
      const item = data.groupSerial[key];

      expect(
        arrUtils
          .groupSerial(item.items as string[], (u) => u)
          .map((u) => u.items),
        key,
      ).toEqual(item.expected);
    }
  });

  it('可以按对象字段分组', async () => {
    const data = await loadCases();
    const { objects } = data.groupSerial;

    const groups = arrUtils.groupSerial(objects.items, (u) => u.role);

    expect(groups.map((u) => u.key)).toEqual(['system', 'user']);
    expect(groups.map((u) => u.items.map((v) => v.text))).toEqual(
      objects.expected,
    );
  });
});
