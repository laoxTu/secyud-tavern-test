import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// content.tsx 只通过 barrel 取展示组件与 preset/条目状态，
// 真实 @/components 会加载 monaco，真实 @/presets/client 会串起全部 preset 子模块，
// 这里都换成最小桩，只保留「表单字段 → 匹配器 configureObject → presets.proxy.entry.set → refresh」这条链路。
const mocks = vi.hoisted(() => ({
  entrySet: vi.fn(),
  refresh: vi.fn(async () => {}),
  success: vi.fn(),
  /** 当前渲染用的 store 数据 */
  preset: null as any,
  entry: null as any,
  matchers: [] as any[],
  /** 最近一次表单的 onSubmit（用例可直接驱动错误分支） */
  submit: null as any,
  pending: null as any,
}));

vi.mock('@/components', () => {
  const pick = (props: any, keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, props[key]]));

  return {
    rowFull: 'row-full',
    spanHalf: 'span-half',
    Field: ({ children }: any) =>
      React.createElement('div', { 'data-field': 'true' }, children),
    FieldLabel: ({ children, ...props }: any) =>
      React.createElement(
        'label',
        { 'data-label': 'true', ...pick(props, ['htmlFor', 'id']) },
        children,
      ),
    Input: ({ name, ...props }: any) =>
      React.createElement('input', {
        'data-input': name,
        name,
        ...pick(props, ['defaultValue', 'type', 'id', 'min', 'max']),
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
    // 真实实现把内容放在自己的 state 里，再写进同名的 hidden input 交给 FormData；
    // hidden input 在 React 下没法用 fireEvent 驱动，所以这里换成一个同样进 FormData 的 textarea
    MonacoEditor: ({ name, value, language }: any) => {
      const [content, setContent] = React.useState(value ?? '');
      return React.createElement('textarea', {
        'data-editor': name,
        'data-language': language,
        name,
        value: content,
        onChange: (e: any) => setContent(e.target.value),
      });
    },
    element: (Component: any, props?: any) =>
      Component ? React.createElement(Component, props) : null,
    UpdateForm: ({ children, form, onSubmit }: any) => {
      mocks.submit = onSubmit;
      return React.createElement(
        'form',
        {
          'data-update-form': 'true',
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

vi.mock('@/presets/client', () => ({
  usePresetState: () => ({ item: mocks.preset }),
  presets: { proxy: { entry: { set: mocks.entrySet } } },
  PresetEntryList: ({ children }: any) =>
    React.createElement(
      'div',
      { 'data-list': 'true' },
      children(mocks.entry),
    ),
  PresetEntryUpdate: ({ children }: any) =>
    React.createElement('div', { 'data-entry-update': 'true' }, children),
}));

vi.mock('@/presets/client/factory', () => ({
  createPresetEntryState: () => () => ({ refresh: mocks.refresh }),
}));

vi.mock('@/lorebooks/client', () => ({
  lorebooks: {
    matchers: {
      registry: {
        record: (id?: string) => mocks.matchers.find((u) => u.id === id),
        sorted: () => mocks.matchers,
      },
    },
  },
}));

import { Content, tab } from '@/lorebooks/client/content';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./content.cases.json')).default);
}

function createMatcher(id: string, configureObject?: any) {
  return {
    id,
    configureObject: configureObject ?? vi.fn(async () => {}),
    configComponent: undefined as any,
  };
}

function selectorOf(name: string) {
  const el = document.querySelector(`[data-selector="${name}"]`);
  if (!el) throw new Error(`找不到选择器: ${name}`);
  return el as HTMLSelectElement;
}

function editorOf(name = 'content') {
  const el = document.querySelector(`[data-editor="${name}"]`);
  if (!el) throw new Error(`找不到编辑器: ${name}`);
  return el as HTMLTextAreaElement;
}

function inputOf(name: string) {
  const el = document.querySelector(`[data-input="${name}"]`);
  if (!el) throw new Error(`找不到输入框: ${name}`);
  return el as HTMLInputElement;
}

function fill(el: Element, value: string | number) {
  fireEvent.change(el, { target: { value: String(value) } });
}

function updateForm() {
  const el = document.querySelector('[data-update-form="true"]');
  if (!el) throw new Error('找不到条目表单');
  return el as HTMLFormElement;
}

/** 渲染出条目编辑器 */
function renderEditor(entry: any, matchers: any[] = [createMatcher('always')]) {
  mocks.matchers = matchers;
  mocks.entry = entry;
  render(<Content />);
  return matchers;
}

beforeEach(() => {
  vi.resetAllMocks();
  document.body.innerHTML = '';
  mocks.preset = null;
  mocks.entry = null;
  mocks.matchers = [];
  mocks.submit = null;
  mocks.pending = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lorebooks content / 导出的页签描述', () => {
  it('id、label 与内容组件应当与模块一致', () => {
    expect(tab.id).toBe('lorebook');
    expect(tab.label).toBe('lorebook.id');
    expect(tab.hidable).toBe(true);
    expect(tab.content).toBe(Content);
    expect(tab.icon).toBeTruthy();
  });
});

describe('lorebooks content / 列表', () => {
  it('没有选中预设时不渲染条目列表', async () => {
    const data = await loadCases();
    mocks.matchers = [createMatcher('always')];
    mocks.preset = null;
    mocks.entry = data.entry;

    render(<Content />);

    expect(document.querySelector('[data-list="true"]')).toBeNull();
    expect(document.querySelector('[data-update-form="true"]')).toBeNull();
  });

  it('选中预设时应当把条目交给条目更新器', async () => {
    const data = await loadCases();
    mocks.preset = data.preset;
    renderEditor(data.entry);

    expect(document.querySelector('[data-list="true"]')).toBeTruthy();
    expect(document.querySelector('[data-entry-update="true"]')).toBeTruthy();
    expect(editorOf().value).toBe(data.entry.data.content);
  });
});

describe('lorebooks content / 编辑器默认值', () => {
  it('字段默认值应当来自条目数据', async () => {
    const data = await loadCases();
    mocks.preset = data.preset;
    renderEditor(data.entry);

    const { data: entryData } = data.entry;
    expect(editorOf().value).toBe(entryData.content);
    expect(editorOf().getAttribute('data-language')).toBe(entryData.type);
    expect(inputOf('code').value).toBe(entryData.code);
    expect(inputOf('name').value).toBe(data.entry.name);
    expect(inputOf('priority').value).toBe(String(entryData.priority));
    expect(inputOf('layer').value).toBe(String(entryData.layer));
    expect(selectorOf('role').value).toBe(entryData.role);
    expect(selectorOf('type').value).toBe(entryData.type);
    // 匹配器选择器的 option 走 valueAccessor
    expect(selectorOf('matchType').value).toBe(entryData.match);
  });

  it('切换内容类型时编辑器语言应当跟随变化', async () => {
    const data = await loadCases();
    mocks.preset = data.preset;
    renderEditor(data.entry);

    fill(selectorOf('type'), data.edited.type);

    expect(editorOf().getAttribute('data-language')).toBe(data.edited.type);
  });

  it('匹配器的配置组件应当拿到当前条目', async () => {
    const data = await loadCases();
    const matcher = createMatcher('always');
    matcher.configComponent = ({ entry }: any) =>
      React.createElement(
        'span',
        { 'data-matcher-config': 'true' },
        String(entry.entryId),
      );

    mocks.preset = data.preset;
    renderEditor(data.entry, [matcher]);

    expect(
      document.querySelector('[data-matcher-config="true"]')?.textContent,
    ).toBe(String(data.entry.entryId));
  });
});

describe('lorebooks content / 表单提交', () => {
  it('提交时应当按表单装配条目、请求更新并刷新列表', async () => {
    const data = await loadCases();
    const matcher = createMatcher('always');
    mocks.preset = data.preset;
    renderEditor(data.entry, [matcher]);

    fill(editorOf(), data.edited.content);
    fill(inputOf('code'), data.edited.code);
    fill(inputOf('name'), data.edited.name);
    fill(inputOf('priority'), data.edited.priority);
    fill(inputOf('layer'), data.edited.layer);
    fill(selectorOf('role'), data.edited.role);
    fill(selectorOf('type'), data.edited.type);

    fireEvent.submit(updateForm());
    await mocks.pending;

    expect(mocks.entrySet).toHaveBeenCalledTimes(1);
    const [masterId, entryType, entryId, payload] = mocks.entrySet.mock.calls[0];
    expect(masterId).toBe(data.entry.masterId);
    expect(entryType).toBe(data.entry.entryType);
    expect(entryId).toBe(data.entry.entryId);
    expect(payload).toEqual({
      name: data.edited.name,
      data: {
        match: matcher.id,
        content: data.edited.content,
        type: data.edited.type,
        expression: {},
        role: data.edited.role,
        code: data.edited.code,
        priority: data.edited.priority,
        layer: data.edited.layer,
      },
    });

    // 匹配器钩子拿到的是同一个 FormData 与同一个待提交对象
    expect(matcher.configureObject).toHaveBeenCalledTimes(1);
    expect(matcher.configureObject.mock.calls[0][0]).toBeInstanceOf(FormData);
    expect(matcher.configureObject.mock.calls[0][1]).toBe(payload.data);

    // 先提交再刷新，最后提示
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.entrySet.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0],
    );
    expect(mocks.success).toHaveBeenCalledWith('message.update.success');
  });

  it('匹配器的 configureObject 可以改写条目数据', async () => {
    const data = await loadCases();
    const matcher = createMatcher(
      'always',
      vi.fn(async (_formData: FormData, lorebook: any) => {
        lorebook.expression = structuredClone(data.configured);
      }),
    );
    mocks.preset = data.preset;
    renderEditor(data.entry, [matcher]);

    fireEvent.submit(updateForm());
    await mocks.pending;

    const payload = mocks.entrySet.mock.calls[0][3];
    expect(payload.data.expression).toEqual(data.configured);
    expect(matcher.configureObject.mock.calls[0][1]).toBe(payload.data);
  });

  it('json 类型的空内容视为合法', async () => {
    const data = await loadCases();
    const matcher = createMatcher('always');
    mocks.preset = data.preset;
    renderEditor(data.emptyJsonEntry, [matcher]);

    fireEvent.submit(updateForm());
    await mocks.pending;

    const payload = mocks.entrySet.mock.calls[0][3];
    expect(payload.data.type).toBe(data.emptyJsonEntry.data.type);
    expect(payload.data.content).toBe('');
    expect(mocks.success).toHaveBeenCalledWith('message.update.success');
  });

  it('json 类型的合法内容应当原样提交', async () => {
    const data = await loadCases();
    const matcher = createMatcher('always');
    mocks.preset = data.preset;
    renderEditor(data.validJsonEntry, [matcher]);

    fireEvent.submit(updateForm());
    await mocks.pending;

    const payload = mocks.entrySet.mock.calls[0][3];
    expect(payload.data.content).toBe(data.validJsonEntry.data.content);
    expect(mocks.entrySet).toHaveBeenCalledTimes(1);
  });

  it('json 类型内容非法时应当报错且不提交', async () => {
    const data = await loadCases();
    const matcher = createMatcher('always');
    mocks.preset = data.preset;
    renderEditor(data.jsonEntry, [matcher]);
    // jsonUtils.parse 失败会打 warn，这里只是消音
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    fireEvent.submit(updateForm());

    await expect(mocks.pending).rejects.toMatchObject({
      message: 'Json is invalid',
      code: 'error.json_invalid',
    });
    expect(matcher.configureObject).not.toHaveBeenCalled();
    expect(mocks.entrySet).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('条目的匹配器已经不存在时不应该提交', async () => {
    const data = await loadCases();
    mocks.preset = data.preset;
    renderEditor(data.ghostEntry, [createMatcher('always')]);

    await mocks.submit(new FormData());

    expect(mocks.entrySet).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
