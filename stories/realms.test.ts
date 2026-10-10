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

// realms/index.ts 从 stories 桶上取 proxy 与 renderers，这里只提供用到的入口
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

// models 桶会拉起各 provider 的展示层，整体替换掉
vi.mock('@/models/client', () => ({
  models: {
    processers: { generate: mocks.generate, output: mocks.output },
    proxy: { get: mocks.modelGet },
    convert: mocks.convert,
  },
}));

import { realms, useRealmState } from '@/stories/client/realms';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./realms.cases.json')).default);
}

/** 把 realm 挂到单例上；历史数组单独传，便于按用例定制 */
function setupRealm(data: any, histories: any[] = []) {
  const realm = structuredClone(data.realm);
  realm.histories = histories;
  realms.realm = realm;
  return realm;
}

/** 造一个最小的 iframe 桩，只保留 postMessage 与脚本同步读取的数据挂载点 */
function stubIframe() {
  const contentWindow: any = { postMessage: vi.fn() };
  realms.iframe = { contentWindow } as any;
  return contentWindow;
}

/**
 * 真实的 processers.generate 每轮会把一个输出页推进历史，
 * 这里按同样的粒度模拟，供 generate 里的 output / stream 判断使用
 */
function stubGenerate(outputs: any[]) {
  mocks.generate.mockImplementation(async function* () {
    for (const output of outputs) {
      const history = realms.realm.histories.at(-1)! as any;
      if (!history) break;
      history.outputs.push([output]);
      yield { output };
    }
  });
}

/** 取同步抛出的错误，用于断言 BusinessError 的 code 与 data */
function catchError(fn: () => any) {
  try {
    fn();
  } catch (err) {
    return err as BusinessError;
  }
  throw new Error('应当抛错但没有');
}

const originalConsole = {
  debug: console.debug,
  log: console.log,
  error: console.error,
};
let logs: string[] = [];
let errors: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  logs = [];
  errors = [];
  console.debug = () => {};
  console.log = (...args: any[]) => void logs.push(String(args[0]));
  console.error = (...args: any[]) => void errors.push(String(args[0]));
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
  Object.assign(console, originalConsole);
});

describe('stories realms / outputs 与 variables', () => {
  it('没有输出页时应当返回 null', () => {
    expect(realms.outputs(null)).toBeNull();
    expect(realms.outputs(undefined)).toBeNull();
    expect(realms.outputs({ outputs: [] } as any)).toBeNull();
  });

  it('output 越界时应当取最后一页', async () => {
    const data = await loadCases();
    const history = structuredClone(data.history) as any;

    expect(realms.outputs({ ...history, output: 5 })).toBe(
      history.outputs[history.outputs.length - 1],
    );
  });

  it('variables 应当依次叠加各条输入与当前输出页的变量', async () => {
    const data = await loadCases();
    const history = structuredClone(data.history) as any;

    const variables = realms.variables(history);

    expect(variables).toEqual(data.expected.variables);
  });

  it('variables 不应当修改历史本身', async () => {
    const data = await loadCases();
    const history = structuredClone(data.history) as any;

    realms.variables(history);

    expect(history.variables).toEqual(data.expected.variablesBefore);
  });

  it('output 为 false 时不叠加输出页变量', async () => {
    const data = await loadCases();
    const history = structuredClone(data.history) as any;

    expect(realms.variables(history, false)).toEqual(
      data.expected.variablesWithoutOutput,
    );
  });

  it('output 指向不存在的一页时不叠加输出页变量', async () => {
    const data = await loadCases();
    const history = structuredClone(data.history) as any;
    history.output = -1;

    expect(realms.variables(history)).toEqual(
      data.expected.variablesWithoutOutput,
    );
  });
});

describe('stories realms / context', () => {
  it('已初始化的键应当直接返回', async () => {
    const data = await loadCases();
    const realm = structuredClone(data.realm) as any;
    realm.context = { answer: 42 };

    expect(realms.context(realm, 'answer')).toBe(42);
  });

  it('未初始化的键应当先补出空 context 再抛错', async () => {
    const data = await loadCases();
    const realm = structuredClone(data.realm) as any;
    delete realm.context;

    const err = catchError(() => realms.context(realm, 'missing'));

    expect(realm.context).toEqual({});
    expect(err).toBeInstanceOf(BusinessError);
    expect(err.code).toBe('error.story.realm_not_initialized');
    expect(err.data.key).toBe('missing');
  });

  it('initContext 首次写入成功，同键再写抛错', async () => {
    const data = await loadCases();
    const realm = structuredClone(data.realm) as any;

    realms.initContext(realm, 'foo', { n: 1 });
    expect(realms.context(realm, 'foo')).toEqual({ n: 1 });

    const err = catchError(() => realms.initContext(realm, 'foo', { n: 2 }));

    expect(err).toBeInstanceOf(BusinessError);
    expect(err.code).toBe('realm.content_already_initialized');
    expect(err.data.key).toBe('foo');
    expect(realms.context(realm, 'foo')).toEqual({ n: 1 });
  });

  it('initContext 的值为 undefined 时也抛错', async () => {
    const data = await loadCases();
    const realm = structuredClone(data.realm) as any;

    const err = catchError(() => realms.initContext(realm, 'bar', undefined));

    expect(err.code).toBe('realm.content_already_initialized');
    expect(err.data.key).toBe('bar');
    expect(realm.context).toEqual({});
  });

  it('cache 应当用 realm. 前缀走 context', async () => {
    const data = await loadCases();
    const realm = structuredClone(data.realm) as any;
    realm.context = { 'realm.foo': 'cached' };

    expect(realms.key('foo')).toBe('realm.foo');
    expect(realms.cache(realm, 'foo')).toBe('cached');

    const err = catchError(() => realms.cache(realm, 'bar'));
    expect(err.data.key).toBe('realm.bar');
  });
});

describe('stories realms / opening', () => {
  it('应当合并各预设的 variables 并生成开场输出', async () => {
    const data = await loadCases();
    const realm = structuredClone(data.realm) as any;

    const opening = realms.opening(realm) as any;

    expect(opening.masterId).toBe(realm.id);
    expect(opening.sequence).toBe(-1);
    expect(opening.summary).toBe(true);
    expect(opening.output).toBe(0);
    expect(opening.prompts).toEqual(data.expected.openingPrompts);
    expect(opening.variables).toEqual(data.expected.openingVariables);
    // 空白的 opening 被过滤掉，一页里只保留有内容的那条
    expect(opening.outputs).toEqual([data.expected.openingOutputs]);
  });

  it('第二次调用应当直接返回缓存', async () => {
    const data = await loadCases();
    const realm = structuredClone(data.realm) as any;

    const opening = realms.opening(realm);

    expect(realms.opening(realm)).toBe(opening);
    expect(realm.context.opening).toBe(opening);
  });

  it('已有缓存时应当原样返回', async () => {
    const data = await loadCases();
    const realm = structuredClone(data.realm) as any;
    const cached = { sequence: -1, cached: true };
    realm.context = { opening: cached };

    expect(realms.opening(realm)).toBe(cached);
  });
});

describe('stories realms / model', () => {
  it('不传模型时用故事自己的模型', async () => {
    const data = await loadCases();
    const realm = structuredClone(data.realm) as any;

    expect(await realms.model(realm)).toBe(realm.model);
    expect(mocks.modelGet).not.toHaveBeenCalled();
  });

  it('传模型时按 value 取模型', async () => {
    const data = await loadCases();
    const realm = structuredClone(data.realm) as any;
    mocks.modelGet.mockResolvedValue({ id: 'picked' });

    const model = await realms.model(realm, {
      name: 'picked',
      value: 'picked',
    });

    expect(model).toEqual({ id: 'picked' });
    expect(mocks.modelGet).toHaveBeenCalledWith('picked');
  });
});

describe('stories realms / history.get', () => {
  it('index 为 0 时返回开场白', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, [structuredClone(data.histories[0])]);

    const history = await realms.history.get(0, realm);

    expect(history).toBe(realms.opening(realm));
    expect(mocks.historyGet).not.toHaveBeenCalled();
  });

  it('没有历史时返回开场白', async () => {
    const data = await loadCases();
    const realm = setupRealm(data);

    expect(await realms.history.get(null, realm)).toBe(realms.opening(realm));
  });

  it('index 为空时取最后一段历史', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, structuredClone(data.histories));

    expect(await realms.history.get(null, realm)).toBe(realm.histories[1]);
  });

  it('越界时钳到可用范围', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, structuredClone(data.histories));

    expect(await realms.history.get(99, realm)).toBe(realm.histories[1]);
    expect(await realms.history.get(-5, realm)).toBe(realm.histories[0]);
  });

  it('缺失的一段应当按 sequence 拉取并写回', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, structuredClone(data.histories));
    realm.histories[1] = null;
    mocks.historyGet.mockResolvedValue(structuredClone(data.fetched));

    const history = await realms.history.get(2, realm);

    expect(mocks.historyGet).toHaveBeenCalledWith(realm.id, 1);
    expect(history).toEqual(data.fetched);
    expect(realm.histories[1]).toBe(history);
  });
});

describe('stories realms / history.set', () => {
  it('index 为 0 时不发请求', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, structuredClone(data.histories));

    await realms.history.set(0, realm);

    expect(mocks.historyGet).not.toHaveBeenCalled();
    expect(mocks.historySet).not.toHaveBeenCalled();
  });

  it('应当按 sequence 保存对应的一段历史', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, structuredClone(data.histories));

    await realms.history.set(1, realm);

    expect(mocks.historySet).toHaveBeenCalledWith(
      realm.id,
      realm.histories[0]!.sequence,
      realm.histories[0],
    );
  });
});

describe('stories realms / message', () => {
  it('没有 iframe 时 post 只记录错误', () => {
    realms.iframe = null!;

    expect(() => realms.message.post('content', {})).not.toThrow();
    expect(errors).toContain('iframe is not accessible this time.');
  });

  it('post 应当把数据挂到 contentWindow.__messageData 并 postMessage', () => {
    const contentWindow = stubIframe();
    const payload = { a: 1 };

    realms.message.post('variables', payload);

    expect(contentWindow.__messageData.variables).toBe(payload);
    expect(contentWindow.postMessage).toHaveBeenCalledWith(
      { type: 'variables' },
      '*',
    );
  });

  it('message.variables 应当发送叠加后的变量', async () => {
    const data = await loadCases();
    const contentWindow = stubIframe();
    const history = structuredClone(data.history) as any;

    realms.message.variables(history);

    expect(contentWindow.__messageData.variables).toEqual(
      data.expected.variables,
    );
  });

  it('message.content 应当组装输入、输出与思考并发给页面', async () => {
    const data = await loadCases();
    const contentWindow = stubIframe();
    const history = structuredClone(data.history) as any;
    const handler = vi.fn(async (text: string) => `H:${text}`);

    await realms.message.content(history, handler);

    // 空内容的输入与输出条目会被过滤掉，接缝是换行
    expect(handler.mock.calls.map((u) => u[0])).toEqual([
      'p1',
      'p2',
      data.expected.outputText,
    ]);
    expect(handler).toHaveBeenNthCalledWith(1, 'p1', {
      role: 'user',
      type: 'input',
      history,
    });
    expect(handler).toHaveBeenNthCalledWith(3, data.expected.outputText, {
      role: 'assistant',
      type: 'output',
      history,
    });
    expect(contentWindow.__messageData.content).toEqual({
      inputs: ['H:p1', 'H:p2'],
      output: `H:${data.expected.outputText}`,
      thought: data.expected.thoughtText,
    });
  });
});

describe('stories realms / histories 访问器', () => {
  it('应当返回 realm 的历史数组', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, [structuredClone(data.histories[0])]);

    expect(realms.histories).toBe(realm.histories);

    realms.realm = null!;
    expect(realms.histories).toBeUndefined();
  });
});

describe('stories realms / generate', () => {
  it('生成中再调用应当直接返回', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, [structuredClone(data.emptyHistory)]);
    useRealmState.setState({ generating: true, content: '草稿' });

    await realms.generate(true);

    expect(mocks.historyAdd).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.output).not.toHaveBeenCalled();
    expect(mocks.historySet).not.toHaveBeenCalled();
    expect(useRealmState.getState().realmInfos).toEqual({});
    expect(useRealmState.getState().content).toBe('草稿');
    expect(realm.histories).toHaveLength(1);
  });

  it('create 且没有历史时应当用开场白变量创建历史并保存', async () => {
    const data = await loadCases();
    const realm = setupRealm(data);
    realms.iframe = { contentWindow: {} } as any;
    useRealmState.setState({ content: data.generate.content, summary: true });
    let added: any;
    mocks.historyAdd.mockImplementation(async (_id: string, history: any) => {
      // 后面还会就地改写 output / sequence，这里先留一份保存当时的快照
      added = structuredClone(history);
      return { sequence: data.generate.addedSequence };
    });
    stubGenerate([data.generate.steps[0]]);

    await realms.generate(true);

    expect(mocks.historyAdd).toHaveBeenCalledTimes(1);
    expect(mocks.historyAdd.mock.calls[0][0]).toBe(realm.id);
    expect(added).toMatchObject({
      masterId: realm.id,
      sequence: 0,
      output: -1,
      summary: true,
      outputs: [],
      variables: data.expected.openingVariables,
    });
    expect(added.prompts).toEqual([
      { content: data.generate.content.trim(), variables: [], properties: {} },
    ]);
    // 输入取自调用前读到的值，状态里的草稿已经被清空
    expect(useRealmState.getState().content).toBe('');
    expect(realm.histories).toHaveLength(1);
    expect(realm.histories[0].sequence).toBe(data.generate.addedSequence);
  });

  it('create 且上一条历史还没输出时合并到该历史', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, [structuredClone(data.emptyHistory)]);
    realms.iframe = { contentWindow: {} } as any;
    useRealmState.setState({ content: data.generate.input });
    stubGenerate([]);

    await realms.generate(true);

    expect(mocks.historyAdd).not.toHaveBeenCalled();
    expect(realm.histories).toHaveLength(1);
    expect(realm.histories[0].prompts).toEqual([
      { content: data.generate.input, variables: [], properties: {} },
    ]);
  });

  it('create 且上一条历史已经输出时新建历史', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, [structuredClone(data.history)]);
    realms.iframe = { contentWindow: {} } as any;
    useRealmState.setState({ content: data.generate.input });
    let added: any;
    mocks.historyAdd.mockImplementation(async (_id: string, history: any) => {
      added = structuredClone(history);
      return { sequence: data.generate.addedSequence };
    });
    stubGenerate([]);

    await realms.generate(true);

    expect(realm.histories).toHaveLength(2);
    expect(added).toMatchObject({
      sequence: 1,
      output: -1,
      outputs: [],
      variables: data.expected.variables,
    });
    expect(added.prompts).toEqual([
      { content: data.generate.input, variables: [], properties: {} },
    ]);
    expect(realm.histories[1].sequence).toBe(data.generate.addedSequence);
  });

  it('create 时应当按 sequence 依次应用输入构造器', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, [structuredClone(data.emptyHistory)]);
    const builders = [
      { id: 'c', sequence: 2, build: vi.fn((t: string) => `${t}[c]`) },
      { id: 'a', sequence: undefined, build: vi.fn((t: string) => `${t}[a]`) },
      { id: 'b', sequence: 1, build: vi.fn((t: string) => `${t}[b]`) },
    ];
    realms.iframe = {
      contentWindow: { userInput: { inputBuilders: builders } },
    } as any;
    useRealmState.setState({ content: data.generate.input });
    stubGenerate([]);

    await realms.generate(true);

    expect(realm.histories[0].prompts[0].content).toBe(
      data.generate.builtContent,
    );
    // 排序是就地做的，缺省 sequence 视为 0
    expect(builders.map((u) => u.id)).toEqual(['a', 'b', 'c']);
    expect(builders[0].build).toHaveBeenCalledWith(data.generate.input);
    expect(builders[1].build.mock.calls[0][0]).toBe(
      builders[0].build.mock.results[0].value,
    );
    expect(builders[2].build.mock.calls[0][0]).toBe(
      builders[1].build.mock.results[0].value,
    );
  });

  it('应当按 thought / 工具参数 / 正文长度切换生成信息', async () => {
    const data = await loadCases();
    setupRealm(data, [structuredClone(data.emptyHistory)]);
    const infos: any[] = [];
    const unsubscribe = useRealmState.subscribe((state, prev) => {
      if (state.realmInfos !== prev.realmInfos) infos.push(state.realmInfos.main);
    });
    stubGenerate(data.generate.steps);

    await realms.generate();
    unsubscribe();

    expect(infos).toEqual([
      { title: 'realm.generating' },
      ...data.expected.stepInfos,
    ]);
    expect(useRealmState.getState().realmInfos.main).toEqual(
      data.expected.stepInfos.at(-1),
    );
  });

  it('首个输出后应当按页码与输出页对齐调用流式渲染', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, [structuredClone(data.emptyHistory)]);
    stubGenerate([data.generate.steps[0]]);

    await realms.generate();

    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.stream.mock.calls[0][0].history).toBe(realm.histories[0]);
    expect(mocks.stream.mock.calls[0][0].realm).toBe(realm);
    // 输出解析在流式渲染之后统一处理
    expect(mocks.output).toHaveBeenCalledWith({ realm });
    expect(mocks.output.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.stream.mock.invocationCallOrder[0],
    );
  });

  it('没有产出时不调用流式渲染，但仍然收尾', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, [structuredClone(data.emptyHistory)]);
    stubGenerate([]);

    await realms.generate();

    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.output).toHaveBeenCalledWith({ realm });
    expect(useRealmState.getState().generating).toBe(false);
    expect(useRealmState.getState().signal).toBeUndefined();
  });

  it('不创建且没有历史时渲染开场白，不保存历史', async () => {
    const data = await loadCases();
    const realm = setupRealm(data);
    stubGenerate([]);

    await realms.generate();

    expect(mocks.historyAdd).not.toHaveBeenCalled();
    expect(mocks.historySet).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(realm.context.opening).toBeDefined();
    expect(useRealmState.getState().index).toEqual({ max: 0, cur: 0 });
    expect(useRealmState.getState().generating).toBe(false);
  });

  it('生成结束后应当把最后一段历史写回服务端', async () => {
    const data = await loadCases();
    const realm = setupRealm(data, [structuredClone(data.emptyHistory)]);
    stubGenerate([data.generate.steps[0]]);

    await realms.generate();

    const history = realm.histories[0]!;
    expect(history.output).toBe(0);
    expect(mocks.historySet).toHaveBeenCalledTimes(1);
    expect(mocks.historySet).toHaveBeenCalledWith(
      realm.id,
      history.sequence,
      history,
    );
  });

  it('中断错误只记日志，不向上抛', async () => {
    const data = await loadCases();
    setupRealm(data, [structuredClone(data.emptyHistory)]);
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    mocks.generate.mockImplementation(async function* () {
      throw abort;
    });

    await expect(realms.generate()).resolves.toBeUndefined();

    expect(logs).toContain('user abort reply');
    expect(mocks.output).not.toHaveBeenCalled();
    expect(useRealmState.getState().generating).toBe(false);
  });

  it('其它错误应当向上抛，收尾仍然执行', async () => {
    const data = await loadCases();
    setupRealm(data, [structuredClone(data.emptyHistory)]);
    mocks.generate.mockImplementation(async function* () {
      throw new Error('boom');
    });

    await expect(realms.generate()).rejects.toThrow('boom');

    expect(useRealmState.getState().generating).toBe(false);
    expect(useRealmState.getState().signal).toBeUndefined();
    expect(mocks.historySet).toHaveBeenCalledTimes(1);
  });

  it('create 阶段保存失败时向上抛并复位输入与生成状态', async () => {
    const data = await loadCases();
    setupRealm(data);
    realms.iframe = { contentWindow: {} } as any;
    useRealmState.setState({ content: data.generate.content, summary: true });
    mocks.historyAdd.mockRejectedValue(new Error('add boom'));

    await expect(realms.generate(true)).rejects.toThrow('add boom');

    // create 阶段在收尾的 try/finally 之前，出错时生成态必须自己复位，
    // 否则会一直停在「生成中」，后续 generate 全部早退。
    expect(useRealmState.getState().generating).toBe(false);
    expect(useRealmState.getState().summary).toBe(false);
    expect(useRealmState.getState().content).toBe('');
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
