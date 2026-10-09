import { describe, expect, it } from 'vitest';

import type { Lorebook } from '@/lorebooks';
import { lorebooks } from '@/lorebooks/client';
import { alwaysMatcher } from '@/lorebooks/client/matchers/always';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./always.cases.json')).default);
}

function toFormData(pairs: string[][]) {
  const data = new FormData();
  for (const [name, value] of pairs) {
    data.append(name, value);
  }
  return data;
}

describe('lorebooks matcher / always', () => {
  it('匹配器 id 应当与默认条目的 match 一致', async () => {
    const { entry } = await loadCases();

    expect(alwaysMatcher.id).toBe((entry as Lorebook).match);
  });

  it('任何时候都应当返回匹配成功', async () => {
    const { entry } = await loadCases();

    expect(
      await alwaysMatcher.match(null as any, entry as any),
    ).toBe(true);
  });

  it('配置应当从表单读出 last 与 macro', async () => {
    const { configureCases } = await loadCases();

    for (const item of configureCases) {
      const lorebook: Lorebook = { expression: {} } as Lorebook;

      await alwaysMatcher.configureObject!(toFormData(item.form), lorebook);

      expect(lorebook.expression).toEqual(item.expected);
    }
  });

  it('重新配置应当整体覆盖旧表达式，而不是合并', async () => {
    const { replace } = await loadCases();
    const lorebook = {
      expression: structuredClone(replace.expression),
    } as Lorebook;

    await alwaysMatcher.configureObject!(toFormData(replace.form), lorebook);

    expect(lorebook.expression).toEqual(replace.expected);
  });

  it('注册表里应当能按 id 取回匹配器', () => {
    lorebooks.matchers.registry.register(alwaysMatcher);
    try {
      expect(lorebooks.matchers.registry.record(alwaysMatcher.id)).toBe(
        alwaysMatcher,
      );
    } finally {
      lorebooks.matchers.registry.unregister(alwaysMatcher.id);
    }
  });
});
