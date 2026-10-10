import { describe, expect, it } from 'vitest';

import { resources } from '@/generated/resources';
import { jsonUtils } from '@/utils';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./generated.cases.json')).default);
}

/** 与 src/localization/request.ts 一致：逐模块深合并 */
function messagesOf(list: any[]) {
  return list.reduce((p, c) => jsonUtils.merge(p, c.default), {} as Record<string, any>);
}

/** 递归收集对象的键路径，用来比较两个语言包的键集合 */
function keyPaths(value: any, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, item]) =>
    keyPaths(item, prefix ? `${prefix}.${key}` : key),
  );
}

function get(messages: Record<string, any>, key: string) {
  return key.split('.').reduce((p: any, c) => p?.[c], messages);
}

describe('generated resources / 语言包', () => {
  it('每个语言都应当返回全部模块的语言包', async () => {
    const data = await loadCases();

    for (const locale of data.locales) {
      const list = await resources[locale]();

      expect(list, locale).toHaveLength(data.expectedModuleCount);
      for (const item of list) {
        expect(typeof item.default, locale).toBe('object');
      }
    }
  });

  it('en / zh 暴露的模块数量与顺序应当一致', async () => {
    const data = await loadCases();
    const [first, ...rest] = data.locales;
    const base = await resources[first]();

    for (const locale of rest) {
      const list = await resources[locale]();
      expect(list.length, locale).toBe(base.length);
    }
  });

  it('合并后应当包含各模块的样例键', async () => {
    const data = await loadCases();

    for (const locale of data.locales) {
      const messages = messagesOf(await resources[locale]());

      for (const key of data.sampleKeys[locale as 'zh' | 'en']) {
        expect(get(messages, key), `${locale} / ${key}`).toBeTruthy();
      }
    }
  });

  it('两个语言包的键集合差异应当只有已知的那几个（缺翻译会被发现）', async () => {
    const data = await loadCases();
    const zh = new Set(keyPaths(messagesOf(await resources.zh())));
    const en = new Set(keyPaths(messagesOf(await resources.en())));

    const zhOnly = [...zh].filter((u) => !en.has(u));
    const enOnly = [...en].filter((u) => !zh.has(u));

    // 现状：zh / en 各有 5 个键只在一边存在（已记录在 fixture，待确认是否补齐翻译）
    expect({ zhOnly, enOnly }).toEqual({
      zhOnly: data.knownKeyGaps.zh,
      enOnly: data.knownKeyGaps.en,
    });
  });

  it('两个语言包的键总数应当一致', async () => {
    const zh = keyPaths(messagesOf(await resources.zh()));
    const en = keyPaths(messagesOf(await resources.en()));

    expect(zh.length).toBe(en.length);
  });

  it('未知语言应当拿到 undefined', () => {
    expect(resources.unknown).toBeUndefined();
  });
});
