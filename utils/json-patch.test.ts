import { describe, expect, it } from 'vitest';

import {
  extract,
  patch,
  patchOne,
  validate,
  type Operation,
} from '@/utils/json-patch';

describe('validate', () => {
  it('非对象输入应该报错', () => {
    expect(validate(null)).toBe('input is not a json object.');
    expect(validate(1)).toBe('input is not a json object.');
    expect(validate([])).toBe('input is not a json object.');
  });

  it('缺少 op 或 path 应该报错', () => {
    expect(validate({})).toBe('op or path is not provided.');
    expect(validate({ op: 'add' })).toBe('op or path is not provided.');
    expect(validate({ path: '/a' })).toBe('op or path is not provided.');
  });

  it('add/replace/test 缺少 value 应该报错', () => {
    expect(validate({ op: 'add', path: '/a' })).toBe('value is not provided.');
    expect(validate({ op: 'replace', path: '/a' })).toBe(
      'value is not provided.',
    );
    expect(validate({ op: 'test', path: '/a' })).toBe('value is not provided.');
    expect(validate({ op: 'add', path: '/a', value: undefined })).toBe(
      'value is not provided.',
    );
  });

  it('move/copy 缺少 from 应该报错', () => {
    expect(validate({ op: 'move', path: '/a' })).toBe('from is not provided.');
    expect(validate({ op: 'copy', path: '/a' })).toBe('from is not provided.');
  });

  it('未知 op 应该报错', () => {
    expect(validate({ op: 'foo', path: '/a' })).toBe('op is invalid value.');
  });

  it('合法的操作应该返回 null', () => {
    expect(validate({ op: 'add', path: '/a', value: 1 })).toBeNull();
    expect(validate({ op: 'remove', path: '/a' })).toBeNull();
    expect(validate({ op: 'move', path: '/a', from: '/b' })).toBeNull();
    expect(validate({ op: 'copy', path: '/a', from: '/b' })).toBeNull();
  });
});

describe('extract', () => {
  it('应该定位到路径对应的节点', () => {
    const obj = { a: { b: 1 } };
    const result = extract(obj, '/a/b');
    expect(result.exists).toBe(true);
    expect(result.current.item).toBe(1);
    expect(result.previous.item).toBe(obj.a);
  });

  it('路径不存在时 exists 为 false', () => {
    expect(extract({ a: 1 }, '/a/b').exists).toBe(false);
    expect(extract({ a: 1 }, '/x').exists).toBe(false);
  });

  it('create=true 时应该补建缺失的中间对象', () => {
    const obj: any = {};
    const result = extract(obj, '/a/b', true);
    expect(obj).toEqual({ a: {} });
    expect(result.exists).toBe(false);
  });

  it('应该解码 ~1 和 ~0', () => {
    expect(extract({ 'a/b': 1 }, '/a~1b').current.item).toBe(1);
    expect(extract({ 'a~b': 2 }, '/a~0b').current.item).toBe(2);
  });

  it('obj 无效时应该抛错', () => {
    expect(() => extract(null, '/a')).toThrow('[json patch](error)');
  });
});

describe('patchOne/add', () => {
  it('给不存在的 key 赋值', () => {
    const obj: any = {};
    expect(patchOne(obj, { op: 'add', path: '/a', value: 1 })).toBe(true);
    expect(obj).toEqual({ a: 1 });
  });

  it('目标不是对象时直接覆盖', () => {
    const obj: any = { a: 1 };
    patchOne(obj, { op: 'add', path: '/a', value: 2 });
    expect(obj).toEqual({ a: 2 });
  });

  it('目标是数组时追加', () => {
    const obj: any = { a: [1] };
    patchOne(obj, { op: 'add', path: '/a', value: 2 });
    expect(obj.a).toEqual([1, 2]);
  });

  it('目标是对象时展开合并', () => {
    const obj: any = { a: { x: 1 } };
    patchOne(obj, { op: 'add', path: '/a', value: { y: 2 } });
    expect(obj.a).toEqual({ x: 1, y: 2 });
  });

  it('自动补建中间对象', () => {
    const obj: any = {};
    patchOne(obj, { op: 'add', path: '/a/b', value: 1 });
    expect(obj).toEqual({ a: { b: 1 } });
  });
});

describe('patchOne/replace', () => {
  it('普通对象属性应该被替换', () => {
    const obj: any = { a: 1 };
    expect(patchOne(obj, { op: 'replace', path: '/a', value: 2 })).toBe(true);
    expect(obj.a).toBe(2);
  });

  it('不存在的属性应该被创建', () => {
    const obj: any = {};
    patchOne(obj, { op: 'replace', path: '/a', value: 1 });
    expect(obj).toEqual({ a: 1 });
  });

  it('数组下标应该被替换', () => {
    const obj: any = [1, 2, 3];
    patchOne(obj, { op: 'replace', path: '/1', value: 9 });
    expect(obj).toEqual([1, 9, 3]);
  });

  it('数组下标越界时追加', () => {
    const obj: any = [1, 2, 3];
    patchOne(obj, { op: 'replace', path: '/3', value: 4 });
    expect(obj).toEqual([1, 2, 3, 4]);
  });

  it('数组的非数字 key 应该失败', () => {
    const obj: any = [1, 2];
    expect(patchOne(obj, { op: 'replace', path: '/x', value: 9 })).toBe(false);
    expect(obj).toEqual([1, 2]);
  });
});

describe('patchOne/remove', () => {
  it('应该删除存在的属性', () => {
    const obj: any = { a: 1, b: 2 };
    expect(patchOne(obj, { op: 'remove', path: '/a' })).toBe(true);
    expect(obj).toEqual({ b: 2 });
  });

  it('路径不存在时不报错也不修改', () => {
    const obj: any = { a: 1 };
    expect(patchOne(obj, { op: 'remove', path: '/x/y' })).toBe(true);
    expect(obj).toEqual({ a: 1 });
  });
});

describe('patchOne/move和copy', () => {
  it('move 应该移动值', () => {
    const obj: any = { a: 1, b: 2 };
    expect(patchOne(obj, { op: 'move', from: '/a', path: '/c' })).toBe(true);
    expect(obj).toEqual({ b: 2, c: 1 });
  });

  it('move 源不存在时应该失败', () => {
    const obj: any = { a: 1 };
    expect(patchOne(obj, { op: 'move', from: '/x', path: '/c' })).toBe(false);
    expect(obj).toEqual({ a: 1 });
  });

  it('copy 应该复制值', () => {
    const obj: any = { a: 1 };
    expect(patchOne(obj, { op: 'copy', from: '/a', path: '/b' })).toBe(true);
    expect(obj).toEqual({ a: 1, b: 1 });
  });

  it('copy 源不存在时应该失败', () => {
    const obj: any = { a: 1 };
    expect(patchOne(obj, { op: 'copy', from: '/x', path: '/b' })).toBe(false);
    expect(obj).toEqual({ a: 1 });
  });
});

describe('patchOne/test', () => {
  it('值相同时返回 true', () => {
    expect(patchOne({ a: 1 }, { op: 'test', path: '/a', value: 1 })).toBe(true);
  });

  it('值不同或不存在时返回 false', () => {
    expect(patchOne({ a: 1 }, { op: 'test', path: '/a', value: 2 })).toBe(false);
    expect(patchOne({ a: 1 }, { op: 'test', path: '/x', value: 1 })).toBe(false);
  });
});

describe('patchOne/未知op', () => {
  it('应该返回 false', () => {
    const obj: any = { a: 1 };
    expect(patchOne(obj, { op: 'foo', path: '/a' } as any)).toBe(false);
    expect(obj).toEqual({ a: 1 });
  });
});

describe('patch', () => {
  it('没有变更时返回空数组', () => {
    expect(patch({ a: 1 })).toEqual([]);
    expect(patch({ a: 1 }, [])).toEqual([]);
  });

  it('应该按顺序执行并返回每一步结果', () => {
    const obj: any = { a: 1 };
    const changes: Operation[] = [
      { op: 'add', path: '/b', value: 2 },
      { op: 'remove', path: '/a' },
    ];
    expect(patch(obj, changes)).toEqual([
      { success: true },
      { success: true },
    ]);
    expect(obj).toEqual({ b: 2 });
  });

  it('单个操作失败不影响其他操作', () => {
    const obj: any = { a: 1 };
    const result = patch(obj, [
      { op: 'copy', from: '/x', path: '/y' },
      { op: 'add', path: '/c', value: 3 },
    ]);
    expect(result).toEqual([{ success: false }, { success: true }]);
    expect(obj).toEqual({ a: 1, c: 3 });
  });
});
