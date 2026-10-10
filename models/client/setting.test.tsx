import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 展示层整体换成最小桩：
// - 真实 @/components 桶会加载 monaco，jsdom 下极慢
// - 真实 @/models/client 会顺带拉起三个 provider 的 client 桶与 stories/tools
// 这里只保留用例要观察的链路：表单字段 → 引擎 configureObject → models.proxy.update/create/clone/delete → setItem。
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  clone: vi.fn(),
  del: vi.fn(),
  setItem: vi.fn(async () => {}),
  setModel: vi.fn(),
  success: vi.fn(),
  configureObject: vi.fn(),
  otherConfigureObject: vi.fn(),
  /** 当前渲染用的 store 数据 */
  item: undefined as any,
  settingModel: null as any,
  engines: [] as any[],
  /** 最近一次表单的 onSubmit（用例可直接驱动错误分支） */
  submit: null as any,
  pending: null as any,
}));

vi.mock('@/components', () => {
  const pick = (props: any, keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, props[key]]));

  const Form: any = ({ children, form, onSubmit, ...props }: any) =>
    React.createElement(
      'form',
      {
        ...props,
        ref: form,
        onSubmit: (e: any) => {
          e.preventDefault();
          const promise = Promise.resolve(
            onSubmit?.(new FormData(e.currentTarget)),
          );
          mocks.pending = promise;
          // 错误分支由用例直接 await mocks.submit(...)，这里先兜住避免 unhandled rejection
          promise.catch(() => {});
        },
      },
      children,
    );

  return {
    Field: ({ children }: any) =>
      React.createElement('div', { 'data-field': 'true' }, children),
    FieldLabel: ({ children, ...props }: any) =>
      React.createElement(
        'label',
        { 'data-label': 'true', ...pick(props, ['htmlFor']) },
        children,
      ),
    FieldContent: ({ children }: any) =>
      React.createElement('div', { 'data-field-content': 'true' }, children),
    Input: ({ name, ...props }: any) =>
      React.createElement('input', {
        'data-input': name,
        name,
        ...pick(props, [
          'defaultValue',
          'type',
          'id',
          'required',
          'min',
          'max',
          'step',
          'autoComplete',
        ]),
      }),
    Checkbox: ({ name, ...props }: any) =>
      React.createElement('input', {
        'data-checkbox': name,
        type: 'checkbox',
        name,
        defaultChecked: props.defaultChecked,
      }),
    Selector: ({
      items = [],
      name,
      value,
      onValueChange,
      valueAccessor,
      labelAccessor,
      id,
    }: any) => {
      const [current, setCurrent] = React.useState(value ?? null);
      const toValue = (u: any) => (valueAccessor ? valueAccessor(u) : u);
      return React.createElement(
        'select',
        {
          'data-selector': name,
          id,
          name,
          value: current == null ? '' : String(toValue(current)),
          onChange: (e: any) => {
            const next =
              items.find((u: any) => String(toValue(u)) === e.target.value) ??
              null;
            setCurrent(next);
            onValueChange?.(next);
          },
        },
        items.map((u: any, index: number) =>
          React.createElement(
            'option',
            { key: index, value: String(toValue(u)) },
            labelAccessor ? labelAccessor(u) : String(toValue(u)),
          ),
        ),
      );
    },
    IconTooltip: ({ children, onClick, text, label, disabled }: any) =>
      React.createElement(
        'button',
        {
          'data-icon-tooltip': text,
          'data-label': typeof label === 'string' ? label : '',
          disabled: !!disabled,
          onClick: () => {
            if (!disabled) void onClick?.();
          },
        },
        children,
      ),
    TooltipDialog: ({ children, onSubmit, info, disabled, tooltip }: any) =>
      React.createElement(
        Form,
        {
          'data-dialog': info?.title ?? '',
          // 关闭状态下的表单不提交（真实弹窗的按钮是 disabled）
          onSubmit: (data: FormData) => (disabled ? undefined : onSubmit?.(data)),
        },
        React.createElement('span', { 'data-tooltip': 'true' }, tooltip),
        children,
        React.createElement(
          'button',
          { type: 'submit', 'data-ensure': 'true', disabled: !!disabled },
          'ensure',
        ),
      ),
    DeleteDialog: ({ onDelete, disabled, itemName }: any) =>
      React.createElement(
        'button',
        {
          type: 'button',
          'data-delete': itemName,
          disabled: !!disabled,
          onClick: () => {
            if (disabled) return;
            void onDelete?.();
          },
        },
        'delete',
      ),
    dialogs: {
      info: (_t: any, type: string, item?: string) => ({
        title: `${type}:${item ?? ''}`,
        tooltip: '',
        desc: '',
      }),
    },
    element: (Component: any, props?: any) =>
      Component ? React.createElement(Component, props) : null,
    UpdateForm: ({ children, form, onSubmit }: any) => {
      mocks.submit = onSubmit;
      return React.createElement(
        Form,
        { 'data-update-form': 'true', form, onSubmit },
        children,
        React.createElement(
          'button',
          { type: 'submit', 'data-save': 'true' },
          'save',
        ),
      );
    },
    useFormRef: () => React.useRef(null),
  };
});

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// 错误分支要能看到抛出的 BusinessError，所以 handler 保持直通
vi.mock('@/interceptors/client', () => ({
  handler: (fn: any) => fn,
  success: mocks.success,
}));

vi.mock('@/models/client', () => ({
  ModelNameValueField: ({ value, disableLabel, orientation }: any) =>
    React.createElement('div', {
      'data-model-field': 'true',
      'data-value': JSON.stringify(value ?? null),
      'data-disable-label': String(!!disableLabel),
      'data-orientation': String(orientation),
    }),
  models: {
    proxy: {
      get: mocks.get,
      update: mocks.update,
      create: mocks.create,
      clone: mocks.clone,
      delete: mocks.del,
    },
    engines: {
      registry: {
        record: (id?: string) => mocks.engines.find((u) => u.id === id),
        sorted: () => mocks.engines,
      },
    },
    toNameValue: (model: any) => ({ name: model.name, value: model.id }),
  },
  useModelState: () => ({ item: mocks.item, setItem: mocks.setItem }),
  useModelSettingState: () => ({
    model: mocks.settingModel,
    setModel: mocks.setModel,
  }),
}));

import { ModelSettingContent, setting } from '@/models/client/setting';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./setting.cases.json')).default);
}

/** 造一个带 configureObject 的引擎桩，返回值会被原样提交 */
function createEngine(id: string, configure: any = mocks.configureObject) {
  return {
    id,
    configureObject: configure,
    configComponent: () =>
      React.createElement('span', { 'data-engine-config': id }),
  };
}

function inputOf(name: string, root: ParentNode = updateForm()) {
  const el = root.querySelector(`[data-input="${name}"]`);
  if (!el) throw new Error(`找不到输入框: ${name}`);
  return el as HTMLInputElement;
}

function checkboxOf(name: string) {
  const el = document.querySelector(`[data-checkbox="${name}"]`);
  if (!el) throw new Error(`找不到复选框: ${name}`);
  return el as HTMLInputElement;
}

function selectorOf(name: string) {
  const el = document.querySelector(`[data-selector="${name}"]`);
  if (!el) throw new Error(`找不到选择器: ${name}`);
  return el as HTMLSelectElement;
}

function fill(el: Element, value: string | number) {
  fireEvent.change(el, { target: { value: String(value) } });
}

function updateForm() {
  const el = document.querySelector('[data-update-form="true"]');
  if (!el) throw new Error('找不到模型表单');
  return el as HTMLFormElement;
}

function dialogOf(name: string) {
  const el = document.querySelector(`[data-dialog="${name}"]`);
  if (!el) throw new Error(`找不到弹窗: ${name}`);
  return el as HTMLFormElement;
}

beforeEach(() => {
  vi.resetAllMocks();
  document.body.innerHTML = '';
  mocks.item = undefined;
  mocks.settingModel = null;
  mocks.engines = [];
  mocks.submit = null;
  mocks.pending = null;
});

describe('models setting / 导出的设置页描述', () => {
  it('id、label 与内容组件应当与模块一致', () => {
    expect(setting.id).toBe('model');
    expect(setting.label).toBe('model.id');
    expect(setting.content).toBe(ModelSettingContent);
    expect(setting.icon).toBeTruthy();
  });
});

describe('models setting / 表单默认值', () => {
  it('没有选中模型时渲染工具栏，但不渲染模型表单', async () => {
    const data = await loadCases();
    mocks.engines = data.engines.map((u: any) => createEngine(u.id));
    mocks.item = undefined;

    render(<ModelSettingContent />);

    expect(document.querySelector('[data-update-form="true"]')).toBeNull();
    // 顶部模型选择器拿到的是 null
    expect(
      document.querySelector('[data-model-field]')?.getAttribute('data-value'),
    ).toBe('null');
    // 删除按钮不可用
    expect(
      (document.querySelector('[data-delete]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('表单字段的默认值应当来自当前模型', async () => {
    const data = await loadCases();
    mocks.engines = data.engines.map((u: any) => createEngine(u.id));
    mocks.item = data.model;

    render(<ModelSettingContent />);

    expect(inputOf('name').value).toBe(data.model.name);
    expect(inputOf('interval').value).toBe(
      String(data.model.properties.retry.interval),
    );
    expect(inputOf('retry_max').value).toBe(
      String(data.model.properties.retry.max),
    );
    expect(inputOf('iterations').value).toBe(String(data.model.iterations));
    expect(inputOf('api_key').value).toBe(data.model.key);
    expect(checkboxOf('stream').checked).toBe(data.model.stream);
    expect(selectorOf('builder').value).toBe(data.model.builder);
    // 引擎选择器拿到的是注册表里那个对象，option 的 value 走 valueAccessor
    expect(selectorOf('provider').value).toBe(data.model.engine);
    // 引擎自己的配置组件会被渲染出来
    expect(
      document.querySelector(`[data-engine-config="${data.model.engine}"]`),
    ).toBeTruthy();
    // 顶部模型选择器拿到当前模型的 NameValue
    expect(
      document.querySelector('[data-model-field]')?.getAttribute('data-value'),
    ).toBe(
      JSON.stringify({ name: data.model.name, value: data.model.id }),
    );
  });

  it('properties 里没有 retry 时应当回落默认的重试次数与间隔', async () => {
    const data = await loadCases();
    mocks.engines = data.engines.map((u: any) => createEngine(u.id));
    mocks.item = data.noRetryModel;

    render(<ModelSettingContent />);

    expect(inputOf('retry_max').value).toBe(String(data.retryDefaults.max));
    expect(inputOf('interval').value).toBe(String(data.retryDefaults.interval));
  });
});

describe('models setting / 保存', () => {
  it('保存时应当把表单交给引擎装配后再请求更新', async () => {
    const data = await loadCases();
    mocks.engines = data.engines.map((u: any) => createEngine(u.id));
    mocks.item = data.model;
    mocks.configureObject.mockReturnValue(data.configured);

    render(<ModelSettingContent />);

    fill(inputOf('name'), data.edited.name);
    fill(inputOf('interval'), data.edited.interval);
    fill(inputOf('retry_max'), data.edited.retryMax);
    fill(inputOf('iterations'), data.edited.iterations);
    fill(inputOf('api_key'), data.edited.key);
    // 取消勾选流式
    if (checkboxOf('stream').checked) fireEvent.click(checkboxOf('stream'));
    fill(selectorOf('builder'), data.edited.builder);

    fireEvent.submit(updateForm());
    await mocks.pending;

    expect(mocks.configureObject).toHaveBeenCalledTimes(1);
    const [formData, input] = mocks.configureObject.mock.calls[0];
    expect(formData).toBeInstanceOf(FormData);
    expect(input).toEqual({
      engine: data.model.engine,
      name: data.edited.name,
      builder: data.edited.builder,
      stream: data.edited.stream,
      key: data.edited.key,
      iterations: data.edited.iterations,
      // 其它属性保留，只覆盖 retry
      properties: {
        ...data.model.properties,
        retry: { max: data.edited.retryMax, interval: data.edited.interval },
      },
    });

    // 更新请求的载荷就是引擎 configureObject 的返回值
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0]).toBe(data.model.id);
    expect(mocks.update.mock.calls[0][1]).toBe(
      mocks.configureObject.mock.results[0].value,
    );
    // 保存后重新选中当前模型并提示
    expect(mocks.setItem).toHaveBeenCalledWith(data.model.id);
    expect(mocks.success).toHaveBeenCalledWith('message.update.success');
  });

  it('api_key 与原值相同时不应该重复提交密钥', async () => {
    const data = await loadCases();
    mocks.engines = data.engines.map((u: any) => createEngine(u.id));
    mocks.item = data.model;
    mocks.configureObject.mockReturnValue(data.configured);

    render(<ModelSettingContent />);

    // 不改动任何字段直接保存
    fireEvent.submit(updateForm());
    await mocks.pending;

    const input = mocks.configureObject.mock.calls[0][1];
    expect(input.name).toBe(data.model.name);
    expect(input.stream).toBe(data.model.stream);
    expect(input.iterations).toBe(data.model.iterations);
    // 密钥与原值一致时不提交该字段（toEqual 会忽略 undefined，所以单独断言）
    expect(input.key).toBeUndefined();
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('切换 provider 后应当用新引擎的 configureObject', async () => {
    const data = await loadCases();
    const next = data.engines[1];
    mocks.engines = [
      createEngine(data.engines[0].id),
      createEngine(next.id, mocks.otherConfigureObject),
    ];
    mocks.item = data.model;
    mocks.otherConfigureObject.mockReturnValue(data.configured);

    render(<ModelSettingContent />);

    fill(selectorOf('provider'), next.id);
    fireEvent.submit(updateForm());
    await mocks.pending;

    expect(mocks.configureObject).not.toHaveBeenCalled();
    expect(mocks.otherConfigureObject).toHaveBeenCalledTimes(1);
    expect(mocks.otherConfigureObject.mock.calls[0][1].engine).toBe(next.id);
    expect(mocks.update.mock.calls[0][1]).toBe(
      mocks.otherConfigureObject.mock.results[0].value,
    );
  });

  it('没有引擎时应当报错且不请求更新', async () => {
    const data = await loadCases();
    mocks.engines = data.engines.map((u: any) => createEngine(u.id));
    mocks.item = data.noEngineModel;

    render(<ModelSettingContent />);

    await expect(mocks.submit(new FormData())).rejects.toMatchObject({
      message: 'engine is required',
      code: 'error.model.engine_required',
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.setItem).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
});

describe('models setting / 工具栏', () => {
  it('新建：提交名称后应当调用 create 并选中新模型', async () => {
    const data = await loadCases();
    mocks.engines = data.engines.map((u: any) => createEngine(u.id));
    mocks.item = undefined;
    mocks.create.mockResolvedValue(data.created);

    render(<ModelSettingContent />);

    const dialog = dialogOf('create:model.id');
    fill(inputOf('name', dialog), data.createdName);
    fireEvent.submit(dialog);

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith({
      ...data.createDefaults,
      name: data.createdName,
    });
    expect(mocks.setItem).toHaveBeenCalledWith(data.created.id);
    expect(mocks.success).toHaveBeenCalledWith('message.create.success');
  });

  it('克隆：提交名称后应当调用 clone 并选中新模型', async () => {
    const data = await loadCases();
    mocks.engines = data.engines.map((u: any) => createEngine(u.id));
    mocks.item = data.model;
    mocks.clone.mockResolvedValue(data.cloned);

    render(<ModelSettingContent />);

    const dialog = dialogOf('clone:model.id');
    fill(inputOf('name', dialog), data.clonedName);
    fireEvent.submit(dialog);

    await waitFor(() => expect(mocks.clone).toHaveBeenCalledTimes(1));
    expect(mocks.clone).toHaveBeenCalledWith(data.model.id, {
      name: data.clonedName,
    });
    expect(mocks.setItem).toHaveBeenCalledWith(data.cloned.id);
    expect(mocks.success).toHaveBeenCalledWith('message.clone.success');
  });

  it('删除：确认后应当调用 delete 并清空当前模型', async () => {
    const data = await loadCases();
    mocks.engines = data.engines.map((u: any) => createEngine(u.id));
    mocks.item = data.model;

    render(<ModelSettingContent />);

    fireEvent.click(document.querySelector('[data-delete]')!);

    await waitFor(() => expect(mocks.del).toHaveBeenCalledTimes(1));
    expect(mocks.del).toHaveBeenCalledWith(data.model.id);
    expect(mocks.setItem).toHaveBeenCalledWith(undefined);
    expect(mocks.success).toHaveBeenCalledWith('message.delete.success');
  });

  it('没有选中模型时删除与克隆都不可用', async () => {
    const data = await loadCases();
    mocks.engines = data.engines.map((u: any) => createEngine(u.id));
    mocks.item = undefined;

    render(<ModelSettingContent />);

    const clone = dialogOf('clone:model.id');
    const ensure = clone.querySelector('[data-ensure="true"]') as HTMLButtonElement;
    expect(ensure.disabled).toBe(true);

    fill(inputOf('name', clone), data.clonedName);
    fireEvent.submit(clone);

    expect(mocks.clone).not.toHaveBeenCalled();
    expect(mocks.setItem).not.toHaveBeenCalled();
  });

  it('点击星标应当把当前模型设为默认模型', async () => {
    const data = await loadCases();
    mocks.engines = data.engines.map((u: any) => createEngine(u.id));
    mocks.item = data.model;
    mocks.settingModel = { name: data.model.name, value: data.model.id };

    render(<ModelSettingContent />);

    // 默认模型的名字展示在按钮上
    const star = document.querySelector(
      '[data-icon-tooltip="model.default"]',
    ) as HTMLButtonElement;
    expect(star.getAttribute('data-label')).toContain(data.model.name);

    fireEvent.click(star);

    await waitFor(() =>
      expect(mocks.setModel).toHaveBeenCalledWith({
        name: data.model.name,
        value: data.model.id,
      }),
    );
  });

  it('没有选中模型时点击星标应当清空默认模型', async () => {
    const data = await loadCases();
    mocks.engines = data.engines.map((u: any) => createEngine(u.id));
    mocks.item = undefined;

    render(<ModelSettingContent />);

    fireEvent.click(document.querySelector('[data-icon-tooltip="model.default"]')!);

    await waitFor(() => expect(mocks.setModel).toHaveBeenCalledWith(null));
  });
});
