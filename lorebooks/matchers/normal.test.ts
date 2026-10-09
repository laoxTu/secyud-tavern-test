import { describe, expect, it } from 'vitest';

import type { Lorebook } from '@/lorebooks';
import type { MatchContext } from '@/lorebooks/client';
import {
  normalConfig,
  normalMatch,
  normalMatcher,
} from '@/lorebooks/client/matchers/normal';
import type { PresetItem } from '@/presets';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./normal.cases.json')).default);
}

function toFormData(
  fields: Record<string, string> = {},
  keywords: Record<string, string[]> = {},
) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.append(name, value);
  }
  for (const [name, values] of Object.entries(keywords)) {
    for (const value of values) {
      data.append(name, value);
    }
  }
  return data;
}

function createContext(content: string): MatchContext {
  return {
    properties: {},
    output: false,
    message: { content },
    history: null,
    cache: { before: [], after: [], entries: {}, rag: null },
  } as unknown as MatchContext;
}

function createItem(expression: unknown): PresetItem<Lorebook> {
  return { expression } as PresetItem<Lorebook>;
}

describe('lorebooks matcher / normal 配置', () => {
  it('应当按 keywordsLength 收集每组关键词', async () => {
    const { config } = await loadCases();
    const item = config.full;

    expect(
      normalConfig(toFormData(item.fields, item.keywords)),
    ).toEqual(item.expected);
  });

  it('缺少某一组关键词时该组应当是空数组', async () => {
    const { config } = await loadCases();
    const item = config.emptyGroup;

    expect(
      normalConfig(toFormData(item.fields, item.keywords)),
    ).toEqual(item.expected);
  });

  it('fitCount 不应超过实际组数', async () => {
    const { config } = await loadCases();
    const item = config.fitCountClamped;

    expect(
      normalConfig(toFormData(item.fields, item.keywords)),
    ).toEqual(item.expected);
  });
});

describe('lorebooks matcher / normal 匹配', () => {
  it('应当按命中组数与 fitCount 判断', async () => {
    const { match } = await loadCases();

    for (const item of match) {
      expect(
        normalMatch(createContext(item.content), item.expression as any),
        item.name,
      ).toBe(item.expected);
    }
  });

  it('匹配器应当把条目表达式交给 normalMatch', async () => {
    const { match } = await loadCases();
    const item = match[0];

    expect(
      await normalMatcher.match(
        createContext(item.content),
        createItem(item.expression),
      ),
    ).toBe(item.expected);
  });

  it('匹配器 id 应当是 normal', () => {
    expect(normalMatcher.id).toBe('normal');
  });

  it('正文命中但关键词组已达标时应当提前返回', async () => {
    const { match } = await loadCases();
    const item = match.find((u) => u.name.includes('提前返回'))!;

    expect(
      normalMatch(createContext(item.content), item.expression as any),
    ).toBe(item.expected);
  });
});
