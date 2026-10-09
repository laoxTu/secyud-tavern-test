import { describe, expect, it } from 'vitest';

import type { Lorebook } from '@/lorebooks';
import type { MatchContext } from '@/lorebooks/client';
import {
  eventMatcher,
  getDateNumber,
} from '@/lorebooks/client/matchers/event';
import type { PresetItem } from '@/presets';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./event.cases.json')).default);
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

function createContext(content: string, variables: unknown): MatchContext {
  return {
    properties: { variables: structuredClone(variables) },
    output: false,
    message: { content },
    history: null,
    cache: { before: [], after: [], entries: {}, rag: null },
  } as unknown as MatchContext;
}

describe('lorebooks matcher / event 日期序号', () => {
  it('应当把年月日压成一个可比较的整数', async () => {
    const { dateNumbers } = await loadCases();

    for (const item of dateNumbers) {
      expect(getDateNumber(item.date as any)).toBe(item.expected);
    }
  });

  it('同日期的序号应当稳定', async () => {
    const { dateNumbers } = await loadCases();
    const [first] = dateNumbers;

    expect(getDateNumber(first.date as any)).toBe(
      getDateNumber(structuredClone(first.date) as any),
    );
  });
});

describe('lorebooks matcher / event 匹配', () => {
  it('应当同时满足日期区间与关键词', async () => {
    const { match } = await loadCases();

    for (const item of match) {
      expect(
        await eventMatcher.match(
          createContext(item.content, item.variables),
          { expression: item.expression } as PresetItem<Lorebook>,
        ),
        item.name,
      ).toBe(item.expected);
    }
  });

  it('配置应当同时写入日期与关键词', async () => {
    const { configure } = await loadCases();
    const lorebook: Lorebook = { expression: {} } as Lorebook;

    await eventMatcher.configureObject!(
      toFormData(configure.fields, configure.keywords),
      lorebook,
    );

    expect(lorebook.expression).toEqual(configure.expected);
  });

  it('匹配器 id 应当是 event', () => {
    expect(eventMatcher.id).toBe('event');
  });
});
