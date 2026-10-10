import { describe, expect, it } from 'vitest';

import type { ConvertContent } from '@/models/client';
import type { Preset, PresetItem } from '@/presets';
import type { Regex } from '@/presets/regexes';
import { regexes } from '@/presets/regexes/client';
import type { Realm, RealmHistory } from '@/stories';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./entries.json')).default);
}

/** 转义函数只用到 history，这里不需要真实历史 */
const HISTORY = null! as RealmHistory;

async function createRealm(
  groups: unknown[][],
  presetIds: string[] = [],
): Promise<Realm> {
  const preset = structuredClone((await import('../preset.json')).default);
  const realm = structuredClone(
    (await import('../../stories/realm.json')).default,
  );

  return {
    ...realm,
    properties: {},
    presets: groups.map((entries, i) => ({
      ...preset,
      id: presetIds[i] ?? `${preset.id}-${i}`,
      entries: { regexes: entries },
    })) as unknown as Preset[],
  } as unknown as Realm;
}

/** 走完 init + output，拿到注入 conversions 的转换函数 */
async function applyOutput(realm: Realm) {
  const converts: ConvertContent[] = [];
  const cache = await regexes.renderer.init({ realm });
  await regexes.renderer.output!({ realm, history: HISTORY, converts }, cache);
  return { cache, convert: converts[0] };
}

const CONTEXT = { role: 'assistant', type: 'output', history: HISTORY };

describe('regexes / init 作用域', () => {
  it('processer（输入侧）应当只收集 input 与 both', async () => {
    const data = await loadData();
    const realm = await createRealm([data.scoped]);

    const cache = await regexes.processer.init!({ properties: {}, realm });

    expect(
      cache.regexes.map((u: PresetItem<Regex & { code: string }>) => u.code),
    ).toEqual(['in', 'both']);
  });

  it('renderer（输出侧）应当只收集 output 与 both', async () => {
    const data = await loadData();
    const realm = await createRealm([data.scoped]);

    const cache = await regexes.renderer.init({ realm });

    expect(
      cache.regexes.map((u: PresetItem<Regex & { code: string }>) => u.code),
    ).toEqual(['out', 'both']);
  });

  it('disabled 的规则不应进入缓存', async () => {
    const data = await loadData();
    const realm = await createRealm([data.enabledOnly]);

    const cache = await regexes.renderer.init({ realm });

    expect(
      cache.regexes.map((u: PresetItem<Regex & { code: string }>) => u.code),
    ).toEqual(['on']);
  });

  it('多个预设的规则都应当被收集（按预设顺序）', async () => {
    const data = await loadData();
    const realm = await createRealm(
      [data.firstPreset, data.secondPreset, data.thirdPreset],
      ['p1', 'p2', 'p3'],
    );

    const cache = await regexes.renderer.init({ realm });

    expect(
      cache.regexes.map((u: PresetItem<Regex & { code: string }>) => u.code),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('regexes / apply', () => {
  it('应当按配置顺序依次替换，前一条的结果会进入后一条', async () => {
    const data = await loadData();
    const realm = await createRealm([data.chain]);

    const { convert } = await applyOutput(realm);

    expect(await convert('a', CONTEXT)).toBe('c');
  });

  it('字符串 pattern 只替换第一个命中', async () => {
    const data = await loadData();
    const realm = await createRealm([data.firstOnly]);

    const { convert } = await applyOutput(realm);

    expect(await convert('aaa', CONTEXT)).toBe('Xaa');
  });

  it('role 为 tool 的内容应当原样返回', async () => {
    const data = await loadData();
    const realm = await createRealm([data.firstOnly]);

    const { convert } = await applyOutput(realm);

    expect(await convert('aaa', { ...CONTEXT, role: 'tool' })).toBe('aaa');
  });

  it('空内容应当直接返回空串', async () => {
    const data = await loadData();
    const realm = await createRealm([data.firstOnly]);

    const { convert } = await applyOutput(realm);

    expect(await convert('', CONTEXT)).toBe('');
  });

  it('没有规则时应当原样返回内容', async () => {
    const data = await loadData();
    const realm = await createRealm([data.empty]);

    const { convert } = await applyOutput(realm);

    expect(await convert('keep me', CONTEXT)).toBe('keep me');
  });
});
