import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelInjectContext, ModelPromptContext } from '@/models/client';

const mocks = vi.hoisted(() => ({
  calling: vi.fn(),
}));

// 工具调用属于另一条链，这里只记录被调用的参数
vi.mock('@/tools/client', () => ({
  tools: { calling: mocks.calling },
}));

import { models } from '@/models/client';
import type { Realm, RealmHistory } from '@/stories';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./engine.cases.json')).default);
}

async function createRealm(): Promise<Realm> {
  return structuredClone(
    (await import('../../stories/realm.json')).default,
  ) as unknown as Realm;
}

interface Recorder {
  events: string[];
  inject: (ctx: ModelInjectContext) => Promise<{
    before: (i: number) => Promise<void>;
    middle: (i: number) => Promise<void>;
    behind: (i: number) => Promise<void>;
  }>;
  injectContext: ModelInjectContext;
}

/** 把注入通道与生命周期都记进同一个事件流，方便断言整体顺序 */
function createRecorder(events: string[] = []): Recorder {
  return {
    events,
    inject: async () => ({
      async before(i: number) {
        events.push(`before:${i}`);
      },
      async middle(i: number) {
        events.push(`middle:${i}`);
      },
      async behind(i: number) {
        events.push(`behind:${i}`);
      },
    }),
    injectContext: {
      builder: 'default',
      name: (i: number) => `call_x${i}`,
      prompt: (content: string) => events.push(`prompt:${content}`),
      assist: (content: string) => events.push(`assist:${content}`),
      system: (content: string) => events.push(`system:${content}`),
      caller: (content: string, _output: unknown, callings: unknown[]) =>
        events.push(`caller:${content}:${callings.length}`),
    } as unknown as ModelInjectContext,
  };
}

async function createContext(
  histories: RealmHistory[],
  options: { current?: boolean; converts?: any[]; injects?: any[] } = {},
) {
  const realm = await createRealm();
  return {
    realm,
    properties: {},
    histories,
    history: histories.at(-1)!,
    current: options.current ?? false,
    converts: options.converts ?? [],
    injects: options.injects ?? [],
    controller: new AbortController(),
  } as unknown as ModelPromptContext;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('models client engine / knowledge 描述', () => {
  it('args 应当把参数序列化成工具参数字符串', async () => {
    const { knowledge } = await loadCases();

    expect(models.engines.knowledge.args(knowledge.args)).toBe(
      JSON.stringify(knowledge.args),
    );
  });

  it('应当声明 get_knowledge 工具与入参 schema', () => {
    const { info, schema } = models.engines.knowledge;

    expect(info.name).toBe('get_knowledge');
    expect(info.description).toBeTruthy();
    expect(schema).toMatchObject({
      type: 'object',
      properties: { type: { type: 'string' } },
    });
  });
});

describe('models client engine / prompt 生命周期', () => {
  it('最后一段历史默认不注入输出', async () => {
    const data = await loadCases();
    const recorder = createRecorder();
    const ctx = await createContext(
      [structuredClone(data.historyA) as RealmHistory],
      { injects: [recorder.inject] },
    );

    await models.engines.prompt(ctx, recorder.injectContext);

    expect(recorder.events).toEqual([
      'before:0',
      'prompt:甲提问',
      'middle:0',
      'behind:0',
    ]);
  });

  it('current 为真时最后一段历史也要注入输出', async () => {
    const data = await loadCases();
    const recorder = createRecorder();
    const ctx = await createContext(
      [structuredClone(data.historyA) as RealmHistory],
      { current: true, injects: [recorder.inject] },
    );

    await models.engines.prompt(ctx, recorder.injectContext);

    expect(recorder.events).toEqual([
      'before:0',
      'prompt:甲提问',
      'middle:0',
      'assist:甲回复',
      'behind:0',
    ]);
  });

  it('多段历史时只有最后一段跳过输出', async () => {
    const data = await loadCases();
    const recorder = createRecorder();
    const ctx = await createContext(
      [
        structuredClone(data.historyA) as RealmHistory,
        structuredClone(data.historyB) as RealmHistory,
      ],
      { injects: [recorder.inject] },
    );

    await models.engines.prompt(ctx, recorder.injectContext);

    expect(recorder.events).toEqual(data.sequence.expected);
  });

  it('多段历史且 current 为真时每段都注入输出', async () => {
    const data = await loadCases();
    const recorder = createRecorder();
    const ctx = await createContext(
      [
        structuredClone(data.historyA) as RealmHistory,
        structuredClone(data.historyB) as RealmHistory,
      ],
      { current: true, injects: [recorder.inject] },
    );

    await models.engines.prompt(ctx, recorder.injectContext);

    expect(recorder.events).toEqual(data.sequence.currentExpected);
  });

  it('注入器应当先于本条历史的消息收集完成', async () => {
    const data = await loadCases();
    const events: string[] = [];
    const ctx = await createContext(
      [structuredClone(data.historyA) as RealmHistory],
      {
        current: true,
        injects: [
          async (inner: ModelInjectContext) => {
            // 注入器只能在被调用时拿到注入上下文
            events.push(`inject:${inner.builder}`);
            return {
              async before(i: number) {
                events.push(`before:${i}`);
              },
            } as any;
          },
        ],
      },
    );

    await models.engines.prompt(
      ctx,
      createRecorder(events).injectContext,
    );

    expect(events).toEqual([
      'inject:default',
      'before:0',
      'prompt:甲提问',
      'assist:甲回复',
    ]);
  });
});

describe('models client engine / 内容处理', () => {
  it('多条提问应当用换行拼接并整体去空白', async () => {
    const data = await loadCases();
    const recorder = createRecorder();
    const history = {
      ...(structuredClone(data.historyA) as RealmHistory),
      prompts: data.trim.prompts,
    };
    const ctx = await createContext([history], {
      injects: [recorder.inject],
    });

    await models.engines.prompt(ctx, recorder.injectContext);

    expect(recorder.events).toContain(`prompt:${data.trim.expected}`);
  });

  it('只由空白组成的消息不应当注入', async () => {
    const data = await loadCases();
    const recorder = createRecorder();
    const history = {
      ...(structuredClone(data.historyA) as RealmHistory),
      prompts: [{ content: '   ', variables: [] }],
    };
    const ctx = await createContext([history], {
      injects: [recorder.inject],
    });

    await models.engines.prompt(ctx, recorder.injectContext);

    expect(recorder.events).toEqual(['before:0', 'middle:0', 'behind:0']);
  });

  it('有工具调用时走 caller，并带上原始输出', async () => {
    const data = await loadCases();
    const recorder = createRecorder();
    const history = structuredClone(data.toolHistory) as RealmHistory;
    const ctx = await createContext([history], {
      current: true,
      injects: [recorder.inject],
    });

    await models.engines.prompt(ctx, recorder.injectContext);

    expect(recorder.events).toEqual([
      'before:0',
      'middle:0',
      'caller:带工具的输出:1',
      'behind:0',
    ]);
    expect(mocks.calling).toHaveBeenCalledWith(
      ctx.realm,
      ctx.controller,
      history.outputs[0][0].callings,
    );
  });

  it('没有工具调用时也应当先检查工具触发', async () => {
    const data = await loadCases();
    const recorder = createRecorder();
    const history = structuredClone(data.historyA) as RealmHistory;
    const ctx = await createContext([history], {
      current: true,
      injects: [recorder.inject],
    });

    await models.engines.prompt(ctx, recorder.injectContext);

    expect(mocks.calling).toHaveBeenCalledWith(
      ctx.realm,
      ctx.controller,
      undefined,
    );
  });

  it('转换器的结果应当同时作用于输入与输出', async () => {
    const data = await loadCases();
    const recorder = createRecorder();
    const seen: string[] = [];
    const convert = async (text: string, inner: { type: string }) => {
      seen.push(inner.type);
      return `«${text}»`;
    };
    const ctx = await createContext(
      [structuredClone(data.historyA) as RealmHistory],
      { current: true, converts: [convert], injects: [recorder.inject] },
    );

    await models.engines.prompt(ctx, recorder.injectContext);

    expect(seen).toEqual(['input', 'output']);
    expect(recorder.events).toContain('prompt:«甲提问»');
    expect(recorder.events).toContain('assist:«甲回复»');
  });

  it('输出内容为空且没有工具调用时不应当注入', async () => {
    const data = await loadCases();
    const recorder = createRecorder();
    const history = structuredClone(data.historyA) as RealmHistory;
    history.outputs[0][0].content = '   ';
    const ctx = await createContext([history], {
      current: true,
      injects: [recorder.inject],
    });

    await models.engines.prompt(ctx, recorder.injectContext);

    expect(recorder.events).toEqual([
      'before:0',
      'prompt:甲提问',
      'middle:0',
      'behind:0',
    ]);
  });
});
