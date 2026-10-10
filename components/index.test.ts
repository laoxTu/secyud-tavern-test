import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  element,
  submitFormOnKey,
  submitTargetFormOnKey,
  translator,
} from '@/components';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

/** 造一个最小的键盘事件 */
function createEvent(overrides: Record<string, any> = {}) {
  return {
    ctrlKey: false,
    metaKey: false,
    code: '',
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as any;
}

function createTargetForm() {
  const requestSubmit = vi.fn();
  return {
    requestSubmit,
    currentTarget: { form: { requestSubmit } },
  };
}

describe('components / element', () => {
  it('没有组件时渲染 null', () => {
    expect(element(undefined, { a: 1 } as any)).toBeNull();
  });

  it('有组件时创建对应的 React 元素', async () => {
    const data = await loadCases();
    // 组件只能是函数/类，写在代码里；props 从 fixture 取
    const Component = (props: any) => React.createElement('div', props);

    const result = element(Component as any, data.props);

    expect(React.isValidElement(result)).toBe(true);
    expect((result as any).type).toBe(Component);
    expect((result as any).props).toEqual(data.props);
  });

  it('不传 props 时元素没有自定义属性', () => {
    const Component = (props: any) => React.createElement('div', props);

    const result = element(Component as any);

    expect((result as any).props).toEqual({});
  });
});

describe('components / submitTargetFormOnKey', () => {
  it('ctrl + Enter 应当阻止默认行为并提交表单', () => {
    const target = createTargetForm();

    submitTargetFormOnKey(createEvent({ ctrlKey: true, code: 'Enter', ...target }));

    expect(target.currentTarget.form.requestSubmit).toHaveBeenCalledTimes(1);
  });

  it('meta + KeyS 同样可以提交', () => {
    const target = createTargetForm();
    const event = createEvent({ metaKey: true, code: 'KeyS' });

    submitTargetFormOnKey(Object.assign(event, target));

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(target.currentTarget.form.requestSubmit).toHaveBeenCalledTimes(1);
  });

  it('没有修饰键或按键不匹配时什么都不做', async () => {
    const data = await loadCases();

    for (const item of data.keyCases) {
      const target = createTargetForm();
      const event = createEvent({ ...item, ...target });

      submitTargetFormOnKey(event);

      expect(event.preventDefault, item.name).not.toHaveBeenCalled();
      expect(event.stopPropagation, item.name).not.toHaveBeenCalled();
      expect(
        target.currentTarget.form.requestSubmit,
        item.name,
      ).not.toHaveBeenCalled();
    }
  });

  it('没有 currentTarget / form 时不应抛错', () => {
    expect(() =>
      submitTargetFormOnKey(createEvent({ ctrlKey: true, code: 'Enter' })),
    ).not.toThrow();
    expect(() =>
      submitTargetFormOnKey(
        createEvent({
          ctrlKey: true,
          code: 'Enter',
          currentTarget: { form: null },
        }),
      ),
    ).not.toThrow();
  });
});

describe('components / submitFormOnKey', () => {
  it('应当提交 ref 上的表单', () => {
    const requestSubmit = vi.fn();
    const event = createEvent({ ctrlKey: true, code: 'Enter' });

    submitFormOnKey(event, { current: { requestSubmit } } as any);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(requestSubmit).toHaveBeenCalledTimes(1);
  });

  it('ref 为空或按键不匹配时不应抛错也不提交', () => {
    const requestSubmit = vi.fn();

    expect(() =>
      submitFormOnKey(createEvent({ ctrlKey: true, code: 'Enter' }), {
        current: null,
      } as any),
    ).not.toThrow();
    expect(() =>
      submitFormOnKey(createEvent({ ctrlKey: true, code: 'KeyA' }), {
        current: { requestSubmit },
      } as any),
    ).not.toThrow();
    expect(requestSubmit).not.toHaveBeenCalled();
  });
});

describe('components / translator', () => {
  it('没有注入 t 时原样返回 message', () => {
    translator.t = undefined as any;

    expect(translator.translate('model.id')).toBe('model.id');
  });

  it('没有 data 时直接调 t', () => {
    const t: any = vi.fn((key: string) => `T:${key}`);
    t.has = () => false;
    translator.t = t;

    expect(translator.translate('model.id')).toBe('T:model.id');
    expect(t).toHaveBeenCalledWith('model.id');
  });

  it('data 里的字符串值会先按 key 翻译，非字符串原样保留', () => {
    const t: any = vi.fn((key: string, values?: any) =>
      values ? { key, values } : `T:${key}`,
    );
    t.has = (key: string) => key.startsWith('key.');
    translator.t = t;

    const result: any = translator.translate('message.delete', {
      target: 'key.story',
      raw: 'not.a.key',
      count: 3,
    });

    expect(result).toEqual({
      key: 'message.delete',
      values: {
        target: 'T:key.story',
        raw: 'not.a.key',
        count: 3,
      },
    });
  });

  it('翻译 data 时不应当改动调用方传进来的对象', () => {
    const t: any = vi.fn(() => 'ok');
    t.has = () => true;
    translator.t = t;
    const data = { target: 'key.story' };

    translator.translate('message.delete', data);

    expect(data.target).toBe('key.story');
  });
});
