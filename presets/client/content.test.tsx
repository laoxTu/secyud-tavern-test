import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * presets/content.tsx 的测试。
 *
 * 真实 `@/components` 桶会拉起 monaco，jsdom 下极慢甚至 OOM；
 * 真实 `@/presets/client` barrel 会把全部 preset 子模块（styles/scripts/...）串起来。
 * 这里两者都换成桩：`@/components` 用 Proxy 兜底，只对需要交互或需要读 props 的
 * 导出单独给实现；`@/presets/client`、`@/presets/client/state` 换成由本文件控制的
 * store 与 proxy 间谍，从而可以断言「调了哪个方法、带了什么参数」。
 */

const mocks = vi.hoisted(() => {
  /** preset-tabs 注册表：getRegistry 的替身，行为与真实 registry 的 register/record/list 一致 */
  const registryTabs: any[] = [];
  const registry = {
    list: () =>
      registryTabs
        .slice()
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)),
    record: (id?: string) => registryTabs.find((u) => u.id === id),
    register: (...items: any[]) => {
      for (const item of items) {
        if (!registryTabs.some((u) => u.id === item.id)) registryTabs.push(item);
      }
    },
    unregister: (...ids: string[]) => {
      for (const id of ids) {
        const index = registryTabs.findIndex((u) => u.id === id);
        if (index >= 0) registryTabs.splice(index, 1);
      }
    },
  };
  return {
    registry,
    registryTabs,
    // state 方法
    setItem: vi.fn(async () => {}),
    setTab: vi.fn(),
    fetch: vi.fn<(option?: any) => Promise<void>>(async () => {}),
    refresh: vi.fn(async () => {}),
    // proxy 方法
    get: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [], length: 0 })),
    create: vi.fn(async () => ({ id: 'preset-new' })),
    update: vi.fn(async () => ({ id: 'preset-a' })),
    remove: vi.fn(async () => {}),
    clone: vi.fn(async () => ({ id: 'preset-clone' })),
    exportPreset: vi.fn(async () => {}),
    entryClone: vi.fn(async () => {}),
    prepare: vi.fn(async () => ({ sessionId: 's1', nameValues: [] })),
    confirm: vi.fn(async () => ({ id: 'preset-import' })),
    // 其余依赖
    success: vi.fn(),
    validJsonOrEmpty: vi.fn((text: string) =>
      text && text.trim() ? JSON.parse(text) : undefined,
    ),
    getImageFileId: vi.fn<(data: FormData, srcName?: string) => Promise<string>>(
      async () => 'file-id-9',
    ),
    onFileChange: vi.fn(),
    readText: vi.fn(async () => ''),
    push: vi.fn(),
    storyCreate: vi.fn(async () => ({ id: 'story-1' })),
    toNameValue: vi.fn((item: any) => ({ name: item.name, value: item.id })),
    model: 'model-1',
  };
});

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// setup 里的 next/navigation 是空实现，这里换成能记录参数的桩
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
  usePathname: () => '/',
}));

// 注册表（getRegistry）换成本文件的替身，避免拉起 @/plugins
vi.mock('@/plugins', () => ({
  getRegistry: () => mocks.registry,
}));

vi.mock('@/global', () => ({
  forms: {
    str: (data: FormData, name: string) => String(data.get(name) ?? ''),
    strs: (data: FormData, name: string) => data.getAll(name).map(String),
  },
}));

vi.mock('@/global/client', () => ({
  GlobalMenuLabel: ({ name }: any) =>
    React.createElement('div', { 'data-menu-label': 'true' }, String(name)),
  globals: { accessImageType: '.png' },
}));

vi.mock('@/interceptors', () => ({
  checker: {
    code: /^[a-z0-9-]+$/,
    validJsonOrEmpty: mocks.validJsonOrEmpty,
  },
  BusinessError: class BusinessError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
    withValue() {
      return this;
    }
  },
}));

// handler 保持直通，success 换成可断言的桩
vi.mock('@/interceptors/client', () => ({
  handler: (fn: any) => fn,
  success: mocks.success,
}));

vi.mock('@/utils', () => ({
  jsonUtils: { parse: (text: string) => JSON.parse(text) },
}));

vi.mock('@/models/client', () => ({
  useModelSettingState: { getState: () => ({ model: mocks.model }) },
}));

vi.mock('@/stories/client', () => ({
  stories: { proxy: { create: mocks.storyCreate } },
}));

// 被测组件的 store：用真实 zustand 建一个，但方法全由本文件驱动，
// 这样 content.tsx 里的 `usePresetState.getState()` 与 hook 用法都保持原样。
vi.mock('@/presets/client/state', async () => {
  const { create } = await import('zustand');
  const usePresetState = create<any>((set: any) => ({
    cur: 0,
    loading: false,
    size: 7,
    max: 0,
    tab: 'property',
    item: undefined,
    items: undefined,
    setItem: mocks.setItem,
    setTab: (tab?: string) => {
      mocks.setTab(tab);
      set({ tab });
    },
    fetch: mocks.fetch,
    refresh: mocks.refresh,
  }));
  return { usePresetState };
});

vi.mock('@/presets/client', async () => {
  const h = (await import('react')).default.createElement;
  const { usePresetState } = await import('@/presets/client/state');
  return {
    usePresetState,
    presets: {
      name: 'preset.name',
      tags: ['tag-1', 'tag-2'],
      toNameValue: mocks.toNameValue,
      proxy: {
        get: mocks.get,
        list: mocks.list,
        create: mocks.create,
        update: mocks.update,
        delete: mocks.remove,
        clone: mocks.clone,
        export: mocks.exportPreset,
        entry: { clone: mocks.entryClone },
        import: { prepare: mocks.prepare, confirm: mocks.confirm },
      },
    },
    // 真实实现把内容写进同名 input 交给 FormData；这里保持同样的形态
    PresetNameValuesField: ({ name, value }: any) =>
      h(
        React.Fragment,
        null,
        (value ?? []).map((u: any, i: number) =>
          h('input', {
            key: i,
            name,
            'data-field': 'preset',
            defaultValue: JSON.stringify(u),
          }),
        ),
      ),
  };
});

// 真实桶会加载 monaco（jsdom 下极易 OOM）。
// 注意：这里必须「按 content.tsx 的 import 列表逐个给具名导出」，
// 全量 Proxy 桩不行——vitest 会枚举 mock 的 key，取不到的导出直接报
// "No xxx export is defined on the @/components mock"。
vi.mock('@/components', async () => {
  const React = (await import('react')).default;
  const { combobox } = await vi.importActual<any>('@/components/combobox');
  const { usePresetState } = await import('@/presets/client/state');
  const h = React.createElement;
  const TabsContext = React.createContext<any>({});

  const pick = (props: any, keys: string[]) =>
    Object.fromEntries(
      keys.filter((key) => props[key] !== undefined).map((key) => [key, props[key]]),
    );
  const box = (name: string) => (props: any) =>
    h('div', { 'data-stub': name }, props?.children);

  const explicit: Record<string, any> = {
    rowHalf: 'row-half',
    rowQuat: 'row-quat',
    spanHalf: 'span-half',
    submitTargetFormOnKey: () => {},
    combobox,
    // 只展示内容、不参与交互的展示组件
    AspectRatio: box('AspectRatio'),
    AutoMedia: box('AutoMedia'),
    Field: ({ children }: any) => h('div', { 'data-field': 'true' }, children),
    FieldGroup: box('FieldGroup'),
    FieldContent: box('FieldContent'),
    FieldLabel: ({ children, htmlFor }: any) => h('label', { htmlFor }, children),
    ItemContent: box('ItemContent'),
    ItemDescription: box('ItemDescription'),
    ItemMedia: box('ItemMedia'),
    ItemTitle: box('ItemTitle'),
    InputGroup: box('InputGroup'),
    InputGroupAddon: box('InputGroupAddon'),
    TextTooltip: ({ text }: any) => h('span', { 'data-tooltip-text': 'true' }, text),
    ImageUploader: ({ id, name, value }: any) =>
      h('div', { 'data-image-uploader': name ?? id ?? '', 'data-value': String(value ?? '') }),
    Checkbox: ({ checked, onCheckedChange, id }: any) =>
      h('input', {
        type: 'checkbox',
        id,
        checked: !!checked,
        onChange: (e: any) => onCheckedChange?.(e.target.checked),
      }),
    Button: ({ children, type = 'button', onClick }: any) =>
      h('button', { type, onClick }, children),
    DropdownMenu: box('DropdownMenu'),
    DropdownMenuTrigger: ({ render, children }: any) =>
      h('div', { 'data-trigger': 'true' }, render ?? children),
    DropdownMenuContent: box('DropdownMenuContent'),
    DropdownMenuItem: ({ children, onClick }: any) =>
      h('button', { 'data-menuitem': 'true', onClick }, children),
    // 受控搜索框：value/onChange 必须透传
    InputGroupInput: (props: any) =>
      h(
        'input',
        pick(props, ['name', 'id', 'placeholder', 'value', 'onChange', 'type']),
      ),
    // 被测文件把它当普通对象用：dialogs.info(t, type, target)
    dialogs: {
      info: (_t: any, type: string, target?: string) => ({
        title: type,
        tooltip: target ? `${type}:${target}` : type,
      }),
    },
    // 被测文件把它当普通函数用：element(Component, props)
    element: (Component: any, props?: any) =>
      Component ? h(Component, props) : null,
    // useTabs 只用到注册表的 list：直接列出全部标签，不模拟 hidable
    useTabs: (registry: any) => ({ showTabs: registry.list(), hideTabs: [] }),
    useFormRef: () => React.useRef<any>(null),
    useImageUploaderState: () => ({
      onFileChange: mocks.onFileChange,
      getImageFileId: mocks.getImageFileId,
    }),
    MainResizeable: ({ side, children }: any) =>
      h(
        'div',
        { 'data-resizeable': 'true' },
        h('div', { 'data-side': 'true' }, side),
        h('div', { 'data-main': 'true' }, children),
      ),
    Tabs: ({ value, onValueChange, children }: any) =>
      h(
        TabsContext.Provider,
        { value: { value, onValueChange } },
        h('div', null, children),
      ),
    TabsList: box('TabsList'),
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
    TooltipDialog: ({ tooltip, children, onSubmit, info }: any) =>
      h(
        'form',
        {
          'data-dialog': info?.title ?? '',
          'data-tooltip': info?.tooltip ?? '',
          onSubmit: (e: any) => {
            e.preventDefault();
            void onSubmit?.(new FormData(e.currentTarget));
          },
        },
        h('span', { 'data-dialog-tooltip': 'true' }, tooltip),
        children,
        onSubmit ? h('button', { type: 'submit', 'data-ensure': 'true' }, 'ensure') : null,
      ),
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
        h('button', { type: 'submit', 'data-save': 'true' }, 'save'),
      ),
    DeleteDialog: ({ itemName, onDelete }: any) =>
      h('button', { 'data-delete': itemName, onClick: () => void onDelete?.() }, 'delete'),
    IconTooltip: ({ children, text, onClick }: any) =>
      h('button', { 'data-icon': text, onClick }, children),
    InputGroupButton: ({ children, type = 'button', onClick }: any) =>
      h('button', { type, 'data-addon-button': 'true', onClick }, children),
    Input: (props: any) =>
      h(
        'input',
        pick(props, [
          'name',
          'id',
          'type',
          'required',
          'defaultValue',
          'accept',
          'pattern',
          'placeholder',
          'onChange',
        ]),
      ),
    Textarea: (props: any) =>
      h('textarea', pick(props, ['name', 'id', 'defaultValue', 'onChange', 'onKeyDown'])),
    // 真实 Monaco 在 jsdom 下不可用，换成同样进 FormData 的 textarea
    MonacoEditor: ({ name, value, language }: any) => {
      const [content, setContent] = React.useState(value ?? '');
      return h('textarea', {
        'data-editor': name,
        'data-language': language,
        name,
        value: content,
        onChange: (e: any) => setContent(e.target.value),
      });
    },
    TagBox: ({ name, value }: any) =>
      h(
        React.Fragment,
        null,
        (value ?? []).map((u: any, i: number) =>
          h('input', { key: i, type: 'hidden', name, defaultValue: u }),
        ),
      ),
    PagedItemList: (props: any) => {
      const { items } = props.usePager();
      return h(
        'div',
        {
          'data-list': 'true',
          'data-entry': props.entryName ?? '',
          // 证明传进去的 usePager 就是 usePresetState
          'data-pager': String(props.usePager === usePresetState),
        },
        items?.length
          ? items.map((item: any, i: number) =>
              h(
                'div',
                {
                  key: props.itemKey?.(item, i) ?? i,
                  'data-row': item.id,
                  'data-active': String(!!props.active?.(item)),
                  onClick: () => props.onClick?.(item),
                },
                props.children(item),
              ),
            )
          : h('div', { 'data-empty': 'true' }, props.entryName ?? ''),
      );
    },
    EmptySelectContent: ({ module }: any) => h('div', { 'data-empty-select': module }),
  };

  return explicit;
});

import { usePresetState } from '@/presets/client';
import { menu, property, tabs } from '@/presets/client/content';

const PRESETS = [
  {
    id: 'preset-a',
    name: '预设甲',
    description: 'desc-a',
    version: '1.0.0',
    cover: 'cover-a.png',
    opening: 'opening-a',
    variables: '{"a":1}',
    tags: ['tag-1'],
    requires: [],
  },
  {
    id: 'preset-b',
    name: '预设乙',
    description: 'desc-b',
    version: '1.1.0',
    cover: 'cover-b.png',
    opening: 'opening-b',
    variables: '{}',
    tags: ['tag-2'],
    requires: [],
  },
];

/** content.tsx 的 menu.content 就是要测的界面 */
const Content = menu.content as React.ComponentType;

function q(selector: string) {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`找不到元素: ${selector}`);
  return el as HTMLElement;
}

function input(selector: string) {
  return q(selector) as HTMLInputElement;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.fetch.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue(undefined);
  mocks.setItem.mockResolvedValue(undefined);
  mocks.getImageFileId.mockResolvedValue('file-id-9');
  mocks.validJsonOrEmpty.mockImplementation((text: string) =>
    text && text.trim() ? JSON.parse(text) : undefined,
  );

  tabs.unregister('property');
  tabs.unregister('entries');
  tabs.register(property);
  tabs.register({
    id: 'entries',
    sequence: 10,
    label: 'entries.label',
    icon: () => null,
    content: () => React.createElement('span', { 'data-tab-content': 'entries' }, 'entries'),
  } as any);

  usePresetState.setState({
    item: undefined,
    items: undefined,
    tab: 'property',
    cur: 0,
    max: 0,
    loading: false,
  });
});

afterEach(() => {
  cleanup();
  tabs.unregister('property');
  tabs.unregister('entries');
});

describe('presets client content / 模块导出', () => {
  it('property 与 menu 的描述应当与模块一致', () => {
    expect(property.id).toBe('property');
    expect(property.sequence).toBe(-1);
    expect(property.label).toBe('default.property');
    expect(property.content).toBeTypeOf('function');
    expect(property.icon).toBeTruthy();

    expect(menu.id).toBe('preset');
    expect(menu.content).toBeTypeOf('function');
    expect(menu.label).toBeTypeOf('function');
    // label 渲染菜单标题（GlobalMenuLabel 桩）
    expect(menu.label()).toBeTruthy();
    // 注册表里能按 id 取回 property
    expect(tabs.record('property')).toBe(property);
  });
});

describe('presets client content / 列表与选中', () => {
  it('挂载时没有选中项：自动选中首项、渲染空提示，点击条目切换选中', async () => {
    usePresetState.setState({ items: PRESETS as any, item: undefined });

    render(<Content />);

    // 没有选中项时用列表首项兜底
    await waitFor(() => expect(mocks.setItem).toHaveBeenCalledWith('preset-a'));
    // 列表接到了同一个 store 上
    expect(q('[data-list="true"]').dataset.pager).toBe('true');
    expect(q('[data-list="true"]').dataset.entry).toBe('preset.id');
    // item 一直是空的（setItem 是桩），所以渲染空选择提示
    expect(q('[data-empty-select="preset.id"]')).toBeTruthy();
    expect(q('[data-row="preset-a"]').textContent).toContain('预设甲');

    // 点击条目行 → setItem(item.id)
    mocks.setItem.mockClear();
    fireEvent.click(q('[data-row="preset-b"]'));
    await waitFor(() => expect(mocks.setItem).toHaveBeenCalledWith('preset-b'));
  });

  it('搜索提交与重置应当把 fuzzy/tags 交给 fetch', async () => {
    usePresetState.setState({ items: PRESETS as any });

    render(<Content />);
    const search = input('#preset-search');

    fireEvent.change(search, { target: { value: '甲' } });
    // 受控输入：值来自组件自己的 state
    expect(search.value).toBe('甲');
    fireEvent.submit(search.form!);

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const [applyParam] = mocks.fetch.mock.calls[0];
    expect(applyParam.search()).toEqual({ fuzzy: '甲', tags: null });

    // 加号区域里第一个非 submit 按钮是重置
    const reset = Array.from(search.form!.querySelectorAll('button')).find(
      (u) => u.type === 'button',
    )!;
    fireEvent.click(reset);

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    const [resetParam] = mocks.fetch.mock.calls[1];
    expect(resetParam.search()).toEqual({});
    expect(search.value).toBe('');
  });
});

describe('presets client content / 工具栏', () => {
  it('点击导出图标应当用当前预设 id 调 proxy.export', async () => {
    usePresetState.setState({ item: PRESETS[0] as any, items: PRESETS as any });

    render(<Content />);

    fireEvent.click(q('[data-icon="message.export.tooltip"]'));

    await waitFor(() =>
      expect(mocks.exportPreset).toHaveBeenCalledWith('preset-a'),
    );
  });

  it('创建对话框提交应当带上 code/name 创建预设并刷新', async () => {
    usePresetState.setState({ items: PRESETS as any });

    render(<Content />);
    const dialog = q('[data-dialog="create"]') as HTMLFormElement;
    // 对话框 target 是 preset.id
    expect(dialog.dataset.tooltip).toBe('create:preset.id');

    fireEvent.change(dialog.querySelector('input[name="code"]')!, {
      target: { value: 'preset-new' },
    });
    fireEvent.change(dialog.querySelector('input[name="name"]')!, {
      target: { value: '预设新' },
    });
    fireEvent.submit(dialog);

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        version: '1.0.0',
        id: 'preset-new',
        name: '预设新',
        requires: [],
        tags: [],
      }),
    );
    expect(mocks.setItem).toHaveBeenCalledWith('preset-new');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.success).toHaveBeenCalledWith('message.create.success');
  });

  it('点击删除应当删除当前预设再刷新，并选中剩下的第一条', async () => {
    usePresetState.setState({ item: PRESETS[1] as any, items: PRESETS as any });

    render(<Content />);
    fireEvent.click(q('[data-delete="preset.id"]'));

    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith('preset-b'),
    );
    expect(mocks.success).toHaveBeenCalledWith('message.delete.success');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    // 删除后回到列表首项
    expect(mocks.setItem).toHaveBeenCalledWith('preset-a');
  });
});

describe('presets client content / 标签页与属性表单', () => {
  it('点击标签应当切换 tab 并渲染对应内容', async () => {
    usePresetState.setState({ item: PRESETS[0] as any, items: PRESETS as any });

    render(<Content />);
    expect(q('[data-tab="property"]').dataset.active).toBe('true');

    fireEvent.click(q('[data-tab="entries"]'));

    await waitFor(() => expect(mocks.setTab).toHaveBeenCalledWith('entries'));
    expect(usePresetState.getState().tab).toBe('entries');
    expect(q('[data-tab-content="entries"]')).toBeTruthy();
    expect(q('[data-tab="entries"]').dataset.active).toBe('true');
    // 切走之后属性表单不再渲染
    expect(document.querySelector('[data-update-form="true"]')).toBeNull();
  });

  it('属性表单提交应当按表单装配参数更新预设并刷新', async () => {
    usePresetState.setState({ item: PRESETS[0] as any, items: PRESETS as any });
    // 观察到的现状：更新后选中的是 `presets.proxy.update` 的返回值里的 id，
    // 而不是表单里填的 code（源码：`const { id } = await presets.proxy.update(...)` 后 `setItem(id)`）
    mocks.update.mockResolvedValue({ id: 'preset-a2' });

    render(<Content />);
    const form = q('[data-update-form="true"]') as HTMLFormElement;

    fireEvent.change(form.querySelector('input[name="code"]')!, {
      target: { value: 'preset-a2' },
    });
    fireEvent.change(form.querySelector('input[name="name"]')!, {
      target: { value: '预设甲改' },
    });
    fireEvent.change(form.querySelector('textarea[name="description"]')!, {
      target: { value: 'desc-new' },
    });
    fireEvent.change(form.querySelector('textarea[name="opening"]')!, {
      target: { value: 'opening-new' },
    });
    fireEvent.change(form.querySelector('input[name="version"]')!, {
      target: { value: '2.0.0' },
    });
    fireEvent.change(form.querySelector('input[name="cover_src"]')!, {
      target: { value: 'cover-src-9' },
    });
    fireEvent.change(form.querySelector('[data-editor="variables"]')!, {
      target: { value: '{"b":2}' },
    });

    fireEvent.submit(form);

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith('preset-a', {
        id: 'preset-a2',
        name: '预设甲改',
        cover: 'file-id-9',
        version: '2.0.0',
        description: 'desc-new',
        opening: 'opening-new',
        variables: { b: 2 },
        requires: [],
        tags: ['tag-1'],
      }),
    );
    // cover 走的是 ImageUploader 的 getImageFileId(data, 'cover_src')
    expect(mocks.getImageFileId).toHaveBeenCalledTimes(1);
    expect(mocks.getImageFileId.mock.calls[0][1]).toBe('cover_src');
    expect(mocks.validJsonOrEmpty).toHaveBeenCalledWith('{"b":2}');
    expect(mocks.success).toHaveBeenCalledWith('message.update.success');
    // 选中「更新接口返回的 id」（见用例开头的说明），再刷新详情
    expect(mocks.setItem).toHaveBeenCalledWith('preset-a2');
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
