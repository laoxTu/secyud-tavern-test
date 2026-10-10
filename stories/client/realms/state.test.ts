import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessError } from '@/interceptors';

const mocks = vi.hoisted(() => ({
  historyGet: vi.fn(),
  historySet: vi.fn(),
  historyAdd: vi.fn(),
  stream: vi.fn(),
  generate: vi.fn(),
  output: vi.fn(),
  modelGet: vi.fn(),
  convert: vi.fn(),
}));

// state 通过 realms 单例读历史 / 拉取某一段，这里替换它依赖的桶入口，
// realms 本体走真实实现；models 桶只是被 realms 连带加载，整体替换掉。
vi.mock('@/stories/client', () => ({
  stories: {
    proxy: {
      history: {
        get: mocks.historyGet,
        set: mocks.historySet,
        add: mocks.historyAdd,
      },
    },
    renderers: { stream: mocks.stream },
  },
}));
vi.mock('@/models/client', () => ({
  models: {
    processers: { generate: mocks.generate, output: mocks.output },
    proxy: { get: mocks.modelGet },
    convert: mocks.convert,
  },
}));

import { realms } from '@/stories/client/realms';
import { useRealmState } from '@/stories/client/realms/state';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./state.cases.json')).default);
}

/** 把 realm 挂到单例上；历史数组单独传，便于按用例定制 */
function setupRealm(data: any, histories: any[] = []) {
  const realm = structuredClone(data.realm);
  realm.histories = histories;
  realms.realm = realm;
  return realm;
}

const originalDebug = console.debug;
const originalLog = console.log;

beforeEach(() => {
  vi.resetAllMocks();
  console.debug = () => {};
  console.log = () => {};
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
});

afterEach(() => {
  console.debug = originalDebug;
  console.log = originalLog;
});

describe('stories realms state / 初始值', () => {
  it('默认值应当固定', () => {
    const state = useRealmState.getState();

    expect(state.content).toBe('');
    expect(state.summary).toBe(false);
    expect(state.realmInfos).toEqual({});
    expect(state.generating).toBe(false);
    expect(state.pinned).toBe(true);
    expect(state.prepare).toBe(false);
    expect(state.index).toEqual({ max: 1, cur: 0 });
    expect(state.output).toEqual({ max: 0, cur: -1 });
  });

  it('只把 pinned 持久化到 localStorage', () => {
    const options = (useRealmState as any).persist.getOptions();

    expect(options.name).toBe('realm');
    expect(options.partialize(useRealmState.getState())).toEqual({
      pinned: true,
    });

    useRealmState.getState().setPinned(false);

    expect(JSON.parse(localStorage.getItem('realm')!)).toEqual({
      state: { pinned: false },
      version: 0,
    });
  });
});

describe('stories realms state / 输入与标记', () => {
  it('setContent 支持直接赋值与函数更新', () => {
    useRealmState.getState().setContent('第一段');
    expect(useRealmState.getState().content).toBe('第一段');

    // src 的 RealmState.setContent 只声明了 string，运行时实现同时支持函数式更新
    const setContent = useRealmState.getState().setContent as (
      content: string | ((t: string) => string),
    ) => void;

    setContent((text) => `${text}+第二段`);
    expect(useRealmState.getState().content).toBe('第一段+第二段');
  });

  it('summary / pinned / prepare 可以切换', () => {
    useRealmState.getState().setSummary(true);
    useRealmState.getState().setPinned(false);
    useRealmState.getState().setPrepare(true);

    const state = useRealmState.getState();
    expect(state.summary).toBe(true);
    expect(state.pinned).toBe(false);
    expect(state.prepare).toBe(true);
  });
});

describe('stories realms state / setRealmInfo', () => {
  it('generating 为 false 时不写入', () => {
    useRealmState.getState().setRealmInfo('main', { title: 'realm.thinking' });

    expect(useRealmState.getState().realmInfos).toEqual({});
  });

  it('generating 为 true 时按 name 合并，其它键保留', () => {
    useRealmState.setState({
      generating: true,
      realmInfos: { other: { title: 'keep' } },
    });

    useRealmState
      .getState()
      .setRealmInfo('main', { title: 'realm.thinking', content: '1' });

    expect(useRealmState.getState().realmInfos).toEqual({
      other: { title: 'keep' },
      main: { title: 'realm.thinking', content: '1' },
    });

    useRealmState.getState().setRealmInfo('main', { title: 'realm.generating' });
    expect(useRealmState.getState().realmInfos.main).toEqual({
      title: 'realm.generating',
    });
  });
});

describe('stories realms state / setSignal', () => {
  it('应当设置新信号，传空则清掉', () => {
    const controller = new AbortController();

    useRealmState.getState().setSignal(controller);
    expect(useRealmState.getState().signal).toBe(controller);

    useRealmState.getState().setSignal();
    expect(useRealmState.getState().signal).toBeUndefined();
  });

  it('带 reason 时应当用 BusinessError 中断上一个信号', () => {
    const origin = new AbortController();
    useRealmState.getState().setSignal(origin);

    const next = new AbortController();
    useRealmState.getState().setSignal(next, 'cancel');

    expect(origin.signal.aborted).toBe(true);
    expect(origin.signal.reason).toBeInstanceOf(BusinessError);
    expect((origin.signal.reason as BusinessError).code).toBe('message.cancel');
    expect(useRealmState.getState().signal).toBe(next);
  });

  it('不带 reason 时不应中断上一个信号', () => {
    const origin = new AbortController();
    useRealmState.getState().setSignal(origin);

    const next = new AbortController();
    useRealmState.getState().setSignal(next);

    expect(origin.signal.aborted).toBe(false);
    expect(useRealmState.getState().signal).toBe(next);
  });
});

describe('stories realms state / setIndex', () => {
  it('不传参数时保持当前页，只更新 max 与输出页', async () => {
    const data = await loadCases();
    setupRealm(data, structuredClone(data.histories));

    await useRealmState.getState().setIndex();

    expect(useRealmState.getState().index).toEqual({ max: 2, cur: 0 });
    expect(useRealmState.getState().output).toEqual(data.expected.emptyOutput);
    expect(useRealmState.getState().prepare).toBe(true);
    expect(mocks.historyGet).not.toHaveBeenCalled();
  });

  it('超过 max 时钳到 max，并带上最后一段历史的输出页', async () => {
    const data = await loadCases();
    setupRealm(data, structuredClone(data.histories));

    await useRealmState.getState().setIndex(5);

    expect(useRealmState.getState().index).toEqual({ max: 2, cur: 2 });
    expect(useRealmState.getState().output).toEqual(
      data.expected.lastHistoryOutput,
    );
    expect(mocks.historySet).not.toHaveBeenCalled();
  });

  it('负数钳到 0', async () => {
    const data = await loadCases();
    setupRealm(data, structuredClone(data.histories));

    await useRealmState.getState().setIndex(-3);

    expect(useRealmState.getState().index.cur).toBe(0);
  });

  it('历史里的 output 与目标页不一致时写回服务端', async () => {
    const data = await loadCases();
    const histories = structuredClone(data.histories);
    histories[1].output = data.mismatchOutput;
    const realm = setupRealm(data, histories);

    await useRealmState.getState().setIndex(2);

    const history = realm.histories[1]!;
    expect(useRealmState.getState().output).toEqual(
      data.expected.overriddenOutput,
    );
    expect(history.output).toBe(data.mismatchExpectedCur);
    expect(mocks.historySet).toHaveBeenCalledWith(
      realm.id,
      history.sequence,
      history,
    );
  });
});

describe('stories realms state / setOutput', () => {
  it('当前页为第 0 页时输出页归为 -1', async () => {
    const data = await loadCases();
    setupRealm(data, structuredClone(data.histories));

    await useRealmState.getState().setOutput(5);

    expect(useRealmState.getState().output).toEqual(data.expected.emptyOutput);
    expect(useRealmState.getState().prepare).toBe(true);
    expect(mocks.historyGet).not.toHaveBeenCalled();
  });

  it('当前页超出历史长度时直接返回', async () => {
    const data = await loadCases();
    setupRealm(data, structuredClone(data.histories));
    useRealmState.setState({
      index: { max: 9, cur: 9 },
      output: { max: 4, cur: 3 },
    });

    await useRealmState.getState().setOutput();

    expect(useRealmState.getState().output).toEqual({ max: 4, cur: 3 });
    expect(useRealmState.getState().prepare).toBe(false);
    expect(mocks.historyGet).not.toHaveBeenCalled();
  });

  it('没有 realm 时直接返回', async () => {
    useRealmState.setState({
      index: { max: 1, cur: 1 },
      output: { max: 4, cur: 3 },
    });

    await useRealmState.getState().setOutput();

    expect(useRealmState.getState().output).toEqual({ max: 4, cur: 3 });
    expect(mocks.historyGet).not.toHaveBeenCalled();
  });

  it('传 cur 时覆盖历史里的 output 并写回', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, [structuredClone(data.histories[1])]);
    useRealmState.setState({ index: { max: 1, cur: 1 } });

    await useRealmState.getState().setOutput(1);

    const history = realm.histories[0]!;
    expect(useRealmState.getState().output).toEqual(
      data.expected.overriddenOutput,
    );
    expect(history.output).toBe(1);
    expect(mocks.historySet).toHaveBeenCalledWith(
      realm.id,
      history.sequence,
      history,
    );
  });
});

describe('stories realms state / initPager', () => {
  it('没有历史时按开场白设置分页', async () => {
    const data = await loadCases();
    const realm = setupRealm(data);

    await useRealmState.getState().initPager();

    expect(useRealmState.getState().index).toEqual({ max: 0, cur: 0 });
    expect(useRealmState.getState().output).toEqual(data.expected.openingOutput);
    expect(realm.context.opening).toBeDefined();
    expect(mocks.historySet).not.toHaveBeenCalled();
  });

  it('有历史时按最后一段历史设置分页', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, [structuredClone(data.histories[1])]);

    await useRealmState.getState().initPager();

    expect(useRealmState.getState().index).toEqual({ max: 1, cur: 1 });
    expect(useRealmState.getState().output).toEqual(
      data.expected.lastHistoryOutput,
    );
    expect(realm.histories[0]!.output).toBe(
      data.expected.lastHistoryOutput.cur,
    );
    expect(mocks.historySet).not.toHaveBeenCalled();
  });
});
