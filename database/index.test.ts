import { describe, expect, it, vi } from 'vitest';
import { validate, version } from 'uuid';

import type { Entries } from '@/database';
import { utils } from '@/database';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

/** 按 fixture 里的条目造一个 Entries 形状的实体 */
function createModel(id: string, plural: string, items: unknown[]) {
  return { id, entries: { [plural]: items } } as unknown as Entries;
}

describe('database utils / getProperty', () => {
  it('带 init 时应当惰性初始化，并只调用一次 init', async () => {
    const data = await loadCases();
    const item: any = { id: data.modelId };
    const init = vi.fn(() => structuredClone(data.initValue));

    const first = utils.getProperty(item, data.key, init);
    const second = utils.getProperty(item, data.key, init);

    expect(first).toEqual(data.initValue);
    expect(second).toEqual(data.initValue);
    expect(init).toHaveBeenCalledTimes(1);
    expect(item.properties[data.key]).toEqual(data.initValue);
  });

  it('属性已存在时应当直接返回，不调用 init', async () => {
    const data = await loadCases();
    const item: any = {
      properties: { [data.key]: structuredClone(data.existingValue) },
    };
    const init = vi.fn(() => structuredClone(data.initValue));

    expect(utils.getProperty(item, data.key, init)).toEqual(data.existingValue);
    expect(init).not.toHaveBeenCalled();
  });

  it('已有假值时应当保留，不被 init 覆盖', async () => {
    const data = await loadCases();
    const item: any = { properties: { [data.key]: data.falsyValue } };
    const init = vi.fn(() => structuredClone(data.initValue));

    expect(utils.getProperty(item, data.key, init)).toBe(data.falsyValue);
    expect(init).not.toHaveBeenCalled();
  });

  it('无 init 且属性不存在时应当返回 undefined，并把 properties 初始化成空对象', async () => {
    const data = await loadCases();
    const item: any = { id: data.modelId };

    expect(utils.getProperty(item, data.key)).toBeUndefined();
    expect(item.properties).toEqual({});
  });

  it('缺少 item 或 key 时应当短路，不建 properties、不调用 init', async () => {
    const data = await loadCases();
    const item: any = { id: data.modelId };
    const init = vi.fn(() => 1);

    expect(utils.getProperty(undefined as any, data.key, init)).toBeUndefined();
    expect(utils.getProperty(item, '', init)).toBeUndefined();
    expect(utils.getProperty(item, undefined as any, init)).toBeUndefined();

    expect(item.properties).toBeUndefined();
    expect(init).not.toHaveBeenCalled();
  });
});

describe('database utils / setProperty', () => {
  it('应当按 key 写入，并自动建出 properties', async () => {
    const data = await loadCases();
    const item: any = { id: data.modelId };

    utils.setProperty(item, data.key, data.initValue);

    expect(item.properties).toEqual({ [data.key]: data.initValue });
  });

  it('写入已有 properties 时不应当丢失其它字段', async () => {
    const data = await loadCases();
    const item: any = { properties: { [data.key]: data.existingValue } };

    utils.setProperty(item, data.otherPlural, data.initValue);

    expect(item.properties).toEqual({
      [data.key]: data.existingValue,
      [data.otherPlural]: data.initValue,
    });
  });

  it('缺少 item 或 key 时应当静默返回', async () => {
    const data = await loadCases();
    const item: any = { id: data.modelId };

    expect(() =>
      utils.setProperty(undefined, data.key, data.initValue),
    ).not.toThrow();
    utils.setProperty(item, '', data.initValue);
    utils.setProperty(item, undefined, data.initValue);

    expect(item.properties).toBeUndefined();
  });
});

describe('database utils / get 与 set', () => {
  it('properties 为空时应当短路', () => {
    const init = vi.fn(() => 1);

    expect(utils.get(undefined, 'k')).toBeUndefined();
    expect(utils.get(undefined as any, 'k', init)).toBeUndefined();
    expect(init).not.toHaveBeenCalled();
  });

  it('key 为空时应当短路', () => {
    const init = vi.fn(() => 1);

    expect(utils.get({}, '')).toBeUndefined();
    expect(utils.get({}, undefined)).toBeUndefined();
    expect(utils.get({}, '', init)).toBeUndefined();
    expect(init).not.toHaveBeenCalled();
  });

  it('带 init 时应当把初值写回 properties', async () => {
    const data = await loadCases();
    const properties: Record<string, any> = {};
    const init = vi.fn(() => structuredClone(data.initValue));

    expect(utils.get(properties, data.key, init)).toEqual(data.initValue);
    expect(utils.get(properties, data.key, init)).toEqual(data.initValue);

    expect(init).toHaveBeenCalledTimes(1);
    expect(properties[data.key]).toEqual(data.initValue);
  });

  it('set 应当写入指定 key', async () => {
    const data = await loadCases();
    const properties: Record<string, any> = {};

    utils.set(properties, data.key, data.initValue);
    expect(properties[data.key]).toEqual(data.initValue);

    utils.set(properties, data.key, undefined);
    expect(properties[data.key]).toBeUndefined();
  });

  it('set 缺少 properties 或 key 时应当静默返回', async () => {
    const data = await loadCases();
    const properties: Record<string, any> = {};

    expect(() => utils.set(undefined, data.key, data.initValue)).not.toThrow();
    utils.set(properties, '', data.initValue);
    utils.set(properties, undefined, data.initValue);

    expect(properties).toEqual({});
  });
});

describe('database utils / mapData', () => {
  it('应当逐项转换并保留 length', async () => {
    const data = await loadCases();
    const convert = (item: { id: string; name: string }) => ({
      ...item,
      name: item.name.toUpperCase(),
    });

    const result = utils.mapData(data.data, convert);

    expect(result.length).toBe(data.data.length);
    expect(result.items).toEqual(data.data.items.map(convert));
  });

  it('items 为空数组时应当返回空数组', async () => {
    const data = await loadCases();

    const result = utils.mapData(data.empty, (u: unknown) => u);

    expect(result.items).toEqual([]);
    expect(result.length).toBe(data.empty.length);
  });
});

describe('database utils / 条目访问', () => {
  it('getItems 应当只按 plural 取条目', async () => {
    const data = await loadCases();
    const model = createModel(data.modelId, data.plural, data.macros);

    expect(utils.getItems(model, data.plural)).toBe(model.entries![data.plural]);
    expect(utils.getItems(model, data.otherPlural)).toBeUndefined();
    expect(utils.getItems(model, data.emptyPlural)).toBeUndefined();
    // 完全没有 entries 字段时也是 undefined
    expect(utils.getItems({ id: data.modelId }, data.plural)).toBeUndefined();
  });

  it('条目形状：挂在 entries[plural] 下，每条都有 name', async () => {
    const data = await loadCases();
    const model = createModel(data.modelId, data.plural, data.macros);

    const entries = utils.getItems<{ name: string }>(model, data.plural)!;

    expect(entries.map((u) => u.name)).toEqual(data.macros.map((u) => u.name));
  });

  it('forEachItems 应当按数组顺序串行遍历，并带上实体本身', async () => {
    const data = await loadCases();
    const model = createModel(data.modelId, data.plural, data.macros);
    const log: string[] = [];
    const action = vi.fn(async (item: { name: string }, passed: Entries) => {
      log.push(`start:${item.name}`);
      await Promise.resolve();
      log.push(`end:${item.name}`);
      expect(passed).toBe(model);
    });

    await utils.forEachItems<{ name: string }, Entries>(model, data.plural, action);

    expect(action).toHaveBeenCalledTimes(data.macros.length);
    expect(action.mock.calls.map((u) => u[0])).toEqual(data.macros);
    expect(log).toEqual(
      data.macros.flatMap((u) => [`start:${u.name}`, `end:${u.name}`]),
    );
  });

  it('forEachItems 空数组或缺省条目时应当短路', async () => {
    const data = await loadCases();
    const action = vi.fn(async () => {});

    await utils.forEachItems(
      createModel(data.modelId, data.emptyPlural, []),
      data.emptyPlural,
      action,
    );
    await utils.forEachItems(
      createModel(data.modelId, data.plural, data.macros),
      data.otherPlural,
      action,
    );

    expect(action).not.toHaveBeenCalled();
  });

  it('forEachItemsList 应当按实体顺序依次遍历', async () => {
    const data = await loadCases();
    const models = data.models.map((model) =>
      createModel(model.id, data.plural, model.macros),
    );
    const seen: string[] = [];

    await utils.forEachItemsList<{ name: string }, Entries>(
      models,
      data.plural,
      async (item) => {
        seen.push(item.name);
      },
    );

    expect(seen).toEqual(
      data.models.flatMap((model) => model.macros.map((u) => u.name)),
    );
  });

  it('forEachItemsList 空列表时应当短路', async () => {
    const action = vi.fn(async () => {});

    await utils.forEachItemsList<{ name: string }, Entries>(
      [],
      'macros',
      action,
    );

    expect(action).not.toHaveBeenCalled();
  });
});

describe('database utils / uuid', () => {
  it('应当生成 v7 形态且互不重复', () => {
    const first = utils.uuid();
    const second = utils.uuid();

    expect(validate(first)).toBe(true);
    expect(validate(second)).toBe(true);
    expect(version(first)).toBe(7);
    expect(version(second)).toBe(7);
    expect(first).not.toBe(second);
  });
});
