import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  realmId: vi.fn(),
  historyGet: vi.fn(),
  historySet: vi.fn(),
  rendererInitialize: vi.fn(),
  rendererContent: vi.fn(),
  rendererStream: vi.fn(),
  modelInitialize: vi.fn(),
  error: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));

// 真实的 @/components 桶会加载 monaco，jsdom 下极慢；这里按 page.tsx 实际用到的导出给最小桩
vi.mock('@/components', async () => {
  const React = (await import('react')).default;
  const { forms } = await import('@/global');

  const Input = React.forwardRef((props: any, ref: any) => {
    const { value, onChange, ...rest } = props;
    return React.createElement('input', {
      ...rest,
      ref,
      value,
      onChange,
      // 只读的展示型输入（如输出页码）没有 onChange，避免 React 的受控告警
      readOnly: value !== undefined && !onChange ? true : props.readOnly,
    });
  });
  const Textarea = React.forwardRef((props: any, ref: any) =>
    React.createElement('textarea', { ...props, ref }),
  );

  return {
    Button: ({ children, onClick, disabled, type }: any) =>
      React.createElement(
        'button',
        { 'data-button': 'true', type: type ?? 'button', disabled, onClick },
        children,
      ),
    ButtonGroup: ({ children }: any) =>
      React.createElement('div', { 'data-button-group': 'true' }, children),
    Checkbox: ({ checked, onCheckedChange, id, name }: any) =>
      React.createElement('input', {
        'data-checkbox': 'true',
        id,
        name,
        type: 'checkbox',
        checked: !!checked,
        onChange: (e: any) => onCheckedChange?.(e.target.checked),
      }),
    element: (component?: React.ComponentType, props?: any) =>
      component ? React.createElement(component, props) : null,
    IconTooltip: ({ children, text, onClick, disabled }: any) =>
      React.createElement(
        'button',
        { 'data-tooltip': text, type: 'button', disabled, onClick },
        children,
      ),
    Input,
    InputGroup: ({ children }: any) =>
      React.createElement('div', { 'data-input-group': 'true' }, children),
    InputGroupAddon: ({ children, align }: any) =>
      React.createElement('div', { 'data-addon': align }, children),
    InputGroupButton: ({ children, type, onClick, disabled }: any) =>
      React.createElement(
        'button',
        {
          'data-input-group-button': type ?? 'button',
          type: type ?? 'button',
          disabled,
          onClick,
        },
        children,
      ),
    InputGroupText: ({ children }: any) =>
      React.createElement('span', null, children),
    InputGroupTextarea: Textarea,
    Item: ({ children }: any) => React.createElement('div', null, children),
    ItemContent: ({ children }: any) =>
      React.createElement('div', null, children),
    ItemMedia: ({ children }: any) => React.createElement('div', null, children),
    ItemTitle: ({ children }: any) => React.createElement('div', null, children),
    Label: ({ children, htmlFor }: any) =>
      React.createElement('label', { htmlFor }, children),
    Spinner: () => React.createElement('span', { 'data-spinner': 'true' }),
    // 与 @/components 里的真实实现一致
    submitTargetFormOnKey: (e: any) => {
      if ((e.ctrlKey || e.metaKey) && (e.code === 'Enter' || e.code === 'KeyS')) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget?.form?.requestSubmit();
      }
    },
    forms,
  };
});

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
}));
vi.mock('@/global/client/loading', async () => {
  const React = (await import('react')).default;
  return {
    Loading: () =>
      React.createElement('div', { 'data-loading': 'true' }, 'loading'),
  };
});
// handler 用真实实现（去掉 toast），错误交给 spy，避免用例里出现未处理拒绝
vi.mock('@/interceptors/client', () => ({
  error: mocks.error,
  success: vi.fn(),
  handler:
    (action: any, finish?: any) =>
    async (...args: any[]) => {
      try {
        return await action(...args);
      } catch (err) {
        mocks.error(err);
      } finally {
        await finish?.(...args);
      }
    },
}));
vi.mock('@/models/client', () => ({
  models: { processers: { initialize: mocks.modelInitialize } },
}));
vi.mock('@/stories/client', async () => {
  // features 用真实的全局注册表，方便验证 sorted() + element 的接线
  const { features } = await import('@/stories/client/feature');
  return {
    stories: {
      proxy: {
        realm: { id: mocks.realmId },
        history: { get: mocks.historyGet, set: mocks.historySet },
      },
      renderers: {
        initialize: mocks.rendererInitialize,
        content: mocks.rendererContent,
        stream: mocks.rendererStream,
      },
      features,
    },
  };
});

import RealmPage from '@/stories/client/realms/page';
import { realms, useRealmState } from '@/stories/client/realms';
import { stories } from '@/stories/client';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./page.cases.json')).default);
}

const FEATURE_COMPONENT: Record<string, React.ComponentType> = {};

/** 把 fixture 里的 feature 注册进真实的全局注册表 */
function registerFeatures(data: any) {
  for (const item of data.features) {
    FEATURE_COMPONENT[item.id] = () =>
      React.createElement('span', { 'data-feature': item.id }, item.id);
    stories.features.registry.register({
      ...item,
      component: FEATURE_COMPONENT[item.id]!,
    });
  }
}

function unregisterFeatures(data: any) {
  for (const item of data.features) {
    stories.features.registry.unregister(item.id);
  }
}

/** 挂载页面并等首次加载结束 */
async function renderPage(data: any) {
  const utils = render(<RealmPage params={Promise.resolve({ id: data.id })} />);
  await waitFor(() => expect(mocks.rendererInitialize).toHaveBeenCalled());
  return utils;
}

/** PageControl 的渲染顺序：上一页、页码、末页、下一页、输出上一页、输出下一页 */
function toolbarButtons() {
  return screen.getAllByRole('button') as HTMLButtonElement[];
}

beforeEach(async () => {
  const data = await loadCases();
  vi.clearAllMocks();
  realms.realm = null!;
  realms.iframe = null!;
  useRealmState.setState({
    content: '',
    summary: false,
    signal: undefined,
    realmInfos: {},
    generating: false,
    pinned: true,
    prepare: false,
    index: { max: 1, cur: 0 },
    output: { max: 0, cur: -1 },
  });
  mocks.realmId.mockResolvedValue(structuredClone(data.realm));
  mocks.historyGet.mockImplementation(async () => data.realm.histories[0]);
  registerFeatures(data);
});

afterEach(async () => {
  const data = await loadCases();
  unregisterFeatures(data);
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('stories realms page / 首次加载', () => {
  it('加载期间只渲染 Loading', async () => {
    const data = await loadCases();
    let resolve!: (value: any) => void;
    mocks.realmId.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );

    render(<RealmPage params={Promise.resolve({ id: data.id })} />);

    expect(document.querySelector('[data-loading="true"]')).not.toBeNull();

    resolve(structuredClone(data.realm));
    await waitFor(() =>
      expect(document.querySelector('[data-loading="true"]')).toBeNull(),
    );
  });

  it('应当按 id 取 realm、初始化模型与渲染器，并把 realm 挂到单例上', async () => {
    const data = await loadCases();

    await renderPage(data);

    expect(mocks.realmId).toHaveBeenCalledWith(data.id);
    expect(mocks.modelInitialize).toHaveBeenCalledTimes(1);
    expect(mocks.rendererInitialize).toHaveBeenCalledTimes(1);
    expect(mocks.modelInitialize.mock.calls[0][0].realm.id).toBe(data.id);
    expect(mocks.rendererInitialize.mock.calls[0][0].realm.id).toBe(data.id);
    expect(realms.realm.id).toBe(data.id);
  });

  it('应当用 initPager 把历史分页接到 state 上', async () => {
    const data = await loadCases();
    const history = data.realm.histories[0];

    await renderPage(data);

    const state = useRealmState.getState();
    expect(state.index).toEqual({
      max: data.realm.histories.length,
      cur: data.realm.histories.length,
    });
    expect(state.output).toEqual({
      max: history.outputs.length,
      cur: history.output,
    });
  });

  it('加载失败时应当把错误交给 error 且不再初始化渲染器', async () => {
    const data = await loadCases();
    mocks.realmId.mockRejectedValue(new Error('boom'));

    render(<RealmPage params={Promise.resolve({ id: data.id })} />);

    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.error.mock.calls[0][0].message).toBe('boom');
    expect(mocks.rendererInitialize).not.toHaveBeenCalled();
    expect(realms.realm).toBeNull();
  });
});

describe('stories realms page / 分页控件', () => {
  it('应当按 index 渲染页码并禁用越界的翻页按钮', async () => {
    const data = await loadCases();

    await renderPage(data);

    const index = useRealmState.getState().index;
    // index.cur === index.max（最后一页）时，末页与下一页都禁用，上一页可用
    expect(toolbarButtons()[0]!.disabled).toBe(false);
    expect(toolbarButtons()[1]!.textContent).toBe(`${index.max}`);
    expect(toolbarButtons()[1]!.disabled).toBe(true);
    expect(toolbarButtons()[2]!.disabled).toBe(true);
    expect(document.querySelector('input[name="realm-index"]')).toHaveProperty(
      'value',
      `${index.cur}`,
    );
  });

  it('点击上一页应当走真实的 setIndex', async () => {
    const data = await loadCases();

    await renderPage(data);

    fireEvent.click(toolbarButtons()[0]!);

    await waitFor(() =>
      expect(useRealmState.getState().index.cur).toBe(
        data.realm.histories.length - 1,
      ),
    );
  });

  it('提交页码表单应当把输入框的值交给 setIndex', async () => {
    const data = await loadCases();

    await renderPage(data);
    fireEvent.click(toolbarButtons()[0]!);
    await waitFor(() => expect(useRealmState.getState().index.cur).toBe(0));

    const input = document.querySelector(
      'input[name="realm-index"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: `${data.pageIndex}` } });
    fireEvent.submit(input.form!);

    await waitFor(() =>
      expect(useRealmState.getState().index.cur).toBe(data.pageIndex),
    );
  });
});

describe('stories realms page / 输入与生成', () => {
  it('输入内容与摘要勾选应当写进 state', async () => {
    const data = await loadCases();

    await renderPage(data);

    const textarea = screen.getByPlaceholderText(
      'default.ctrl_enter_submit',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: data.input } });
    expect(useRealmState.getState().content).toBe(data.input);

    fireEvent.click(document.querySelector('[data-checkbox="true"]')!);
    expect(useRealmState.getState().summary).toBe(true);
  });

  it('提交输入表单应当调用 realms.generate(true)', async () => {
    const data = await loadCases();
    const generate = vi.spyOn(realms, 'generate').mockResolvedValue(undefined);

    await renderPage(data);
    const textarea = screen.getByPlaceholderText(
      'default.ctrl_enter_submit',
    ) as HTMLTextAreaElement;
    fireEvent.submit(textarea.form!);

    await waitFor(() => expect(generate).toHaveBeenCalledWith(true));
  });

  it('生成中应当把提交按钮换成停止按钮，点击后中断当前信号', async () => {
    const data = await loadCases();
    const controller = new AbortController();

    await renderPage(data);
    useRealmState.setState({ generating: true, signal: controller });

    await waitFor(() =>
      expect(
        document.querySelector('[data-input-group-button="button"]'),
      ).not.toBeNull(),
    );
    expect(
      document.querySelector('[data-input-group-button="submit"]'),
    ).toBeNull();

    fireEvent.click(
      document.querySelector('[data-input-group-button="button"]')!,
    );

    expect(controller.signal.aborted).toBe(true);
    expect((controller.signal.reason as any).code).toBe('message.user_canceled');
  });

  it('生成中应当按 realmInfos 渲染顶部提示', async () => {
    const data = await loadCases();

    await renderPage(data);
    useRealmState.setState({
      generating: true,
      realmInfos: { main: { title: 'realm.thinking', content: '12' } },
    });

    await waitFor(() => expect(screen.getByText('12')).toBeTruthy());
    expect(screen.getByText('realm.thinking')).toBeTruthy();
  });

  it('应当把输入框与 state 通过 iframe 的 userInput 暴露出去', async () => {
    const data = await loadCases();

    // userInput 的 get 闭包捕获的是挂载那一次渲染的 content（effect 只依赖 inputRef），
    // 因此必须在渲染前写入 state，挂载后再 setState 不会影响已挂上的 getter
    useRealmState.setState({ content: data.input });
    await renderPage(data);
    const window = realms.iframe.contentWindow as any;

    await waitFor(() => expect(window.userInput).toBeTruthy());
    expect(window.userInput.text.get()).toBe(data.input);
    expect(window.userInput.text.element()).toBe(
      screen.getByPlaceholderText('default.ctrl_enter_submit'),
    );
    expect(window.userInput.summary.get()).toBe(false);
    expect(window.userInput.inputBuilders).toEqual([]);
  });
});

describe('stories realms page / 页面级编排', () => {
  it('prepare 为真时应当读取当前历史并交给渲染器', async () => {
    const data = await loadCases();

    await renderPage(data);
    useRealmState.setState({ prepare: true });

    await waitFor(() => expect(mocks.rendererContent).toHaveBeenCalled());
    const arg = mocks.rendererContent.mock.calls[0][0];
    expect(arg.realm.id).toBe(data.id);
    expect(arg.history).toBeTruthy();
    expect(useRealmState.getState().prepare).toBe(false);
  });

  it('应当按注册表顺序渲染 feature 组件', async () => {
    const data = await loadCases();

    await renderPage(data);

    await waitFor(() =>
      expect(document.querySelectorAll('[data-feature]')).toHaveLength(
        data.features.length,
      ),
    );
    const ids = Array.from(document.querySelectorAll('[data-feature]')).map(
      (u) => u.getAttribute('data-feature'),
    );
    expect(ids).toEqual(data.features.map((u: any) => u.id));
  });

  it('固定/返回按钮应当分别切换 pinned 与跳回首页', async () => {
    const data = await loadCases();

    await renderPage(data);

    // beforeEach 里 pinned 为 true，所以初始提示是「取消固定」
    fireEvent.click(document.querySelector('[data-tooltip="realm.unpin_chatbox"]')!);
    expect(useRealmState.getState().pinned).toBe(false);
    expect(document.querySelector('[data-tooltip="realm.pin_chatbox"]')).not.toBeNull();

    fireEvent.click(document.querySelector('[data-tooltip="realm.back_home_tip"]')!);
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });
});
