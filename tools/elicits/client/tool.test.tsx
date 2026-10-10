import { beforeEach, describe, expect, it } from 'vitest';

import { useElicitState } from '@/tools/elicits/client/states';
import { tool } from '@/tools/elicits/client/tool';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./tool.cases.json')).default);
}

function toCallContext(args: any) {
  return { args, controller: new AbortController() } as any;
}

beforeEach(() => {
  useElicitState.setState({ render: 0, items: [], item: null });
});

describe('tools elicits tool / 注册契约', () => {
  it('应当以 elicit 为 id 注册，只暴露创建入口', () => {
    // 运行时 name 来自 `...main` 展开，但 ToolProvider 类型里只声明了 id
    const provider = tool as typeof tool & { name: string };

    expect(provider.name).toBe('elicit');
    expect(provider.id).toBe('elicit');
    expect(Object.keys(provider).sort()).toEqual(['create', 'id', 'name']);
    expect(typeof provider.create).toBe('function');
    // 这个工具没有配置表单，也没有表单读取钩子
    expect(provider.configComponent).toBeUndefined();
    expect(provider.configureObject).toBeUndefined();
  });
});

describe('tools elicits tool / create', () => {
  it('应当返回唯一的 ask_user 工具并带上三个参数', async () => {
    const data = await loadCases();

    const items = await tool.create(data.entry as any, null as any);

    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.name).toBe(data.name);
    expect(item.description).toBe(data.description);
    expect(item.parameters).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['question', 'examples', 'custom'],
    });
    expect((item.parameters as any).properties).toEqual({
      question: { type: 'string', description: 'question to ask user' },
      examples: {
        type: 'array',
        items: { type: 'string' },
        description: 'examples to show user, user can select one of them',
      },
      custom: {
        type: 'boolean',
        description:
          'whether to allow user to input custom answer, true for default',
      },
    });
  });

  it('realm 不参与构造，传 null 也能建出工具', async () => {
    const data = await loadCases();

    const items = await tool.create(data.entry as any, null as any);

    expect(typeof items[0].invoke).toBe('function');
    // 建工具这一步不碰状态机
    expect(useElicitState.getState().item).toBeNull();
    expect(useElicitState.getState().items).toEqual([]);
  });
});

describe('tools elicits tool / invoke', () => {
  async function createTool() {
    const data = await loadCases();
    const items = await tool.create(data.entry as any, null as any);
    return { data, item: items[0] };
  }

  it('应当把问题推进状态机，并在 reply 时返回用户的回答', async () => {
    const { data, item } = await createTool();
    const answer = data.args.examples[0];

    const promise = item.invoke(toCallContext(data.args));

    // 推进去的条目带上了 args 的三个字段与 reply 回调
    const state = useElicitState.getState();
    expect(state.item).toMatchObject(data.args);
    expect(state.item!.examples).toEqual(data.args.examples);
    expect(typeof state.item!.reply).toBe('function');
    expect(state.render).toBe(1);
    expect(state.items).toEqual([]);

    await state.item!.reply(answer);

    await expect(promise).resolves.toBe(answer);
  });

  it('第一个问题没回答时，第二次 invoke 进队列等待', async () => {
    const { data, item } = await createTool();

    const first = item.invoke(toCallContext(data.args));
    const second = item.invoke(toCallContext(data.secondArgs));

    // 弹出的窗口仍然是第一个问题，第二个问题排队
    expect(useElicitState.getState().item).toMatchObject(data.args);
    expect(
      useElicitState.getState().items.map((u) => u.question),
    ).toEqual([data.secondArgs.question]);

    await useElicitState.getState().item!.reply('红');
    await expect(first).resolves.toBe('红');

    // 上层弹窗答完后 pop，第二个问题才顶上来
    useElicitState.getState().pop();
    expect(useElicitState.getState().item).toMatchObject(data.secondArgs);

    await useElicitState.getState().item!.reply('是');
    await expect(second).resolves.toBe('是');
  });

  it('args 里的 custom 原样保留，不补默认值', async () => {
    const { data, item } = await createTool();

    const promise = item.invoke(toCallContext(data.secondArgs));

    expect(useElicitState.getState().item!.custom).toBe(false);

    await useElicitState.getState().item!.reply('否');
    await promise;
  });

  it('回答只 resolve 一次，重复 reply 不会改变结果', async () => {
    const { data, item } = await createTool();
    const promise = item.invoke(toCallContext(data.args));

    await useElicitState.getState().item!.reply('红');
    await useElicitState.getState().item!.reply('绿');

    await expect(promise).resolves.toBe('红');
  });
});
