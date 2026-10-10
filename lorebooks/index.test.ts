import { describe, expect, it } from 'vitest';

import { Lorebook, lorebooks } from '@/lorebooks';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

describe('lorebooks / 模块常量', () => {
  it('注册表用的 name 与 entries 的复数键应当保持不变', async () => {
    const data = await loadCases();

    expect(lorebooks.name).toBe(data.moduleInfo.name);
    expect(lorebooks.plural).toBe(data.moduleInfo.plural);
  });

  it('可选的内容类型应当与约定列表一致', async () => {
    const data = await loadCases();

    expect(lorebooks.types).toEqual(data.types);
  });

  it('默认条目应当是不可变的基础值', async () => {
    const data = await loadCases();

    expect(lorebooks.default).toEqual(data.defaultEntry);
  });
});

describe('lorebooks / sequence', () => {
  it('应当把 layer 与 priority 拼成一个可比较的序号', async () => {
    const { sequenceCases } = await loadCases();

    for (const item of sequenceCases) {
      expect(lorebooks.sequence(item as unknown as Lorebook)).toBe(
        item.expected,
      );
    }
  });
});

describe('lorebooks / compare', () => {
  it('排序应当先看 layer 再看 priority', async () => {
    const { sortCases } = await loadCases();
    const items = sortCases.items as Lorebook[];

    const sorted = [...items].sort(lorebooks.compare).map((u) => u.code);

    expect(sorted).toEqual(sortCases.expected);
  });

  it('同层低优先级在前，跨层时 layer 优先', async () => {
    const { adjacentCases } = await loadCases();

    for (const { left, right } of adjacentCases) {
      expect(lorebooks.compare(left as Lorebook, right as Lorebook)).toBeLessThan(
        0,
      );
      expect(
        lorebooks.compare(right as Lorebook, left as Lorebook),
      ).toBeGreaterThan(0);
    }
  });
});

describe('lorebooks / typeToExt', () => {
  it('已知类型映射到对应扩展名，未知类型落回 txt', async () => {
    const { typeToExtCases } = await loadCases();

    for (const item of typeToExtCases) {
      expect(lorebooks.typeToExt(item.type)).toBe(item.expected);
    }
  });
});
