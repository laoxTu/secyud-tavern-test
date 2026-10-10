import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useElicitState } from '@/tools/elicits/client/states';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./states.cases.json')).default);
}

/** json 表达不了函数，reply 由用例补上 */
function createItem(item: any) {
  return { ...item, reply: vi.fn(async () => {}) };
}

beforeEach(() => {
  useElicitState.setState({ render: 0, items: [], item: null });
});

describe('tools elicits states / 初始状态', () => {
  it('初始值应当是没有当前项的空队列，渲染计数为 0', () => {
    const initial = useElicitState.getInitialState();

    expect(initial.render).toBe(0);
    expect(initial.items).toEqual([]);
    expect(initial.item).toBeNull();
    expect(typeof initial.pop).toBe('function');
    expect(typeof initial.push).toBe('function');
  });
});

describe('tools elicits states / push', () => {
  it('没有当前项时直接成为当前项并让渲染计数 +1', async () => {
    const data = await loadCases();
    const item = createItem(data.items[0]);

    useElicitState.getState().push(item);

    const state = useElicitState.getState();
    expect(state.item).toBe(item);
    expect(state.render).toBe(1);
    // 直接展示的那一项不进队列
    expect(state.items).toEqual([]);
  });

  it('已有当前项时入队，当前项与渲染计数都不变', async () => {
    const data = await loadCases();
    const first = createItem(data.items[0]);
    const second = createItem(data.items[1]);
    useElicitState.getState().push(first);
    const before = useElicitState.getState().render;

    useElicitState.getState().push(second);

    const state = useElicitState.getState();
    expect(state.item).toBe(first);
    expect(state.items).toEqual([second]);
    expect(state.render).toBe(before);
  });

  it('连续 push 时按进入顺序排队', async () => {
    const data = await loadCases();
    const list = data.items.map((u: any) => createItem(u));

    for (const item of list) useElicitState.getState().push(item);

    expect(useElicitState.getState().item).toBe(list[0]);
    expect(useElicitState.getState().items).toEqual(list.slice(1));
    expect(useElicitState.getState().render).toBe(1);
  });
});

describe('tools elicits states / pop', () => {
  it('取出队首成为当前项并让渲染计数 +1', async () => {
    const data = await loadCases();
    const first = createItem(data.items[0]);
    const second = createItem(data.items[1]);
    useElicitState.getState().push(first);
    useElicitState.getState().push(second);
    const before = useElicitState.getState().render;

    useElicitState.getState().pop();

    const state = useElicitState.getState();
    expect(state.item).toBe(second);
    expect(state.items).toEqual([]);
    expect(state.render).toBe(before + 1);
  });

  it('队列为空时把当前项置空，渲染计数照样 +1', async () => {
    const data = await loadCases();
    useElicitState.getState().push(createItem(data.items[0]));

    useElicitState.getState().pop();

    const state = useElicitState.getState();
    expect(state.item).toBeNull();
    expect(state.items).toEqual([]);
    expect(state.render).toBe(2);
  });

  it('push / pop 交替时按先进先出消费', async () => {
    const data = await loadCases();
    const list = data.items.map((u: any) => createItem(u));
    for (const item of list) useElicitState.getState().push(item);

    const consumed: any[] = [];
    while (useElicitState.getState().item) {
      consumed.push(useElicitState.getState().item);
      useElicitState.getState().pop();
    }

    expect(consumed).toEqual(list);
    // 1 次直接展示 + 3 次 pop
    expect(useElicitState.getState().render).toBe(4);
  });
});
