import { describe, expect, it } from 'vitest';

import type { Preset } from '@/presets';
import { macros } from '@/presets/macros/client';
import type { Realm } from '@/stories';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./entries.json')).default);
}

async function createRealm(entries: unknown[] = []): Promise<Realm> {
  const preset = structuredClone((await import('../preset.json')).default);

  return {
    ...structuredClone((await import('../../stories/realm.json')).default),
    // 宏状态挂在 realm.properties 上，每个用例独立一份
    properties: {},
    presets: [{ ...preset, entries: { macros: entries } } as Preset],
  } as unknown as Realm;
}

describe('macros / property 状态', () => {
  it('首次调用应当懒初始化空的 checkItems 与 selections', async () => {
    const realm = await createRealm();

    expect(macros.property(realm)).toEqual({
      checkItems: {},
      selections: {},
    });
  });

  it('重复调用应当返回同一份状态', async () => {
    const realm = await createRealm();

    const first = macros.property(realm);
    first.checkItems['x'] = true;

    expect(macros.property(realm)).toBe(first);
    expect(macros.property(realm).checkItems['x']).toBe(true);
  });

  it('状态应当挂在 realm.properties 上，随 realm 一起存活', async () => {
    const realm = await createRealm();

    const property = macros.property(realm);

    expect(realm.properties?.macro).toBe(property);
  });

  it('realm 没有 properties 时也应当能初始化', async () => {
    const realm = { presets: [] } as unknown as Realm;

    expect(macros.property(realm).selections).toEqual({});
    expect(realm.properties?.macro).toBeDefined();
  });

  it('单选项的 disabled 表示"当前选中"，默认是第一个 code', async () => {
    const data = await loadData();
    const realm = await createRealm(data.single);

    const cache = await macros.renderer.init({ realm });

    expect(macros.property(realm).selections.style).toBe('a');
    expect(cache.macros.style.singles['a'].disabled).toBe(true);
    expect(cache.macros.style.singles['b'].disabled).toBe(false);
  });

  it('selections 变化后单选项的 disabled 立即跟着变化', async () => {
    const data = await loadData();
    const realm = await createRealm(data.single);
    const cache = await macros.renderer.init({ realm });

    macros.property(realm).selections.style = 'b';

    expect(cache.macros.style.singles['a'].disabled).toBe(false);
    expect(cache.macros.style.singles['b'].disabled).toBe(true);
  });

  it('checkItems 控制复选项的 disabled', async () => {
    const data = await loadData();
    const realm = await createRealm(data.multiple);
    macros.property(realm).checkItems['x'] = true;

    const cache = await macros.renderer.init({ realm });

    expect(cache.macros.gear.multiples[0].disabled).toBe(true);
  });

  it('默认宏定义应当与 property 的键名约定一致', () => {
    expect(macros.name).toBe('macro');
    expect(macros.plural).toBe('macros');
  });
});
