import { describe, expect, it } from 'vitest';

import type { ConvertContent } from '@/models/client';
import type { Preset } from '@/presets';
import { macros } from '@/presets/macros/client';
import type { MacroCache } from '@/presets/macros/client/realm';
import type { Realm, RealmHistory } from '@/stories';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./entries.json')).default);
}

interface RenderOptions {
  history?: RealmHistory;
  properties?: Record<string, any>;
}

async function createRealm(entries: unknown[]): Promise<Realm> {
  const preset = structuredClone((await import('../preset.json')).default);
  const realm = structuredClone(
    (await import('../../stories/realm.json')).default,
  );

  return {
    ...realm,
    // 宏的选择/勾选状态存在 realm.properties 上，这里给每个用例独立的一份
    properties: {},
    presets: [
      { ...preset, entries: { macros: entries } } as unknown as Preset,
    ],
  } as unknown as Realm;
}

async function createHistory(rich: boolean): Promise<RealmHistory> {
  const data = await loadData();
  return structuredClone(
    rich ? data.richHistory : data.history,
  ) as unknown as RealmHistory;
}

/** 一次渲染会把当时的宏值固定进转换函数，改缓存后需要重新渲染才生效 */
async function renderOnce(
  realm: Realm,
  cache: MacroCache,
  options: RenderOptions = {},
) {
  const history = options.history ?? (await createHistory(false));
  const converts: ConvertContent[] = [];
  await macros.renderer.output!(
    { realm, history, converts, properties: options.properties },
    cache,
  );
  return { convert: converts[0], history };
}

async function createConvert(realm: Realm, options: RenderOptions = {}) {
  const cache = await macros.renderer.init({ realm });
  const { convert } = await renderOnce(realm, cache, options);
  return { cache, convert };
}

const CONTEXT = { role: 'assistant', type: 'output', history: null! };

describe('macros / init', () => {
  it('单选项应当按 code 归组，没有选择时默认落到第一个 code 上', async () => {
    const data = await loadData();
    const realm = await createRealm(data.single);

    const cache = await macros.renderer.init({ realm });

    expect(Object.keys(cache.macros.style.singles)).toEqual(['a', 'b']);
    expect(cache.macros.style.multiples).toHaveLength(0);
    expect(cache.macros.style.select).toBe('a');
    // 默认选择会写回 realm 状态，选择器与求值读的是同一份数据
    expect(macros.property(realm).selections.style).toBe('a');
  });

  it('已保存的单选应当被 init 保留', async () => {
    const data = await loadData();
    const realm = await createRealm(data.single);
    // 默认会选第一个 a，这里先存一个 b，init 不应该把它覆盖掉
    macros.property(realm).selections.style = 'b';

    const cache = await macros.renderer.init({ realm });

    expect(cache.macros.style.select).toBe('b');
    expect(cache.macros.style.singles['b'].disabled).toBe(true);
  });

  it('复选项应当全部进入 multiples，并按 code 分池', async () => {
    const data = await loadData();
    const realm = await createRealm(data.multiple);

    const cache = await macros.renderer.init({ realm });

    expect(cache.macros.gear.multiples).toHaveLength(2);
    expect(cache.multiples['x']).toHaveLength(1);
    expect(cache.multiples['y']).toHaveLength(1);
  });

  it('hidden 为 false 的条目应当让整个 key 可见', async () => {
    const data = await loadData();
    const realm = await createRealm(data.hidden);

    const cache = await macros.renderer.init({ realm });

    expect(cache.macros.hidden_key.hidden).toBe(true);
    expect(cache.macros.multi_key.hidden).toBe(false);
  });

  it('JSON 宏的值应当被解析为对象，普通宏保持字符串', async () => {
    const data = await loadData();
    const realm = await createRealm(data.jsonObject);

    const cache = await macros.renderer.init({ realm });

    expect(cache.macros.cfg.singles['j'].content).toEqual({ a: 1 });
    expect(cache.macros.text.singles['p'].content).toBe('plain');
  });
});

describe('macros / apply 求值', () => {
  it('单选项只有被选中的那个参与求值，切换后重新渲染生效', async () => {
    const data = await loadData();
    const realm = await createRealm(data.single);
    const cache = await macros.renderer.init({ realm });

    const first = await renderOnce(realm, cache);
    expect(await first.convert('<%= it.style %>', CONTEXT)).toBe('A');

    // 选择器切换：写入 selections 与 cache.select
    cache.macros.style.select = 'b';

    const second = await renderOnce(realm, cache);
    expect(await second.convert('<%= it.style %>', CONTEXT)).toBe('B');
  });

  it('复选项应当按声明顺序拼接文本', async () => {
    const data = await loadData();
    const realm = await createRealm(data.multiple);

    const { convert } = await createConvert(realm);

    expect(await convert('<%= it.gear %>', CONTEXT)).toBe('XY');
  });

  it('持久化的单选指向已删除的 code 时应当跳过', async () => {
    const data = await loadData();
    const realm = await createRealm(data.stale);
    // 选择器把状态存在 realm.properties 上并持久化，条目删掉后会残留旧 code
    macros.property(realm).selections.gear = 'ghost';
    const cache = await macros.renderer.init({ realm });

    const { convert } = await renderOnce(realm, cache);

    // 残留的 code 跳过，其余复选项正常求值
    await expect(convert('<%= it.gear %>', CONTEXT)).resolves.toBe('X');
  });

  it('复选项被禁用后不应参与拼接，重新勾选后恢复', async () => {
    const data = await loadData();
    const realm = await createRealm(data.multiple);
    const { checkItems } = macros.property(realm);
    checkItems['x'] = true;

    const cache = await macros.renderer.init({ realm });
    const off = await renderOnce(realm, cache);
    expect(await off.convert('<%= it.gear %>', CONTEXT)).toBe('Y');

    checkItems['x'] = false;
    const on = await renderOnce(realm, cache);
    expect(await on.convert('<%= it.gear %>', CONTEXT)).toBe('XY');
  });

  it('JSON 宏与文本宏同 key 时应当合并，且字符串化为拼接文本', async () => {
    const data = await loadData();
    const realm = await createRealm(data.jsonMerge);

    const { convert } = await createConvert(realm);

    expect(await convert('<%= it.cfg.a %>', CONTEXT)).toBe('1');
    expect(await convert('<%= it.cfg %>', CONTEXT)).toBe('note');
  });

  it('多个 JSON 宏应当递归合并（后者覆盖同名键）', async () => {
    const data = await loadData();
    const realm = await createRealm(data.jsonOnly);

    const { convert } = await createConvert(realm);

    expect(await convert('<%= it.cfg.b %>', CONTEXT)).toBe('3');
    expect(await convert('<%= it.cfg.c %>', CONTEXT)).toBe('4');
    expect(await convert('<%= it.cfg.a %>', CONTEXT)).toBe('1');
  });

  it('properties.args 应当覆盖同名宏', async () => {
    const data = await loadData();
    const realm = await createRealm(data.simple);

    const { convert } = await createConvert(realm, {
      properties: { args: { greet: 'override' } },
    });

    expect(await convert('<%= it.greet %>', CONTEXT)).toBe('override');
  });

  it('历史变量应当以 variables 注入', async () => {
    const data = await loadData();
    const realm = await createRealm(data.simple);
    const history = await createHistory(true);

    const { convert } = await createConvert(realm, { history });

    expect(await convert('HP=<%= it.variables.hp %>', CONTEXT)).toBe('HP=10');
  });

  it('不需要宏的内容应当原样通过', async () => {
    const data = await loadData();
    const realm = await createRealm(data.simple);

    const { convert } = await createConvert(realm);

    expect(await convert('纯文本内容', CONTEXT)).toBe('纯文本内容');
  });
});

describe('macros / 类型', () => {
  it('默认宏定义应当为单选、非 JSON、可见', () => {
    expect(macros.default).toEqual({
      code: 'macro',
      key: 'macro',
      json: false,
      multiple: false,
      hidden: false,
      value: '',
    });
  });
});
