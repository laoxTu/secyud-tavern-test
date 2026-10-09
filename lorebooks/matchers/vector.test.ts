import { describe, expect, it } from 'vitest';

import type { Lorebook } from '@/lorebooks';
import type { MatchContext } from '@/lorebooks/client';
import { vectorMatcher } from '@/lorebooks/client/matchers/vector';
import type { PresetItem } from '@/presets';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./vector.cases.json')).default);
}

function createContext({
  rag,
  output,
  vectors,
}: {
  rag: boolean;
  output: boolean;
  vectors: string[][];
}): MatchContext {
  return {
    properties: {},
    output,
    message: {
      content: '',
      variables: [],
      properties: { lorebook_vector: structuredClone(vectors) },
    },
    history: null,
    cache: { before: [], after: [], entries: {}, rag: rag ? ({} as any) : null },
  } as unknown as MatchContext;
}

function createItem(id: string): PresetItem<Lorebook> {
  return { id } as PresetItem<Lorebook>;
}

describe('lorebooks matcher / vector', () => {
  it('应当按收集到的向量 id 判断是否激活', async () => {
    const { match } = await loadCases();

    for (const item of match) {
      expect(
        await vectorMatcher.match(
          createContext(item),
          createItem(item.entry),
        ),
        item.name,
      ).toBe(item.expected);
    }
  });

  it('命中集合应当缓存到上下文属性上，避免重复读取向量', async () => {
    const { match } = await loadCases();
    const item = match[0];
    const context = createContext(item);

    await vectorMatcher.match(context, createItem(item.entry));

    expect(context.properties[vectorMatcher.id]).toBeInstanceOf(Set);
    expect([...(context.properties[vectorMatcher.id] as Set<string>)]).toEqual([
      item.vectors[0][0],
    ]);
  });

  it('缓存命中后不再重新读取消息上的向量', async () => {
    const { match } = await loadCases();
    const item = match[0];
    const context = createContext(item);
    context.properties[vectorMatcher.id] = new Set(['other']);

    expect(await vectorMatcher.match(context, createItem(item.entry))).toBe(
      false,
    );
    expect(await vectorMatcher.match(context, createItem('other'))).toBe(true);
  });

  it('匹配器 id 应当是 vector', () => {
    expect(vectorMatcher.id).toBe('vector');
  });
});
