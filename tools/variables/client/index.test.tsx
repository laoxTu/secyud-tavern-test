import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Realm, RealmHistory } from '@/stories';
import { tools } from '@/tools';
import { variables as main } from '@/tools/variables';
import { variables } from '@/tools/variables/client';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

async function createRealm(histories: unknown[] = []): Promise<Realm> {
  const realm = structuredClone(
    (await import('../../../stories/realm.json')).default,
  );

  return {
    ...realm,
    properties: {},
    histories: histories as RealmHistory[],
  } as unknown as Realm;
}

/** provider.create 会把 realm 关进闭包，所以工具必须绑定在同一个 realm 上 */
async function createTools(realm: Realm) {
  return await variables.create(null as any, realm);
}

function lastOutput(realm: Realm) {
  return realm
    .histories!.at(-1)!
    .outputs.at(-1)!
    .at(-1)!;
}

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('variables client / provider', () => {
  it('id 应当与模块名、默认工具类型一致', () => {
    expect(variables.id).toBe(main.name);
    expect(variables.id).toBe(tools.default.type);
  });

  it('create 应当返回 get / set / del 三个工具', async () => {
    const data = await loadCases();
    const items = await createTools(await createRealm());

    expect(items.map((u) => u.name)).toEqual(data.toolNames);
    expect(items.every((u) => typeof u.invoke === 'function')).toBe(true);
    expect(items.every((u) => u.description.length > 0)).toBe(true);
  });

  it('参数 schema 应当按用途声明必需字段', async () => {
    const data = await loadCases();
    const [get, set, del] = await createTools(await createRealm());

    expect(get.parameters.required).toEqual(data.get.required);
    expect(get.parameters.additionalProperties).toBe(
      data.get.additionalProperties,
    );
    expect(
      (get.parameters.properties as Record<string, any>).path.type,
    ).toBe(data.get.pathType);

    expect(set.parameters.required).toEqual(data.set.required);
    expect(
      (
        (set.parameters.properties as Record<string, any>).value
          .anyOf as { type: string }[]
      ).map((u) => u.type),
    ).toEqual(data.set.valueTypes);

    expect(del.parameters.required).toEqual(data.del.required);
    expect(
      (del.parameters.properties as Record<string, any>).value,
    ).toBeUndefined();
  });

  it('没有表单配置钩子（配置来自模型调用参数）', () => {
    expect(variables.configureObject).toBeUndefined();
    expect(variables.configComponent).toBeUndefined();
  });
});

describe('variables client / get_variable', () => {
  it('应当返回当前历史变量里 JSON 化后的值', async () => {
    const data = await loadCases();
    const realm = await createRealm([data.histories.plain]);
    const [get] = await createTools(realm);

    const result = await get.invoke({
      args: { path: data.paths.hp },
      controller: new AbortController(),
    });

    expect(result).toBe(data.expected.hp);
  });

  it('应当带上本轮输出里还没落盘的变更', async () => {
    const data = await loadCases();
    const realm = await createRealm([data.histories.withOutputPatch]);
    const [get] = await createTools(realm);

    const result = await get.invoke({
      args: { path: data.paths.hp },
      controller: new AbortController(),
    });

    expect(result).toBe(data.expected.patchedHp);
  });

  it('输入里的变更也应当先应用', async () => {
    const data = await loadCases();
    const realm = await createRealm([data.histories.withPromptPatch]);
    const [get] = await createTools(realm);

    const result = await get.invoke({
      args: { path: data.paths.name },
      controller: new AbortController(),
    });

    expect(result).toBe(data.expected.patchedName);
  });

  it('路径不存在时应当返回提示', async () => {
    const data = await loadCases();
    const realm = await createRealm([data.histories.plain]);
    const [get] = await createTools(realm);

    const result = await get.invoke({
      args: { path: data.paths.missing },
      controller: new AbortController(),
    });

    expect(result).toBe(data.expected.notExists);
  });

  it('没有历史时应当返回提示', async () => {
    const data = await loadCases();
    const realm = await createRealm();
    const [get] = await createTools(realm);

    const result = await get.invoke({
      args: { path: data.paths.hp },
      controller: new AbortController(),
    });

    expect(result).toBe(data.expected.notExists);
  });
});

describe('variables client / set_variable 与 del_variable', () => {
  it('set 应当把 replace 操作记进本轮输出', async () => {
    const data = await loadCases();
    const realm = await createRealm([data.histories.pendingOutput]);
    const [, set] = await createTools(realm);

    const result = await set.invoke({
      args: data.patches.set,
      controller: new AbortController(),
    });

    expect(result).toBe(data.expected.success);
    expect(lastOutput(realm).variables).toEqual([
      { ...data.patches.set, op: 'replace' },
    ]);
  });

  it('set 缺少 value 时应当返回校验错误且不写入', async () => {
    const data = await loadCases();
    const realm = await createRealm([data.histories.pendingOutput]);
    const [, set] = await createTools(realm);

    const result = await set.invoke({
      args: { path: data.patches.set.path },
      controller: new AbortController(),
    });

    expect(result).toBe(data.expected.valueRequired);
    expect(lastOutput(realm).variables).toEqual([]);
  });

  it('del 应当把 remove 操作记进本轮输出', async () => {
    const data = await loadCases();
    const realm = await createRealm([data.histories.pendingOutput]);
    const [, , del] = await createTools(realm);

    const result = await del.invoke({
      args: data.patches.del,
      controller: new AbortController(),
    });

    expect(result).toBe(data.expected.success);
    expect(lastOutput(realm).variables).toEqual([
      { ...data.patches.del, op: 'remove' },
    ]);
  });

  it('del 缺少 path 时应当返回校验错误且不写入', async () => {
    const data = await loadCases();
    const realm = await createRealm([data.histories.pendingOutput]);
    const [, , del] = await createTools(realm);

    const result = await del.invoke({
      args: {},
      controller: new AbortController(),
    });

    expect(result).toBe(data.expected.pathRequired);
    expect(lastOutput(realm).variables).toEqual([]);
  });
});
