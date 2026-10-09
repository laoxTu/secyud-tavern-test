import { describe, expect, it } from 'vitest';

import type { Lorebook } from '@/lorebooks';
import type { MatchContext } from '@/lorebooks/client';
import { variableMatcher } from '@/lorebooks/client/matchers/variable';
import type { PresetItem } from '@/presets';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./variable.cases.json')).default);
}

function toFormData(pairs: string[][]) {
  const data = new FormData();
  for (const [name, value] of pairs) {
    data.append(name, value);
  }
  return data;
}

function createContext(variables: unknown): MatchContext {
  return {
    properties: { variables: structuredClone(variables) },
    output: false,
    message: { content: '' },
    history: null,
    cache: { before: [], after: [], entries: {}, rag: null },
  } as unknown as MatchContext;
}

function createItem(expression: unknown): PresetItem<Lorebook> {
  return { expression } as PresetItem<Lorebook>;
}

describe('lorebooks matcher / variable', () => {
  it('应当按路径取值并与表达式比较', async () => {
    const data = await loadCases();

    for (const item of data.match) {
      expect(
        await variableMatcher.match(
          createContext(data.variables),
          createItem({ path: item.path, value: item.value }),
        ),
        item.name,
      ).toBe(item.expected);
    }
  });

  it('值不同时应当不匹配', async () => {
    const data = await loadCases();

    expect(
      await variableMatcher.match(
        createContext(data.variables),
        createItem({ path: '/hp', value: '10' }),
      ),
    ).toBe(true);
    expect(
      await variableMatcher.match(
        createContext(data.variables),
        createItem({ path: '/hp', value: '10 ' }),
      ),
    ).toBe(false);
  });

  it('配置应当从 match_path 与 match_value 读出', async () => {
    const lorebook: Lorebook = { expression: {} } as Lorebook;

    await variableMatcher.configureObject!(
      toFormData([
        ['match_path', '/hp'],
        ['match_value', '10'],
      ]),
      lorebook,
    );

    expect(lorebook.expression).toEqual({ path: '/hp', value: '10' });
  });

  it('输入框留空时应当保留空串', async () => {
    const lorebook: Lorebook = { expression: {} } as Lorebook;

    await variableMatcher.configureObject!(
      toFormData([
        ['match_path', ''],
        ['match_value', ''],
      ]),
      lorebook,
    );

    expect(lorebook.expression).toEqual({ path: '', value: '' });
  });

  it('匹配器 id 应当是 variable', () => {
    expect(variableMatcher.id).toBe('variable');
  });
});
