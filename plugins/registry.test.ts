import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Registry, type Registerable } from '@/plugins';

interface Item extends Registerable {
  label?: string;
}

// sortByRequires 是 protected，测试里用子类暴露出来直接测排序，绕开 sorted() 的缓存
class TestRegistry extends Registry<Item> {
  sort(): Item[] {
    return this.sortByRequires();
  }
}

const ids = (items: Item[]) => items.map((u) => u.id);

function setup(...items: Item[]) {
  const registry = new TestRegistry('test');
  registry.register(...items);
  return registry;
}

// 排序和注册都会 console.debug，测试时静音
beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function catchError(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected to throw, but it did not.');
}

describe('Registry.sortByRequires / 拓扑序', () => {
  it('依赖应该排在被依赖者之后（链式，且与注册顺序无关）', () => {
    // 故意倒序注册：c -> b -> a
    const registry = setup(
      { id: 'c', requires: ['b'] },
      { id: 'b', requires: ['a'] },
      { id: 'a' },
    );

    expect(ids(registry.sort())).toEqual(['a', 'b', 'c']);
  });

  it('没有依赖时按 sequence 升序排列', () => {
    const registry = setup(
      { id: 'a', sequence: 3 },
      { id: 'b', sequence: 1 },
      { id: 'c' }, // 没有 sequence，按 0 处理
    );

    expect(ids(registry.sort())).toEqual(['c', 'b', 'a']);
  });

  it('多个前置依赖（菱形）应该满足所有偏序关系', () => {
    const registry = setup(
      { id: 'd', requires: ['b', 'c'] },
      { id: 'b', requires: ['a'] },
      { id: 'c', requires: ['a'] },
      { id: 'a' },
    );

    const order = ids(registry.sort());
    expect(order).toHaveLength(4);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
  });

  it('sequence 决定同层依赖者的先后', () => {
    const registry = setup(
      { id: 'b', requires: ['a'], sequence: 2 },
      { id: 'c', requires: ['a'], sequence: 1 },
      { id: 'a' },
    );

    expect(ids(registry.sort())).toEqual(['a', 'c', 'b']);
  });
});

describe('Registry.sortByRequires / 循环依赖', () => {
  it('相互依赖应该抛错并列出环上的节点', () => {
    const registry = setup(
      { id: 'a', requires: ['b'] },
      { id: 'b', requires: ['a'] },
    );

    expect(catchError(() => registry.sort()).message).toBe(
      '[Sort Error] Circular dependency detected involving: a, b',
    );
  });

  it('自依赖算循环依赖', () => {
    const registry = setup({ id: 'a', requires: ['a'] });

    expect(catchError(() => registry.sort()).message).toBe(
      '[Sort Error] Circular dependency detected involving: a',
    );
  });

  it('只列出环上（没被访问到）的节点，无关节点不受影响', () => {
    const registry = setup(
      { id: 'x' },
      { id: 'a', requires: ['b'] },
      { id: 'b', requires: ['a'] },
    );

    // x 无依赖会先排出来，所以报错里只有 a、b
    expect(catchError(() => registry.sort()).message).toBe(
      '[Sort Error] Circular dependency detected involving: a, b',
    );
  });

  it('三节点环应该被检测到', () => {
    const registry = setup(
      { id: 'a', requires: ['c'] },
      { id: 'b', requires: ['a'] },
      { id: 'c', requires: ['b'] },
    );

    expect(catchError(() => registry.sort()).message).toBe(
      '[Sort Error] Circular dependency detected involving: a, b, c',
    );
  });

  it('环下游的节点也会被一起列出', () => {
    const registry = setup(
      { id: 'a', requires: ['b'] },
      { id: 'b', requires: ['a'] },
      { id: 'c', requires: ['a'] },
    );

    expect(catchError(() => registry.sort()).message).toBe(
      '[Sort Error] Circular dependency detected involving: a, b, c',
    );
  });
});

describe('Registry.sortByRequires / 缺失依赖', () => {
  it('依赖不存在的组件应该抛错', () => {
    const registry = setup({ id: 'a' }, { id: 'b', requires: ['nope'] });

    expect(catchError(() => registry.sort()).message).toBe(
      '[Sort Error] Component "b" depends on non-existent component "nope".',
    );
  });

  it('多个缺失依赖时按 sequence 顺序抛出第一个', () => {
    const registry = setup(
      { id: 'x', requires: ['badX'], sequence: 2 },
      { id: 'y', requires: ['badY'], sequence: 1 },
    );

    expect(catchError(() => registry.sort()).message).toBe(
      '[Sort Error] Component "y" depends on non-existent component "badY".',
    );
  });

  it('缺失依赖优先于循环依赖报错', () => {
    // a 和 b 互为依赖构成环，但 b 还有一个不存在的依赖
    const registry = setup(
      { id: 'a', requires: ['b'] },
      { id: 'b', requires: ['a', 'nope'] },
    );

    expect(catchError(() => registry.sort()).message).toBe(
      '[Sort Error] Component "b" depends on non-existent component "nope".',
    );
  });
});

describe('Registry.sorted / 缓存', () => {
  it('重复调用返回同一份缓存', () => {
    const registry = setup({ id: 'a' });
    const first = registry.sorted();

    expect(registry.sorted()).toBe(first);
  });

  it('register 会让缓存失效', () => {
    const registry = setup({ id: 'a' });
    const first = registry.sorted();

    registry.register({ id: 'b' });
    const second = registry.sorted();

    expect(second).not.toBe(first);
    expect(ids(second)).toEqual(['a', 'b']);
  });

  it('unregister 会让缓存失效，并返回是否删除成功', () => {
    const registry = setup({ id: 'a' }, { id: 'b' });
    expect(ids(registry.sorted())).toEqual(['a', 'b']);

    expect(registry.unregister('a')).toBe(true);
    expect(registry.unregister('a')).toBe(false);
    expect(ids(registry.sorted())).toEqual(['b']);
  });

  it('抛错不会污染缓存，修好后可以正常排序', () => {
    const registry = setup(
      { id: 'a', requires: ['b'] },
      { id: 'b', requires: ['a'] },
    );

    expect(() => registry.sorted()).toThrow(/Circular dependency/);
    expect(() => registry.sorted()).toThrow(/Circular dependency/);

    // 覆盖 a 去掉依赖即可正常排序
    registry.register({ id: 'a' });
    expect(ids(registry.sorted())).toEqual(['a', 'b']);
  });
});
