import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessError, checker, errors } from '@/interceptors';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

/** 断言同步调用抛出的是带指定 code / data 的 BusinessError */
function catchBusinessError(
  action: () => unknown,
  expected: { code: string; data: Record<string, any> },
) {
  let thrown: unknown;
  try {
    action();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(BusinessError);
  const error = thrown as BusinessError;
  expect(error.code).toBe(expected.code);
  expect(error.data).toEqual(expected.data);
  return error;
}

beforeEach(() => {
  // jsonUtils.parse 失败时会 console.warn，用例里静音
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('interceptors / BusinessError', () => {
  it('应当保留 message / code / innerError / status，status 默认 500', async () => {
    const data = await loadCases();
    const inner = new Error(data.businessError.innerMessage);

    const error = new BusinessError(
      data.businessError.message,
      data.businessError.code,
      inner,
      data.businessError.status,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(data.businessError.message);
    expect(error.code).toBe(data.businessError.code);
    expect(error.innerError).toBe(inner);
    expect(error.status).toBe(data.businessError.status);
    expect(error.data).toEqual({});

    const fallback = new BusinessError(data.businessError.message);
    expect(fallback.status).toBe(500);
    expect(fallback.code).toBeUndefined();
    expect(fallback.innerError).toBeUndefined();
  });

  it('withValue 应当写入 data 并返回自身以支持链式调用', async () => {
    const data = await loadCases();
    const error = new BusinessError(data.businessError.message);

    const returned = error
      .withValue('entity', data.businessError.values.entity)
      .withValue('value', data.businessError.values.value);

    expect(returned).toBe(error);
    expect(error.data).toEqual({
      entity: data.businessError.values.entity,
      value: data.businessError.values.value,
    });
  });

  it('withValues 应当深度合并对象，后者覆盖同名叶子并跳过 null', async () => {
    const data = await loadCases();
    const error = new BusinessError(data.businessError.message);

    const returned = error
      .withValues(data.businessError.deepValues)
      .withValues(data.businessError.deepPatch);

    expect(returned).toBe(error);
    expect(error.data).toEqual(data.businessError.deepResult);
    expect(error.data.skipNull).toBeUndefined();
  });

  it('withValues 的数组应当克隆一份，不与入参共享引用', async () => {
    const data = await loadCases();
    const source = data.businessError.arrayValue;
    const expected = [...source.tags];
    const error = new BusinessError(data.businessError.message).withValues(
      source,
    );

    expect(error.data.tags).toEqual(expected);
    expect(error.data.tags).not.toBe(source.tags);

    source.tags.push('mutated');
    expect(error.data.tags).toEqual(expected);
  });
});

describe('interceptors / checker.validateCode', () => {
  it('合法 code 应当原样返回', async () => {
    const data = await loadCases();

    for (const value of data.checker.code.valid) {
      expect(
        checker.validateCode(data.checker.field, value, data.checker.namespace),
      ).toBe(value);
    }
  });

  it('非法 code 应当抛 error.invalid_code，并把命名空间拼进 field', async () => {
    const data = await loadCases();

    for (const value of data.checker.code.invalid) {
      const error = catchBusinessError(
        () =>
          checker.validateCode(
            data.checker.field,
            value,
            data.checker.namespace,
          ),
        {
          code: data.checker.code.errorCode,
          data: { field: data.checker.scopedField },
        },
      );
      expect(error.message).toBe(data.checker.code.message);
    }

    // 不传命名空间时回落 default
    catchBusinessError(() => checker.validateCode(data.checker.field, 'a-b'), {
      code: data.checker.code.errorCode,
      data: { field: data.checker.defaultField },
    });
  });
});

describe('interceptors / checker.duplicate', () => {
  it('不存在时应当返回 false', async () => {
    const data = await loadCases();

    expect(
      checker.duplicate(
        false,
        data.checker.duplicate.entity,
        data.checker.duplicate.name,
        data.checker.duplicate.value,
      ),
    ).toBe(false);
  });

  it('已存在时应当抛 error.entity.duplicate_value 并带上 entity/name/value', async () => {
    const data = await loadCases();

    const error = catchBusinessError(
      () =>
        checker.duplicate(
          true,
          data.checker.duplicate.entity,
          data.checker.duplicate.name,
          data.checker.duplicate.value,
        ),
      {
        code: data.checker.duplicate.errorCode,
        data: {
          entity: data.checker.duplicate.entity,
          name: data.checker.duplicate.name,
          value: data.checker.duplicate.value,
        },
      },
    );

    expect(error.message).toBe(data.checker.duplicate.message);
  });
});

describe('interceptors / checker.notNullOrEmpty', () => {
  it('有值时应当原样返回', async () => {
    const data = await loadCases();

    for (const value of data.checker.notNullOrEmpty.valid) {
      expect(
        checker.notNullOrEmpty(
          data.checker.field,
          value,
          data.checker.namespace,
        ),
      ).toBe(value);
    }
  });

  it('空串 / null / undefined 都应当抛 error.empty_field', async () => {
    const data = await loadCases();
    const cases = [...data.checker.notNullOrEmpty.invalid, undefined];

    for (const value of cases) {
      const error = catchBusinessError(
        () =>
          checker.notNullOrEmpty(
            data.checker.field,
            value,
            data.checker.namespace,
          ),
        {
          code: data.checker.emptyFieldCode,
          data: { field: data.checker.scopedField },
        },
      );
      expect(error.message).toBe(data.checker.emptyFieldMessage);
    }
  });
});

describe('interceptors / checker.notNullOrWhitespace', () => {
  it('非空白应当原样返回，且不做 trim', async () => {
    const data = await loadCases();

    for (const value of data.checker.notNullOrWhitespace.valid) {
      expect(
        checker.notNullOrWhitespace(
          data.checker.field,
          value,
          data.checker.namespace,
        ),
      ).toBe(value);
    }
  });

  it('空串 / 纯空白 / null / undefined 都应当抛 error.empty_field', async () => {
    const data = await loadCases();
    const cases = [...data.checker.notNullOrWhitespace.invalid, undefined];

    for (const value of cases) {
      catchBusinessError(
        () =>
          checker.notNullOrWhitespace(
            data.checker.field,
            value,
            data.checker.namespace,
          ),
        {
          code: data.checker.emptyFieldCode,
          data: { field: data.checker.scopedField },
        },
      );
    }
  });
});

describe('interceptors / checker.notEmpty', () => {
  it('只要不是空串就原样返回，null 与 undefined 也通过', async () => {
    const data = await loadCases();
    const cases = [...data.checker.notEmpty.valid, undefined];

    for (const value of cases) {
      expect(
        checker.notEmpty(data.checker.field, value, data.checker.namespace),
      ).toBe(value);
    }
  });

  it('空串应当抛 error.empty_field', async () => {
    const data = await loadCases();

    for (const value of data.checker.notEmpty.invalid) {
      catchBusinessError(
        () =>
          checker.notEmpty(data.checker.field, value, data.checker.namespace),
        {
          code: data.checker.emptyFieldCode,
          data: { field: data.checker.scopedField },
        },
      );
    }
  });
});

describe('interceptors / checker.notWhitespace', () => {
  it('非纯空白应当原样返回', async () => {
    const data = await loadCases();

    for (const value of data.checker.notWhitespace.valid) {
      expect(
        checker.notWhitespace(
          data.checker.field,
          value,
          data.checker.namespace,
        ),
      ).toBe(value);
    }
  });

  it('空串与纯空白应当抛 error.empty_field', async () => {
    const data = await loadCases();

    for (const value of data.checker.notWhitespace.invalid) {
      catchBusinessError(
        () =>
          checker.notWhitespace(
            data.checker.field,
            value,
            data.checker.namespace,
          ),
        {
          code: data.checker.emptyFieldCode,
          data: { field: data.checker.scopedField },
        },
      );
    }
  });

  it('undefined 与 null 不抛错（与 notNullOrWhitespace 的差异）', async () => {
    const data = await loadCases();

    // 当前实现是 `value?.trim() !== ''`：undefined/null 让该表达式为 true，于是原样返回
    expect(
      checker.notWhitespace(
        data.checker.field,
        undefined,
        data.checker.namespace,
      ),
    ).toBeUndefined();
    expect(
      checker.notWhitespace(data.checker.field, null, data.checker.namespace),
    ).toBeNull();
  });
});

describe('interceptors / checker.validJson', () => {
  it('合法 json 应当原样返回字符串', async () => {
    const data = await loadCases();

    for (const value of data.checker.json.valid) {
      expect(checker.validJson(value, data.checker.json.name)).toBe(value);
    }
  });

  it('空值或非法 json 应当抛 error.json_invalid 并带 target', async () => {
    const data = await loadCases();

    for (const value of data.checker.json.invalid) {
      const error = catchBusinessError(
        () => checker.validJson(value, data.checker.json.name),
        {
          code: data.checker.json.errorCode,
          data: { target: data.checker.json.name },
        },
      );
      expect(error.message).toBe(data.checker.json.message);
    }

    // 不传 name 时回落 default.field
    catchBusinessError(() => checker.validJson('abc'), {
      code: data.checker.json.errorCode,
      data: { target: 'default.field' },
    });
  });
});

describe('interceptors / checker.validJsonOrEmpty', () => {
  it('空值应当放过：null / undefined 回落空串，纯空白原样返回', async () => {
    const data = await loadCases();

    expect(checker.validJsonOrEmpty(undefined, data.checker.json.name)).toBe(
      '',
    );
    expect(checker.validJsonOrEmpty(null, data.checker.json.name)).toBe('');
    expect(checker.validJsonOrEmpty('', data.checker.json.name)).toBe('');
    expect(checker.validJsonOrEmpty('   ', data.checker.json.name)).toBe('   ');
  });

  it('合法 json 应当原样返回字符串', async () => {
    const data = await loadCases();

    for (const value of data.checker.json.valid) {
      expect(checker.validJsonOrEmpty(value, data.checker.json.name)).toBe(
        value,
      );
    }
  });

  it('有内容但非法 json 应当抛 error.json_invalid', async () => {
    const data = await loadCases();

    for (const value of ['abc', '{']) {
      catchBusinessError(
        () => checker.validJsonOrEmpty(value, data.checker.json.name),
        {
          code: data.checker.json.errorCode,
          data: { target: data.checker.json.name },
        },
      );
    }
  });
});

describe('interceptors / checker.notNullEntity', () => {
  it('实体存在时应当原样返回', async () => {
    const data = await loadCases();

    expect(
      checker.notNullEntity(
        data.checker.entity.id,
        data.checker.entity.valid,
        data.checker.entity.target,
      ),
    ).toBe(data.checker.entity.valid);
  });

  it('实体为空时应当抛 default.entity_not_found 并带 id/target', async () => {
    const data = await loadCases();

    for (const entity of [null, undefined]) {
      const error = catchBusinessError(
        () =>
          checker.notNullEntity(
            data.checker.entity.id,
            entity,
            data.checker.entity.target,
          ),
        {
          code: data.checker.entity.errorCode,
          data: {
            id: data.checker.entity.id,
            target: data.checker.entity.target,
          },
        },
      );
      expect(error.message).toBe(data.checker.entity.message);
    }

    // 不传 target 时回落 default.target
    catchBusinessError(
      () => checker.notNullEntity(data.checker.entity.id, null),
      {
        code: data.checker.entity.errorCode,
        data: { id: data.checker.entity.id, target: 'default.target' },
      },
    );
  });
});

describe('interceptors / errors.serialize', () => {
  it('BusinessError 应当序列化 name/message/stack/data/code 与裁剪后的 inner', async () => {
    const data = await loadCases();
    const inner = new Error(data.serialize.innerMessage);
    (inner as any).data = { secret: data.serialize.innerNoise };
    const error = new BusinessError(
      data.serialize.message,
      data.serialize.code,
      inner,
    ).withValues(data.serialize.data);

    const parsed = JSON.parse(errors.serialize(error));

    expect(parsed.name).toBe('Error');
    expect(parsed.message).toBe(data.serialize.message);
    expect(typeof parsed.stack).toBe('string');
    expect(parsed.data).toEqual(data.serialize.data);
    expect(parsed.code).toBe(data.serialize.code);
    // inner 只留 name/message/stack，inner 自己的 data 被裁掉
    expect(Object.keys(parsed.inner).sort()).toEqual([
      'message',
      'name',
      'stack',
    ]);
    expect(parsed.inner.message).toBe(data.serialize.innerMessage);
    expect(Object.keys(parsed).sort()).toEqual([
      'code',
      'data',
      'inner',
      'message',
      'name',
      'stack',
    ]);
  });

  it('缺少 code 或 innerError 时应当省略对应字段', async () => {
    const data = await loadCases();

    const withoutCode = JSON.parse(
      errors.serialize(new BusinessError(data.serialize.message)),
    );
    expect(Object.keys(withoutCode).sort()).toEqual([
      'data',
      'message',
      'name',
      'stack',
    ]);

    const withCode = JSON.parse(
      errors.serialize(
        new BusinessError(data.serialize.message, data.serialize.code),
      ),
    );
    expect(Object.keys(withCode).sort()).toEqual([
      'code',
      'data',
      'message',
      'name',
      'stack',
    ]);
  });

  it('普通 Error 只应当序列化 name/message/stack', async () => {
    const data = await loadCases();

    const parsed = JSON.parse(
      errors.serialize(new Error(data.serialize.plainMessage)),
    );

    expect(parsed.name).toBe('Error');
    expect(parsed.message).toBe(data.serialize.plainMessage);
    expect(typeof parsed.stack).toBe('string');
    expect(Object.keys(parsed).sort()).toEqual(['message', 'name', 'stack']);
  });

  it('非 Error 抛出应当退化成 String()，不是 json', async () => {
    const data = await loadCases();

    expect(errors.serialize(data.serialize.nonError.string)).toBe(
      data.serialize.nonError.string,
    );
    expect(errors.serialize(data.serialize.nonError.number)).toBe(
      String(data.serialize.nonError.number),
    );
    expect(errors.serialize(null)).toBe('null');
    expect(errors.serialize({ a: 1 })).toBe('[object Object]');
  });
});
