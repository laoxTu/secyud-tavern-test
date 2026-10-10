import { beforeEach, describe, expect, it } from 'vitest';

import { useGlobalState } from '@/global/client/state';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./state.cases.json')).default);
}

/**
 * 模块加载时的状态快照：此时 localStorage 还是空的，
 * persist 同步 rehydrate 出来的就是源码里的默认值
 */
const initial = useGlobalState.getState();

beforeEach(() => {
  useGlobalState.setState({ menu: undefined, open: true });
});

describe('global client state / 默认值', () => {
  it('菜单未选中、侧边栏默认展开', () => {
    expect(initial.menu).toBeUndefined();
    expect(initial.open).toBe(true);
    expect(typeof initial.setMenu).toBe('function');
    expect(typeof initial.setOpen).toBe('function');
  });

  it('setMenu 写入菜单 id，传 undefined 可清空', async () => {
    const data = await loadData();

    useGlobalState.getState().setMenu(data.menu);
    expect(useGlobalState.getState().menu).toBe(data.menu);

    useGlobalState.getState().setMenu(data.anotherMenu);
    expect(useGlobalState.getState().menu).toBe(data.anotherMenu);

    useGlobalState.getState().setMenu(undefined);
    expect(useGlobalState.getState().menu).toBeUndefined();
  });

  it('setOpen 切换展开状态', () => {
    useGlobalState.getState().setOpen(false);
    expect(useGlobalState.getState().open).toBe(false);

    useGlobalState.getState().setOpen(true);
    expect(useGlobalState.getState().open).toBe(true);
  });
});

describe('global client state / 持久化', () => {
  it('持久化键是 global，partialize 只保留 menu 与 open', async () => {
    const data = await loadData();
    const options = useGlobalState.persist.getOptions();

    expect(options.name).toBe(data.persist.name);

    const partial = (options.partialize as any)({
      menu: data.menu,
      open: false,
      setMenu: () => {},
      setOpen: () => {},
    });
    expect(Object.keys(partial).sort()).toEqual(data.persist.partialKeys);
    expect(partial).toEqual({ menu: data.menu, open: false });
  });

  it('set 之后应当把裁剪过的状态写进 localStorage', async () => {
    const data = await loadData();

    useGlobalState.getState().setMenu(data.menu);
    useGlobalState.getState().setOpen(false);

    const raw = window.localStorage.getItem(data.persist.name);
    expect(raw).toBeTruthy();

    const persisted = JSON.parse(raw!);
    // setMenu / setOpen 这类 setter 不该被持久化
    expect(persisted.state).toEqual({ menu: data.menu, open: false });
  });
});
