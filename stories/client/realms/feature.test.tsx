/**
 * 展示层用例：src/stories/client/realms/feature.tsx
 *
 * 只跑主线：挂载不炸 → 点击动作 → 断言 realms.* / useRealmState 收到了什么。
 *
 * 真实的 `@/components` 桶会拉起 monaco（jsdom 下极慢甚至 OOM），
 * 因此按 feature.tsx 那一行 import 用到的导出名给具名最小桩；
 * `dialogs.info` / `useRefresh` / `useFormRef` 被当普通函数/对象用，单独给最小实现。
 * 注：这里不用 Proxy 全量桩 —— vitest 的 mock 包装层遇到"未定义的导出名"会直接抛错。
 * `@/stories/client/realms`（realms + useRealmState）、`@/stories/client`、`@/models/client`、
 * `@/global`、`@/utils`、`@/interceptors*`、`next-intl`、`next/navigation` 全部最小桩，
 * 保证观察到的调用都来自被测组件本身。
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 用例与各 mock 共享的可变状态（vi.mock 工厂会被提升，所以先 hoisted） */
const mocks = vi.hoisted(() => {
  const histories: any[] = [];
  const realm: any = { id: 'realm-1', histories };
  return {
    realm,
    histories,
    /** useRealmState 暴露的页索引 */
    index: { cur: 1, max: 3 },
    content: 'typed-input',
    generate: vi.fn(async () => {}),
    variables: vi.fn(() => ({ app: 'value' })),
    historyGet: vi.fn(async () => null as any),
    historySet: vi.fn(async () => {}),
    setIndex: vi.fn(async () => {}),
    refreshKey: vi.fn(),
    /** handler 吞掉的错误集中在这里，便于排查 */
    handlerError: vi.fn(),
    prompt: vi.fn(async () => ({ summaries: [] as any[] })),
    routerReplace: vi.fn(),
    clone: vi.fn(async () => ({ id: 'clone-1' })),
    del: vi.fn(async () => {}),
    /** TooltipDialog/TooltipAlertDialog 桩提交时回传给 onSubmit 的"表单数据" */
    formData: {} as Record<string, any>,
  };
});

vi.mock('@/components', () => {
  const stub = (name: string) =>
    function Stub(props: any) {
      return React.createElement(
        'div',
        { 'data-stub': name },
        props?.children,
      );
    };

  const special: Record<string, any> = {
    // dialogs.info(t, key) 被当普通函数调用
    dialogs: { info: (_t: any, key: string) => ({ key }) },
    useFormRef: () => ({ current: null }),
    useRefresh: () => ({ key: 0, refreshKey: mocks.refreshKey }),
    submitTargetFormOnKey: () => {},
    Textarea: (props: any) =>
      React.createElement('textarea', {
        name: props?.name,
        id: props?.id,
        defaultValue: props?.defaultValue,
      }),
    IconTooltip: (props: any) =>
      React.createElement(
        'button',
        {
          'data-stub': 'IconTooltip',
          'data-disabled': String(props?.disabled),
          onClick: props?.onClick,
        },
        props?.children,
      ),
    TooltipAlertDialog: (props: any) =>
      React.createElement(
        'div',
        {
          'data-stub': 'TooltipAlertDialog',
          'data-disabled': String(props?.disabled),
        },
        React.createElement('button', {
          'data-action': 'submit',
          onClick: () => props?.onSubmit?.(mocks.formData),
        }),
        props?.children,
      ),
    TooltipDialog: (props: any) =>
      React.createElement(
        'div',
        {
          'data-stub': 'TooltipDialog',
          'data-disabled': String(props?.disabled),
        },
        React.createElement('button', {
          'data-action': 'open',
          onClick: () => props?.onOpen?.(mocks.formData),
        }),
        React.createElement('button', {
          'data-action': 'submit',
          onClick: () => props?.onSubmit?.(mocks.formData),
        }),
        props?.children,
      ),
  };

  // 注意：vitest 的 mock 包装层会对"未定义的导出名"直接抛错，
  // 所以这里必须把 feature.tsx 真正用到的导出名列全（仍然全部是同一套 Proxy 桩的等价物，
  // 不会因此加载 monaco）。
  const names = [
    'Accordion',
    'AccordionContent',
    'AccordionItem',
    'AccordionTrigger',
    'Card',
    'CardContent',
    'CardHeader',
    'Field',
    'FieldGroup',
    'FieldLabel',
    'FieldSet',
    'IconTooltip',
    'MonacoEditor',
    'Skeleton',
    'Textarea',
    'TooltipAlertDialog',
    'TooltipDialog',
  ];
  const exported: Record<string, any> = Object.fromEntries(
    names.map((name) => [name, stub(name)]),
  );
  for (const [name, value] of Object.entries(special)) {
    exported[name] = value;
  }
  return exported;
});

vi.mock('@/stories/client/realms', () => {
  const useRealmState: any = () => ({
    index: mocks.index,
    setIndex: mocks.setIndex,
    content: mocks.content,
  });
  useRealmState.getState = () => ({
    index: mocks.index,
    setIndex: mocks.setIndex,
    content: mocks.content,
  });
  return {
    useRealmState,
    realms: {
      realm: mocks.realm,
      histories: mocks.histories,
      variables: mocks.variables,
      generate: mocks.generate,
      history: { get: mocks.historyGet, set: mocks.historySet },
    },
  };
});

vi.mock('@/stories/client', () => ({
  stories: {
    proxy: {
      clone: mocks.clone,
      delete: mocks.del,
      history: { del: mocks.del },
    },
  },
}));

vi.mock('@/stories', () => ({}));

vi.mock('@/models/client', () => ({
  models: { processers: { prompt: mocks.prompt } },
}));

vi.mock('@/global', () => ({
  forms: { str: (data: any, name: string) => data?.[name] ?? '' },
}));

vi.mock('@/utils', () => ({
  jsonUtils: {
    parse: (text: string) => {
      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    },
  },
}));

vi.mock('@/interceptors', () => ({
  BusinessError: class BusinessError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'BusinessError';
    }
    withValue() {
      return this;
    }
  },
}));

vi.mock('@/interceptors/client', () => ({
  error: mocks.handlerError,
  success: vi.fn(),
  // 与真实实现同形：action 之后一定跑 finish（Viewer 用它关 loading），错误进 spy
  handler:
    (action: any, finish?: any) =>
    async (...args: any[]) => {
      try {
        return await action(...args);
      } catch (err) {
        mocks.handlerError(err);
      } finally {
        await finish?.(...args);
      }
    },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.routerReplace }),
}));

vi.mock('lucide-react', () => {
  const icon = (name: string) => () =>
    React.createElement('span', { 'data-icon': name });
  return {
    DeleteIcon: icon('DeleteIcon'),
    EditIcon: icon('EditIcon'),
    MessageSquarePlusIcon: icon('MessageSquarePlusIcon'),
    MessageSquareXIcon: icon('MessageSquareXIcon'),
    RotateCcwIcon: icon('RotateCcwIcon'),
    TrashIcon: icon('TrashIcon'),
    ViewIcon: icon('ViewIcon'),
  };
});

import { feature } from '@/stories/client/realms/feature';

function componentOf(id: string): React.ComponentType {
  const item = feature.find((u) => u.id === id);
  if (!item) throw new Error(`feature "${id}" not found`);
  return item.component as unknown as React.ComponentType;
}

/** 一页索引为 1 的历史（1 个输入、1 个输出） */
function makeHistory() {
  return {
    masterId: 'realm-1',
    sequence: 0,
    output: 0,
    prompts: [{ content: 'prompt-0', variables: [], properties: {} }],
    outputs: [[{ content: 'output-0', variables: [], properties: {} }]],
    summary: false,
    variables: {},
  };
}

function clickAction(action: 'open' | 'submit', index = 0) {
  const nodes = document.querySelectorAll(`button[data-action="${action}"]`);
  fireEvent.click(nodes[index]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.histories.length = 0;
  mocks.index.cur = 1;
  mocks.index.max = 3;
  mocks.content = 'typed-input';
  mocks.formData = {};
  mocks.variables.mockReturnValue({ app: 'value' });
  mocks.historyGet.mockResolvedValue(makeHistory());
  mocks.historySet.mockResolvedValue(undefined);
  mocks.generate.mockResolvedValue(undefined);
  mocks.setIndex.mockResolvedValue(undefined);
  mocks.prompt.mockResolvedValue({ summaries: [] });
});

afterEach(cleanup);

describe('realms feature / 模块导出', () => {
  it('导出四个工具位，id 与 sequence 是当前实现里的常量', () => {
    expect(feature.map((u) => u.id)).toEqual([
      'deleter',
      'regenerator',
      'context-viewer',
      'history-editor',
    ]);
    for (const item of feature) {
      expect(item.sequence, item.id).toBe(1000);
      expect(typeof item.component, item.id).toBe('function');
    }
  });
});

describe('realms feature / Deleter', () => {
  it('挂载后渲染四个对话框动作，cur=1 时都可用；cur=0 时全部禁用', () => {
    mocks.histories.push(makeHistory());
    const Deleter = componentOf('deleter');

    const { container, rerender } = render(<Deleter />);

    const dialogsAt = () =>
      container.querySelectorAll('[data-stub="TooltipAlertDialog"]');
    expect(dialogsAt()).toHaveLength(4);
    for (const node of dialogsAt()) {
      expect(node.getAttribute('data-disabled')).toBe('false');
    }

    mocks.index.cur = 0;
    rerender(<Deleter />);
    for (const node of dialogsAt()) {
      expect(node.getAttribute('data-disabled')).toBe('true');
    }
  });

  it('点击"删除输出"：先 get(index.cur) 再 set(index.cur) 并 setIndex()', async () => {
    // 关键：histories 里放的必须就是 history.get 返回的同一个对象，
    // 否则组件改的是另一个副本，断言会看错对象。
    const history = makeHistory();
    mocks.histories.push(history);
    mocks.historyGet.mockResolvedValue(history);
    const Deleter = componentOf('deleter');

    render(<Deleter />);
    // 第一个提交按钮对应 info('realm.delete.output')
    clickAction('submit', 0);

    await waitFor(() => expect(mocks.historySet).toHaveBeenCalled());
    // 观察到：get/set 的入参都是 (当前页, realm)
    expect(mocks.historyGet).toHaveBeenCalledWith(1, mocks.realm);
    expect(mocks.historySet).toHaveBeenCalledWith(1, mocks.realm);
    expect(mocks.setIndex).toHaveBeenCalled();
    // 输出被就地删除（当前实现不通过 proxy 落盘，只 set 整页）
    expect(history.outputs).toHaveLength(0);
    expect(mocks.handlerError).not.toHaveBeenCalled();
  });
});

describe('realms feature / Regenerator', () => {
  it('index.max>0 时可点击，点击调用 realms.generate()', async () => {
    const Regenerator = componentOf('regenerator');

    const { container, rerender } = render(<Regenerator />);
    const button = () =>
      container.querySelector('button[data-stub="IconTooltip"]')!;

    expect(button().getAttribute('data-disabled')).toBe('false');

    mocks.index.max = 0;
    rerender(<Regenerator />);
    expect(button().getAttribute('data-disabled')).toBe('true');

    mocks.index.max = 3;
    rerender(<Regenerator />);
    fireEvent.click(button());

    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    expect(mocks.generate).toHaveBeenCalledWith();
  });
});

describe('realms feature / Viewer', () => {
  it('打开时用"虚拟待发历史"调用 models.processers.prompt，并渲染摘要', async () => {
    mocks.histories.push(makeHistory());
    mocks.prompt.mockResolvedValue({
      summaries: [{ role: 'user', content: 'abcdef' }],
    });
    const Viewer = componentOf('context-viewer');

    render(<Viewer />);
    clickAction('open');

    await waitFor(() => expect(mocks.prompt).toHaveBeenCalledTimes(1));
    const arg = (mocks.prompt.mock.calls[0] as unknown[])[0] as any;

    expect(arg.current).toBe(false);
    expect(arg.controller).toBeInstanceOf(AbortController);
    // realm 被复制并追加了一条"虚拟历史"
    expect(arg.realm.id).toBe('realm-1');
    expect(arg.realm.histories).toHaveLength(mocks.histories.length + 1);
    expect(arg.realm.histories.at(-1).prompts[0].content).toBe('typed-input');
    // 输入框内容来自 useRealmState.getState().content
    expect(mocks.content).toBe('typed-input');

    await waitFor(() => expect(screen.getByText('user')).toBeTruthy());
    expect(screen.getByText('default.chars: 6')).toBeTruthy();
  });
});

describe('realms feature / Editor', () => {
  it('打开时 get(index.cur) 并 refreshKey()，随后渲染输入/输出文本框', async () => {
    mocks.histories.push(makeHistory());
    const Editor = componentOf('history-editor');

    render(<Editor />);
    clickAction('open');

    await waitFor(() =>
      expect(mocks.historyGet).toHaveBeenCalledWith(1, mocks.realm),
    );
    expect(mocks.refreshKey).toHaveBeenCalled();

    await waitFor(() =>
      expect(
        document.querySelector('textarea[name="history_input-0"]'),
      ).toBeTruthy(),
    );
    expect(
      (
        document.querySelector(
          'textarea[name="history_input-0"]',
        ) as HTMLTextAreaElement | null
      )?.defaultValue,
    ).toBe('prompt-0');
    expect(
      (
        document.querySelector(
          'textarea[name="history_output-0-0"]',
        ) as HTMLTextAreaElement | null
      )?.defaultValue,
    ).toBe('output-0');
  });

  it('提交时把表单值写回 history，再 set(index.cur) 与 setIndex()', async () => {
    mocks.histories.push(makeHistory());
    mocks.formData = {
      variables: '{"b":2}',
      'history_input-0': 'edited-content',
      'history_output-0-0': 'edited-output',
    };
    const Editor = componentOf('history-editor');
    const history = makeHistory();
    mocks.historyGet.mockResolvedValue(history);

    render(<Editor />);
    clickAction('open');
    await waitFor(() =>
      expect(mocks.historyGet).toHaveBeenCalledWith(1, mocks.realm),
    );

    clickAction('submit');

    await waitFor(() => expect(mocks.historySet).toHaveBeenCalled());
    expect(history.variables).toEqual({ b: 2 });
    expect(history.prompts[0].content).toBe('edited-content');
    expect(history.outputs[0][0].content).toBe('edited-output');
    expect(mocks.historySet).toHaveBeenCalledWith(1, mocks.realm);
    expect(mocks.setIndex).toHaveBeenCalled();
  });

  it('变量不是合法 JSON 时提交中断，不写回 history', async () => {
    mocks.histories.push(makeHistory());
    mocks.formData = { variables: '{not json', 'history_input-0': 'edited' };
    const Editor = componentOf('history-editor');
    const history = makeHistory();
    mocks.historyGet.mockResolvedValue(history);

    render(<Editor />);
    clickAction('open');
    await waitFor(() =>
      expect(mocks.historyGet).toHaveBeenCalledWith(1, mocks.realm),
    );

    clickAction('submit');

    // 抛出的 BusinessError 被 handler 收进 spy，提交在这里中断
    await waitFor(() => expect(mocks.handlerError).toHaveBeenCalledTimes(1));
    const error = mocks.handlerError.mock.calls[0][0] as Error;
    expect(error.name).toBe('BusinessError');
    expect(error.message).toBe('json invalid');
    // 后续的输入覆盖与落盘都不会发生
    expect(history.prompts[0].content).toBe('prompt-0');
    expect(mocks.historySet).not.toHaveBeenCalled();
    expect(mocks.setIndex).not.toHaveBeenCalled();
  });

  it('index.cur=0 时打开与提交都提前返回，不碰 realms', async () => {
    mocks.histories.push(makeHistory());
    mocks.index.cur = 0;
    const Editor = componentOf('history-editor');

    const { container } = render(<Editor />);
    expect(
      container
        .querySelector('[data-stub="TooltipDialog"]')!
        .getAttribute('data-disabled'),
    ).toBe('true');

    clickAction('submit');

    await Promise.resolve();
    expect(mocks.historyGet).not.toHaveBeenCalled();
    expect(mocks.historySet).not.toHaveBeenCalled();
    expect(mocks.setIndex).not.toHaveBeenCalled();
  });
});
