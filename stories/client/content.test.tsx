import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  clone: vi.fn(),
  entryClone: vi.fn(),
  historyDel: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  readText: vi.fn(),
}));

// 成功提示走 sonner，换成可断言的桩；handler 本身仍是真实实现
vi.mock('sonner', () => ({ toast: { success: mocks.toast, error: vi.fn() } }));
// setup 里的 next/navigation 是空实现，这里换成能记录参数的桩
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// 代理层是请求边界，整体替换；state 走真实 store
vi.mock('@/stories/client', () => ({
  stories: {
    proxy: {
      get: mocks.get,
      list: mocks.list,
      create: mocks.create,
      update: mocks.update,
      delete: mocks.remove,
      clone: mocks.clone,
      entry: { clone: mocks.entryClone },
      history: { del: mocks.historyDel },
    },
  },
}));
// 菜单标签与模型/预设字段都只提供最小桩
vi.mock('@/global/client', () => ({ GlobalMenuLabel: () => null }));
vi.mock('@/models/client', () => ({
  ModelNameValueField: ({ name, value }: any) =>
    React.createElement('input', {
      name,
      'data-field': 'model',
      defaultValue: value ? JSON.stringify(value) : '',
    }),
}));
vi.mock('@/presets/client', () => ({
  PresetNameValuesField: ({ name, value }: any) =>
    React.createElement(
      React.Fragment,
      null,
      (value ?? []).map((u: any, i: number) =>
        React.createElement('input', {
          key: i,
          name,
          'data-field': 'preset',
          defaultValue: JSON.stringify(u),
        }),
      ),
    ),
}));

// 真实桶会加载 monaco（jsdom 下极慢甚至 OOM），这里按 content.tsx 实际用到的导出逐个给桩；
// useTabs / useFormRef / combobox 这些纯逻辑从子模块引真身（子模块不加载 monaco）
vi.mock('@/components', async () => {
  const React = (await import('react')).default;
  const { useTabs, useFormRef } =
    await vi.importActual<any>('@/components/hooks');
  const { combobox } = await vi.importActual<any>('@/components/combobox');

  const h = React.createElement;
  const pick = (props: any, keys: string[]) =>
    Object.fromEntries(
      keys.filter((key) => props[key] !== undefined).map((key) => [key, props[key]]),
    );
  const props = (value: any) => ({ 'data-props': JSON.stringify(value) });
  const box =
    (tag: string) =>
    ({ children }: any) =>
      h(tag, null, children);

  const TabsContext = React.createContext<any>({});

  return {
    element: (component?: any, rest?: any) =>
      component ? h(component, rest) : null,
    translator: { t: undefined, translate: (message: string) => message },
    combobox,
    useTabs,
    useFormRef,
    dialogs: {
      info: (_t: any, type: string, item?: string) => ({
        title: type,
        tooltip: item ? `${type}:${item}` : type,
        desc: item,
      }),
    },
    Button: ({ children, type = 'button', onClick, ...rest }: any) =>
      h('button', { type, onClick, ...props(pick(rest, ['className'])) }, children),
    Field: box('div'),
    FieldLabel: ({ children, htmlFor }: any) => h('label', { htmlFor }, children),
    Input: (rest: any) =>
      h('input', pick(rest, ['name', 'id', 'required', 'defaultValue'])),
    InputGroup: box('div'),
    InputGroupAddon: box('div'),
    InputGroupButton: ({ children, type = 'button', onClick }: any) =>
      h('button', { type, onClick, 'data-addon-button': 'true' }, children),
    InputGroupInput: (rest: any) =>
      h(
        'input',
        pick(rest, ['name', 'id', 'placeholder', 'value', 'onChange']),
      ),
    ItemContent: box('div'),
    ItemTitle: box('div'),
    ItemDescription: box('div'),
    EmptySelectContent: ({ module }: any) =>
      h('div', { 'data-empty-select': module }),
    IconTooltip: ({ children, text, disabled, onClick }: any) =>
      h(
        'button',
        {
          'data-icon': text,
          'data-disabled': String(!!disabled),
          onClick: disabled ? undefined : onClick,
        },
        children,
      ),
    MainResizeable: ({ side, children }: any) =>
      h(
        'div',
        null,
        h('div', { 'data-side': 'true' }, side),
        h('div', { 'data-main': 'true' }, children),
      ),
    Tabs: ({ value, onValueChange, children }: any) =>
      h(TabsContext.Provider, { value: { value, onValueChange } }, h('div', null, children)),
    TabsList: box('div'),
    TabsTrigger: ({ value, children }: any) => {
      const ctx = React.useContext(TabsContext);
      return h(
        'button',
        {
          'data-tab': value,
          'data-active': String(ctx.value === value),
          onClick: () => ctx.onValueChange?.(value),
        },
        children,
      );
    },
    DropdownMenu: box('div'),
    DropdownMenuTrigger: ({ render, children }: any) =>
      h('div', { 'data-trigger': 'true' }, render ?? children),
    DropdownMenuContent: box('div'),
    DropdownMenuItem: ({ children, onClick }: any) =>
      h('button', { 'data-menuitem': 'true', onClick }, children),
    UpdateForm: ({ form, onSubmit, children }: any) =>
      h(
        'form',
        {
          ref: form,
          'data-update-form': 'true',
          onSubmit: (e: any) => {
            e.preventDefault();
            void onSubmit?.(new FormData(e.currentTarget));
          },
        },
        children,
        h('button', { type: 'submit' }, 'save'),
      ),
    TooltipDialog: ({ tooltip, children, onSubmit, disabled, info }: any) =>
      h(
        'form',
        {
          'data-dialog': info?.title ?? '',
          'data-tooltip': info?.tooltip ?? '',
          'data-disabled': String(!!disabled),
          onSubmit: (e: any) => {
            e.preventDefault();
            void onSubmit?.(new FormData(e.currentTarget));
          },
        },
        h('span', { 'data-dialog-tooltip': 'true' }, tooltip),
        children,
        onSubmit ? h('button', { type: 'submit' }, 'ensure') : null,
      ),
    DeleteDialog: ({ itemName, disabled, onDelete }: any) =>
      h(
        'button',
        {
          'data-delete': itemName,
          'data-disabled': String(!!disabled),
          onClick: () => void onDelete(),
        },
        'delete',
      ),
    PagedItemList: (rest: any) => {
      const { items, refresh } = rest.usePager();
      React.useEffect(() => {
        void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return h(
        'div',
        { 'data-list': 'true', 'data-entry': rest.entryName ?? '' },
        items?.length
          ? items.map((item: any, i: number) =>
              h(
                'div',
                {
                  key: rest.itemKey?.(item, i) ?? i,
                  'data-row': item.id,
                  'data-active': String(!!rest.active?.(item)),
                  onClick: () => rest.onClick?.(item),
                },
                rest.children(item),
              ),
            )
          : h('div', { 'data-empty': 'true' }, rest.entryName ?? ''),
      );
    },
  };
});

import { useStoryState } from '@/stories/client/state';
import { menu, property, tabs } from '@/stories/client/content';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./content.cases.json')).default);
}

/** content.tsx 的 menu.content 就是要测的界面 */
const Content = menu.content as React.ComponentType;

/** 用真实 store 的标签页注册表挂一个可隐藏的标签，用来验证「更多」菜单 */
function entriesTab(data: any) {
  return {
    id: data.tab.id,
    sequence: 10,
    hidable: true,
    label: data.tab.label,
    icon: () => null,
    content: () => React.createElement('span', null, data.tab.text),
  };
}

const button = (selector: string) =>
  document.querySelector(selector) as HTMLElement;

beforeEach(() => {
  vi.resetAllMocks();
  useStoryState.setState({
    item: undefined,
    items: undefined,
    cur: 0,
    max: 0,
    tab: 'property',
    loading: false,
    search: undefined,
  });
  // 注册表是 globalThis 上的单例，用之前先清掉上一次的注册
  tabs.unregister('property');
  tabs.unregister('entries');
  tabs.register(property);
  Object.defineProperty(navigator, 'clipboard', {
    value: { readText: mocks.readText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  tabs.unregister('property');
  tabs.unregister('entries');
});

describe('stories client content / 列表与搜索', () => {
  it('挂载时应当按当前分页拉列表，未选中条目时自动选中第一项', async () => {
    const data = await loadCases();
    mocks.list.mockResolvedValue({ items: data.stories, length: data.total });
    mocks.get.mockResolvedValue(data.stories[0]);

    render(<Content />);

    await waitFor(() =>
      expect(mocks.list).toHaveBeenCalledWith({
        search: undefined,
        ...data.listParam,
      }),
    );
    for (const item of data.stories) {
      expect(await screen.findByText(new RegExp(item.name))).toBeTruthy();
    }
    // 没有选中项时用列表首项兜底
    // 注意：这里 mock 的是 @/stories/client 的 proxy，参数是 proxy.get(id, options) 的原始形态
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(data.stories[0].id, { types: true }),
    );
    expect(useStoryState.getState().item?.id).toBe(data.stories[0].id);
    // active 回调标记当前选中项
    expect(button(`[data-row="${data.stories[0].id}"]`).dataset.active).toBe('true');
    expect(button(`[data-row="${data.stories[1].id}"]`).dataset.active).toBe('false');
  });

  it('点击条目应当切换选中项并拉取详情', async () => {
    const data = await loadCases();
    mocks.list.mockResolvedValue({ items: data.stories, length: data.total });
    mocks.get.mockResolvedValue(data.stories[0]);

    render(<Content />);
    await waitFor(() => expect(button(`[data-row="${data.stories[1].id}"]`)).toBeTruthy());

    mocks.get.mockResolvedValue(data.stories[1]);
    fireEvent.click(button(`[data-row="${data.stories[1].id}"]`));

    await waitFor(() => expect(useStoryState.getState().item?.id).toBe(data.stories[1].id));
    expect(mocks.get).toHaveBeenLastCalledWith(data.stories[1].id, { types: true });
  });

  it('进入按钮应当跳转到 /{id}', async () => {
    const data = await loadCases();
    mocks.list.mockResolvedValue({ items: data.stories, length: data.total });
    mocks.get.mockResolvedValue(data.stories[0]);

    render(<Content />);
    await waitFor(() => expect(button(`[data-row="${data.stories[1].id}"]`)).toBeTruthy());

    fireEvent.click(
      button(`[data-row="${data.stories[1].id}"] [data-icon="story.enter"]`),
    );

    expect(mocks.push).toHaveBeenCalledWith(`/${data.stories[1].id}`);
  });

  it('搜索提交应当把输入内容当成 fuzzy 请求列表', async () => {
    const data = await loadCases();
    mocks.list.mockResolvedValue({ items: data.stories, length: data.total });

    render(<Content />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());

    const input = document.getElementById('story-search') as HTMLInputElement;
    fireEvent.change(input, { target: { value: data.search.text } });
    fireEvent.submit(input.form!);

    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith({
        search: { fuzzy: data.search.text },
        ...data.listParam,
      }),
    );
    // 输入框是受控的，值来自 store 外层的 fuzzy state
    expect(input.value).toBe(data.search.text);
  });

  it('重置按钮应当清空输入框并清掉 fuzzy', async () => {
    const data = await loadCases();
    mocks.list.mockResolvedValue({ items: data.stories, length: data.total });

    render(<Content />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());

    const input = document.getElementById('story-search') as HTMLInputElement;
    fireEvent.change(input, { target: { value: data.search.text } });
    fireEvent.submit(input.form!);
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith({
        search: { fuzzy: data.search.text },
        ...data.listParam,
      }),
    );

    // 加号按钮里第一个（非 submit）是重置
    const reset = Array.from(
      input.form!.querySelectorAll('button'),
    ).find((u) => u.type === 'button')!;
    fireEvent.click(reset);

    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith({
        search: {},
        ...data.listParam,
      }),
    );
    expect(input.value).toBe('');
  });

  it('没有选中条目时渲染空选择提示', async () => {
    const data = await loadCases();
    mocks.list.mockResolvedValue({ items: [], length: 0 });

    render(<Content />);

    expect(button('[data-empty-select="story.id"]')).toBeTruthy();
    expect(button('[data-list="true"]').dataset.entry).toBe('story.id');
    expect(await screen.findByText('story.id')).toBeTruthy();
  });
});

describe('stories client content / 工具栏', () => {
  it('创建对话框提交应当带上名称，并选中新故事后刷新列表', async () => {
    const data = await loadCases();
    mocks.list.mockResolvedValue({ items: data.stories, length: data.total });
    mocks.create.mockResolvedValue(data.create.created);
    mocks.get.mockResolvedValue({ id: data.create.created.id, name: data.create.name });

    render(<Content />);
    const dialog = button('[data-dialog="create"]') as HTMLFormElement;
    // 对话框 target 是 story.id
    expect(button('[data-dialog="create"]').dataset.tooltip).toBe('create:story.id');

    const name = dialog.querySelector('input[name="name"]') as HTMLInputElement;
    fireEvent.change(name, { target: { value: data.create.name } });
    fireEvent.submit(dialog);

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        name: data.create.name,
        presets: [],
      }),
    );
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(data.create.created.id, { types: true }),
    );
    expect(useStoryState.getState().item?.id).toBe(data.create.created.id);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(mocks.toast).toHaveBeenCalledWith('message.create.success', {
      richColors: true,
    });
  });

  it('粘贴对话框应当按剪贴板内容克隆条目并切到对应标签', async () => {
    const data = await loadCases();
    mocks.list.mockResolvedValue({ items: data.stories, length: data.total });
    mocks.get.mockResolvedValue(data.stories[2]);
    mocks.readText.mockResolvedValue(JSON.stringify(data.clipboard));
    useStoryState.setState({ item: data.stories[0] as any });

    render(<Content />);
    fireEvent.submit(button('[data-dialog="paste"]'));

    await waitFor(() =>
      expect(mocks.entryClone).toHaveBeenCalledWith(
        data.clipboard.id,
        data.clipboard.entryType,
        data.clipboard.entryId,
        {
          masterId: data.clipboard.entry.masterId,
          name: data.clipboard.entry.name,
        },
      ),
    );
    // 克隆完成后切到条目所在的标签并选中来源故事
    await waitFor(() => expect(useStoryState.getState().tab).toBe(data.clipboard.entryType));
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(data.clipboard.entry.masterId, {
        types: true,
      }),
    );
    expect(mocks.toast).toHaveBeenCalledWith('message.paste.success', {
      richColors: true,
    });
  });

  it('删除当前故事后应当刷新列表并选中剩下的第一条', async () => {
    const data = await loadCases();
    mocks.list.mockResolvedValue({ items: data.stories, length: data.total });
    mocks.get.mockResolvedValue(data.stories[0]);
    useStoryState.setState({ item: data.stories[0] as any });

    render(<Content />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));

    mocks.list.mockResolvedValue({
      items: data.afterDelete.stories,
      length: data.afterDelete.total,
    });
    mocks.remove.mockResolvedValue(undefined);
    fireEvent.click(button('[data-delete="story.id"]'));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(data.stories[0].id));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(data.afterDelete.stories[0].id, {
        types: true,
      }),
    );
    expect(mocks.toast).toHaveBeenCalledWith('message.delete.success', {
      richColors: true,
    });
  });
});

describe('stories client content / 标签页', () => {
  it('hidable 标签按 types 决定直接显示还是收进「更多」', async () => {
    const data = await loadCases();
    mocks.list.mockResolvedValue({ items: [], length: 0 });
    tabs.register(entriesTab(data) as any);
    useStoryState.setState({ item: data.stories[1] as any });

    const { unmount } = render(<Content />);

    await waitFor(() => expect(button('[data-menuitem="true"]')).toBeTruthy());
    expect(button('[data-tab="property"]')).toBeTruthy();
    expect(button(`[data-tab="${data.tab.id}"]`)).toBeNull();
    unmount();

    // 带 types 的故事把它放回标签列表
    useStoryState.setState({ item: data.typed as any, tab: 'property' });
    render(<Content />);

    await waitFor(() => expect(button(`[data-tab="${data.tab.id}"]`)).toBeTruthy());
    expect(button('[data-menuitem="true"]')).toBeNull();
  });

  it('点击标签或「更多」菜单项应当切换 tab 与内容', async () => {
    const data = await loadCases();
    mocks.list.mockResolvedValue({ items: [], length: 0 });
    tabs.register(entriesTab(data) as any);
    useStoryState.setState({ item: data.typed as any });

    render(<Content />);
    await waitFor(() => expect(button(`[data-tab="${data.tab.id}"]`)).toBeTruthy());
    // 默认标签是 property
    expect(button('[data-tab="property"]').dataset.active).toBe('true');

    fireEvent.click(button(`[data-tab="${data.tab.id}"]`));

    await waitFor(() => expect(useStoryState.getState().tab).toBe(data.tab.id));
    expect(await screen.findByText(data.tab.text)).toBeTruthy();
    expect(button(`[data-tab="${data.tab.id}"]`).dataset.active).toBe('true');
  });

  it('属性表单提交应当把改名与模型预设写回故事', async () => {
    const data = await loadCases();
    mocks.list.mockResolvedValue({ items: [], length: 0 });
    mocks.update.mockResolvedValue({ id: data.stories[0].id });
    mocks.get.mockResolvedValue(data.stories[0]);
    useStoryState.setState({ item: data.stories[0] as any });

    render(<Content />);
    const form = button('[data-update-form="true"]') as HTMLFormElement;

    const name = form.querySelector('input[name="name"]') as HTMLInputElement;
    fireEvent.change(name, { target: { value: data.update.name } });
    const model = form.querySelector('input[data-field="model"]') as HTMLInputElement;
    fireEvent.change(model, { target: { value: JSON.stringify(data.update.model) } });
    const presets = Array.from(
      form.querySelectorAll('input[data-field="preset"]'),
    ) as HTMLInputElement[];
    // 桩只会按已有 presets 渲染输入框（真实组件才支持动态增删预设），
    // 所以这里只断言提交时沿用原有预设，不构造第二项
    expect(presets).toHaveLength(data.stories[0].presets.length);

    fireEvent.submit(form);

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(data.stories[0].id, {
        name: data.update.name,
        model: data.update.model,
        // combobox.getAll('preset') 拿到的是表单里的预设项
        presets: [data.stories[0].presets[0]],
      }),
    );
    // 更新后重新拉一次详情
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(data.stories[0].id, { types: true }),
    );
    expect(mocks.toast).toHaveBeenCalledWith('message.update.success', {
      richColors: true,
    });
  });
});
