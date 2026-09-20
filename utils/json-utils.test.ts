import { describe, expect, it } from 'vitest';

import { jsonUtils } from '@/utils/json';

// merge 的泛型由第一个参数推导，测试里会刻意为两边传入不同形状的对象，
// 所以统一显式指定为 any，避免泛型推断报错。
const merge = (lft: any, rht: any) => jsonUtils.merge<any>(lft, rht);

describe('merge / 空值边界', () => {
  it('两边都为空时返回新的空对象', () => {
    expect(merge(null, null)).toEqual({});
    expect(merge(undefined, undefined)).toEqual({});
    expect(merge(null, undefined)).toEqual({});
  });

  it('只有 lft 为空时返回 rht 的深拷贝', () => {
    const rht = { a: { b: 1 }, list: [1, 2] };
    const res = merge(null, rht);

    expect(res).toEqual(rht);
    // 是深拷贝：不是同一个引用，嵌套对象也不是
    expect(res).not.toBe(rht);
    expect(res.a).not.toBe(rht.a);
    expect(res.list).not.toBe(rht.list);

    // 修改结果不应影响源对象
    res.a.b = 99;
    res.list.push(3);
    expect(rht).toEqual({ a: { b: 1 }, list: [1, 2] });
  });

  it('rht 为空时直接返回 lft 本身', () => {
    const lft = { a: 1 };
    expect(merge(lft, null)).toBe(lft);
    expect(merge(lft, undefined)).toBe(lft);
    expect(lft).toEqual({ a: 1 });
  });

  it('rht 中的 null 和 undefined 会被跳过，而不是覆盖', () => {
    expect(merge({ a: 1, b: 2 }, { a: null, b: undefined })).toEqual({
      a: 1,
      b: 2,
    });

    // 目标没有该 key 时也不会被创建
    expect(merge({}, { a: null })).toEqual({});
  });

  it('rht 中其他假值应该正常覆盖', () => {
    const res = merge({ a: 1, b: 1, c: 1, d: 1 }, { a: 0, b: false, c: '' });
    expect(res.a).toBe(0);
    expect(res.b).toBe(false);
    expect(res.c).toBe('');
  });
});

describe('merge / 数组边界', () => {
  it('数组是整体替换，不会拼接', () => {
    expect(merge({ a: [1, 2] }, { a: [3] }).a).toEqual([3]);
  });

  it('数组应该是拷贝，不与 rht 共享引用', () => {
    const rht = { a: [1, 2] };
    const res = merge({ a: [9] }, rht);
    expect(res.a).toEqual([1, 2]);
    expect(res.a).not.toBe(rht.a);

    // 之后改 rht 不应影响结果
    rht.a.push(3);
    expect(res.a).toEqual([1, 2]);
  });

  it('对象与数组之间不递归，直接覆盖', () => {
    // lft 是对象、rht 是数组 -> 变成数组
    expect(merge({ a: { x: 1 } }, { a: [1, 2] }).a).toEqual([1, 2]);
    // lft 是数组、rht 是对象 -> 变成对象（不会合并进数组）
    expect(merge({ a: [1, 2] }, { a: { x: 1 } }).a).toEqual({ x: 1 });
  });

  it('只有 lft 为空时也会深拷贝数组', () => {
    const rht = { a: [1, 2] };
    const res = merge(null, rht);
    expect(res.a).toEqual([1, 2]);
    expect(res.a).not.toBe(rht.a);
  });
});

describe('merge / 嵌套对象', () => {
  it('两个普通对象应该递归深合并', () => {
    expect(merge({ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } })).toEqual({
      a: { x: 1, y: 3, z: 4 },
    });
  });

  it('应该支持多层嵌套合并', () => {
    expect(
      merge({ a: { b: { c: 1, keep: true } } }, { a: { b: { d: 2 } } }),
    ).toEqual({ a: { b: { c: 1, keep: true, d: 2 } } });
  });

  it('嵌套的 null 也会被跳过，保留 lft 的值', () => {
    expect(merge({ a: { x: 1, y: 2 } }, { a: { x: null, y: 3 } })).toEqual({
      a: { x: 1, y: 3 },
    });
  });

  it('lft 中不存在的嵌套对象应该是拷贝，不共享引用', () => {
    const rht = { a: { x: 1 } };
    const res = merge({ b: 1 }, rht);
    expect(res.a).toEqual({ x: 1 });
    expect(res.a).not.toBe(rht.a);
  });

  it('lft 中是原始值时被对象覆盖，且应该是拷贝', () => {
    const rht = { a: { x: 1 } };
    const res = merge({ a: 1 }, rht);
    expect(res.a).toEqual({ x: 1 });
    expect(res.a).not.toBe(rht.a);
  });
});

describe('merge / 原地修改', () => {
  it('返回的就是 lft 本身，并且原地被修改', () => {
    const lft: any = { a: { x: 1 } };
    const inner = lft.a;
    const res = merge(lft, { a: { y: 2 }, b: 3 });

    expect(res).toBe(lft);
    expect(lft).toEqual({ a: { x: 1, y: 2 }, b: 3 });
    // 嵌套合并也是原地进行，子对象引用不变
    expect(res.a).toBe(inner);
  });

  it('不会修改 rht', () => {
    const rht = { a: { y: 2 }, b: 3 };
    merge({ a: { x: 1 } }, rht);
    expect(rht).toEqual({ a: { y: 2 }, b: 3 });
  });

  it('应该新增 key 并保留原有 key', () => {
    expect(merge({ a: 1 }, { b: 2, c: 3 })).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('空对象合并互不影响', () => {
    const lft = { a: 1 };
    expect(merge(lft, {})).toBe(lft);
    expect(merge({}, { a: 1 })).toEqual({ a: 1 });
  });
});

// 【待修复】下面这组用例断言「合并结果与 rht 完全隔离」的期望语义。
// 当前实现只在 lft 为空时 structuredClone(rht)；其余情况只要某个子节点走「整体赋值」
// （result[key] = s，即该 key 在 lft 中缺失，或 lft 那边不是普通对象），这棵子树就直接是
// rht 的引用，于是之后修改 rht 会透传到结果、修改结果也会改到 rht。
// 所以这组用例目前是红的，等 merge 改成「整体赋值时也拷贝」后应该全部转绿。
describe('merge / 结果应与 rht 隔离【当前实现不满足，待修复】', () => {
  it('lft 中缺失的嵌套子树不应与 rht 共享引用', () => {
    const rht = { a: { b: { c: 1 } } };
    const res = merge({ a: {} }, rht);

    // a 两边都是对象 -> 递归合并；b 在 lft 中不存在 -> 整体赋值
    expect(res.a.b).toEqual({ c: 1 });
    expect(res.a.b).not.toBe(rht.a.b);
  });

  it('整体赋值的子树：之后改 rht 不应透传到结果', () => {
    const rht = { a: { b: { c: 1 } } };
    const res = merge({ a: {} }, rht);

    rht.a.b.c = 2;
    (rht.a.b as any).d = 3;
    expect(res.a.b).toEqual({ c: 1 });
  });

  it('整体赋值的子树：改结果不应影响 rht', () => {
    const rht = { a: { b: { c: 1 } } };
    const res = merge({ a: {} }, rht);

    res.a.b.c = 99;
    expect(rht.a.b.c).toBe(1);
  });

  it('共享子树里的数组也应该是拷贝', () => {
    const rht = { a: { list: [1] } };
    const res = merge({ a: {} }, rht);

    expect(res.a.list).toEqual([1]);
    expect(res.a.list).not.toBe(rht.a.list);

    rht.a.list.push(2);
    expect(res.a.list).toEqual([1]);
  });

  it('顶层缺失 key 的整棵子树都应该是拷贝', () => {
    const rht = { a: { b: { c: 1 } } };
    const res = merge({ x: 1 }, rht);

    expect(res.a).not.toBe(rht.a);
    rht.a.b.c = 2;
    expect(res.a.b.c).toBe(1);
  });

  it('整体改 rht 后结果应保持不变', () => {
    const rht: any = { a: { b: { c: 1 } }, list: [1, { x: 2 }] };
    const res = merge({ keep: 1 }, rht);

    rht.a.b.c = 99;
    rht.list.push(3);
    rht.list[1].x = 99;

    expect(res).toEqual({ keep: 1, a: { b: { c: 1 } }, list: [1, { x: 2 }] });
  });
});

// 以下两条是修复前后都应该通过的对照：这两条路径本来就不共享。
describe('merge / rht 隔离的对照用例', () => {
  it('被递归合并的分支不共享，改 rht 不影响结果', () => {
    const rht = { a: { x: { deep: 1 } } };
    const res = merge({ a: { x: { deep: 0 } } }, rht);

    // x 两边都是对象 -> 递归合并进 lft 自己的对象，rht 的值被复制进来
    expect(res.a.x).not.toBe(rht.a.x);
    expect(res.a.x.deep).toBe(1);

    // deep 是原始值，已经被复制，之后改 rht 不会透传
    rht.a.x.deep = 99;
    expect(res.a.x.deep).toBe(1);
  });

  it('lft 为空时是深拷贝，不受 rht 后续修改影响', () => {
    const rht = { a: { b: { c: 1 } } };
    const res = merge(null, rht);

    rht.a.b.c = 2;
    expect(res.a.b.c).toBe(1);
  });
});
