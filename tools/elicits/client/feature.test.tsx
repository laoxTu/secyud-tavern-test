import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const controls: Record<string, any[]> = {};
  return {
    controls,
    actions: [] as any[],
    /** 收集桩控件的 props，同时把 children 透传下去 */
    record(tag: string, props: any) {
      (controls[tag] ??= []).push(props);
      return props?.children ?? null;
    },
    reply: vi.fn(),
  };
});

/**
 * 真实 `@/components` 桶会把 monaco 一起拉起来，jsdom 下很重；
 * 这里只保留弹窗骨架并把 props 记下来，用来断言「问题 / 候选项 / 自定义输入」的渲染契约。
 * DialogContent 的 render 属性（表单）在创建元素时就会调用 handler，所以提交逻辑照样能驱动。
 */
vi.mock('@/components', () => ({
  Button: (props: any) => mocks.record('Button', props),
  Dialog: (props: any) => mocks.record('Dialog', props),
  DialogContent: (props: any) => mocks.record('DialogContent', props),
  DialogDescription: (props: any) => mocks.record('DialogDescription', props),
  DialogFooter: (props: any) => mocks.record('DialogFooter', props),
  DialogHeader: (props: any) => mocks.record('DialogHeader', props),
  DialogTitle: (props: any) => mocks.record('DialogTitle', props),
  Input: (props: any) => mocks.record('Input', props),
  Label: (props: any) => mocks.record('Label', props),
  RadioGroup: (props: any) => mocks.record('RadioGroup', props),
  RadioGroupItem: (props: any) => mocks.record('RadioGroupItem', props),
}));

/** handler 只用来拿到表单回调，不跑真实的错误处理 */
vi.mock('@/interceptors/client', () => ({
  handler: (fn: any) => {
    mocks.actions.push(fn);
    return fn;
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { feature } from '@/tools/elicits/client/feature';
import { useElicitState } from '@/tools/elicits/client/states';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./feature.cases.json')).default);
}

function toFormData(fields: Record<string, any> = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, `${value}`);
  }
  return form;
}

/** 把一项推进状态机并渲染弹窗，返回最近一次注册的表单回调 */
async function setup(index: number, fields: Record<string, any> = {}) {
  const data = await loadCases();
  const item = { ...data.items[index], reply: mocks.reply };
  useElicitState.getState().push(item);

  render(<feature.component />);

  return { data, item, form: toFormData(fields), action: mocks.actions.at(-1)! };
}

/** 表单提交会改状态机，包在 act 里避免 React 的 act 警告 */
async function submit(action: any, form: FormData) {
  await act(async () => {
    await action(form);
  });
}

function controlProps(tag: string) {
  return mocks.controls[tag]?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actions.length = 0;
  for (const key of Object.keys(mocks.controls)) delete mocks.controls[key];
  useElicitState.setState({ render: 0, items: [], item: null });
});

describe('tools elicits feature / 注册契约', () => {
  it('应当以 elicit 为 id 注册弹窗组件', () => {
    expect(feature.id).toBe('elicit');
    expect(Object.keys(feature).sort()).toEqual(['component', 'id']);
    expect(typeof feature.component).toBe('function');
  });
});

describe('tools elicits feature / 渲染', () => {
  it('没有待回答的问题时不打开弹窗，也不渲染内容', () => {
    render(<feature.component />);

    expect(controlProps('Dialog').open).toBe(false);
    expect(mocks.controls.DialogTitle).toBeUndefined();
    expect(mocks.controls.RadioGroupItem).toBeUndefined();
  });

  it('有问题时展示问题、候选项与自定义输入框', async () => {
    const { item } = await setup(0);

    expect(controlProps('Dialog').open).toBe(true);
    expect(controlProps('DialogTitle').children).toBe('elicit.title');
    expect(controlProps('DialogDescription').children).toBe(item.question);
    // 每个候选一个单选框，custom 为真时再多一个自定义项
    expect(mocks.controls.RadioGroupItem.map((u) => u.value)).toEqual([
      0,
      1,
      2,
      'custom',
    ]);
    expect(mocks.controls.Label.map((u) => u.children)).toEqual(item.examples);
    expect(controlProps('RadioGroup').name).toBe('elicit');
    expect(controlProps('RadioGroup').defaultValue).toBe(0);
    expect(controlProps('Input').name).toBe('custom');
    expect(controlProps('Input').placeholder).toBe('elicit.custom.placeholder');
    expect(controlProps('Button').type).toBe('submit');
  });

  it('custom 为假时不渲染自定义输入框', async () => {
    await setup(1);

    expect(mocks.controls.RadioGroupItem.map((u) => u.value)).toEqual([0, 1]);
    expect(controlProps('Input')).toBeUndefined();
  });

  it('没有候选项时只有自定义输入框', async () => {
    await setup(2);

    expect(mocks.controls.RadioGroupItem.map((u) => u.value)).toEqual([
      'custom',
    ]);
    expect(mocks.controls.Label).toBeUndefined();
  });
});

describe('tools elicits feature / 提交', () => {
  it('选中候选项时把对应文本回给工具并弹出当前项', async () => {
    const { data, item, form, action } = await setup(0, { elicit: '1' });

    await submit(action, form);

    expect(mocks.reply).toHaveBeenCalledTimes(1);
    expect(mocks.reply).toHaveBeenCalledWith(item.examples[1]);
    expect(useElicitState.getState().item).toBeNull();
    expect(useElicitState.getState().render).toBe(2);
    // 例子来自 fixture，顺带确认不是下标写错
    expect(item.examples[1]).toBe(data.items[0].examples[1]);
  });

  it('选中自定义项时回填输入框里的文本', async () => {
    const data = await loadCases();
    useElicitState.getState().push({ ...data.items[0], reply: mocks.reply });
    render(<feature.component />);
    const action = mocks.actions.at(-1)!;

    await submit(
      action,
      toFormData({ elicit: 'custom', custom: data.customAnswer }),
    );

    expect(mocks.reply).toHaveBeenCalledWith(data.customAnswer);
  });

  it('自定义项没填内容时回空串', async () => {
    // 真实的表单里输入框总会提交一个空串
    const { form, action } = await setup(0, { elicit: 'custom', custom: '' });

    await submit(action, form);

    expect(mocks.reply).toHaveBeenCalledWith('');
  });

  it('候选项下标越界时回空串', async () => {
    const { form, action } = await setup(0, { elicit: '9' });

    await submit(action, form);

    expect(mocks.reply).toHaveBeenCalledWith('');
  });

  it('候选项为空时回空串', async () => {
    const { form, action } = await setup(2, { elicit: '0' });

    await submit(action, form);

    expect(mocks.reply).toHaveBeenCalledWith('');
  });

  it('回答后队列里的下一个问题顶上来', async () => {
    const data = await loadCases();
    useElicitState.getState().push({ ...data.items[0], reply: mocks.reply });
    useElicitState.getState().push({ ...data.items[1], reply: mocks.reply });
    render(<feature.component />);
    const action = mocks.actions.at(-1)!;

    await submit(action, toFormData({ elicit: '2' }));

    expect(mocks.reply).toHaveBeenCalledWith(data.items[0].examples[2]);
    expect(useElicitState.getState().item).toMatchObject({
      question: data.items[1].question,
    });
    expect(useElicitState.getState().items).toEqual([]);
  });

  it('没有当前项时提交不报错，只推进渲染计数', async () => {
    render(<feature.component />);
    const action = mocks.actions.at(-1)!;
    const before = useElicitState.getState().render;

    await submit(action, toFormData({ elicit: '0' }));

    expect(mocks.reply).not.toHaveBeenCalled();
    expect(useElicitState.getState().item).toBeNull();
    expect(useElicitState.getState().render).toBe(before + 1);
  });
});
