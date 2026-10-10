import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Realm } from '@/stories';
import { useRealmState } from '@/stories/client/realms';
import type { ToolCall } from '@/tools';
import type { CallContext } from '@/tools/client';
import { tools } from '@/tools/client';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./task.cases.json')).default);
}

/**
 * task.ts 的工具表来自 tools.cache(realm)，也就是 realm.context['model.tool']。
 * 这里直接把缓存造好，绕开 processer 的初始化。
 */
async function createRealm(cacheTools: Record<string, any> = {}): Promise<Realm> {
  const realm = structuredClone(
    (await import('../../stories/realm.json')).default,
  );

  return {
    ...realm,
    properties: {},
    context: { 'model.tool': { tools: cacheTools } },
  } as unknown as Realm;
}

function createTool(name: string, invoke: (ctx: any) => Promise<string>) {
  return {
    name,
    description: name,
    parameters: { type: 'object' },
    invoke,
  };
}

/** 调用参数是字符串，期望值统一从 fixture 派生，避免两处手写 */
function argsOf(toolcall: ToolCall) {
  return JSON.parse(toolcall.arguments);
}

/** 让出事件循环，等任务调度的 microtask 链推进到「该入队的都入队了」 */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  useRealmState.setState({ generating: false, realmInfos: {} });
});

describe('tools client task / calling', () => {
  it('没有待执行的调用时应当直接返回，不去取缓存', async () => {
    const realm = await createRealm();
    // context 未初始化时 tools.cache 会抛错，说明这里确实提前返回了
    const bare = { ...realm, context: undefined } as Realm;
    const controller = new AbortController();

    await expect(tools.calling(bare, controller)).resolves.toBeUndefined();
    await expect(tools.calling(bare, controller, [])).resolves.toBeUndefined();
  });

  it('应当按名字取工具、解析参数并把返回值写回调用', async () => {
    const data = await loadCases();
    const toolcall = data.toolCalls.set as ToolCall;
    const invoke = vi.fn(async (_ctx: CallContext) => data.result.success);
    const realm = await createRealm({
      [data.toolName]: createTool(data.toolName, invoke),
    });
    const controller = new AbortController();

    await tools.calling(realm, controller, [toolcall]);

    expect(invoke).toHaveBeenCalledTimes(1);
    const ctx = invoke.mock.calls[0][0];
    expect(ctx.args).toEqual(argsOf(toolcall));
    expect(ctx.toolcall).toBe(toolcall);
    expect(ctx.controller).toBe(controller);
    expect(toolcall.result).toBe(data.result.success);
  });

  it('多个调用应当各自找到自己的工具并写回结果', async () => {
    const data = await loadCases();
    const setName = data.toolNames[0];
    const getName = data.toolNames[1];
    const setCall = data.toolCalls.set as ToolCall;
    const getCall = data.toolCalls.get as ToolCall;
    const realm = await createRealm({
      [setName]: createTool(setName, vi.fn(async () => 'done')),
      [getName]: createTool(getName, vi.fn(async () => 'value')),
    });

    await tools.calling(realm, new AbortController(), [setCall, getCall]);

    expect(setCall.result).toBe('done');
    expect(getCall.result).toBe('value');
  });

  it('未注册的工具名应当把结果置为空串', async () => {
    const data = await loadCases();
    const toolcall = data.toolCalls.unknown as ToolCall;
    const realm = await createRealm();

    await tools.calling(realm, new AbortController(), [toolcall]);

    expect(toolcall.result).toBe(data.result.unknown);
  });

  it('已经有结果的调用不应重复执行', async () => {
    const data = await loadCases();
    const finished = data.toolCalls.finished as ToolCall;
    const pending = data.toolCalls.set as ToolCall;
    const invoke = vi.fn(async (_ctx: CallContext) => data.result.success);
    const realm = await createRealm({
      [data.toolName]: createTool(data.toolName, invoke),
    });

    await tools.calling(realm, new AbortController(), [finished, pending]);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0].toolcall).toBe(pending);
    expect(finished.result).toBe(data.result.finished);
  });

  it('参数不是合法 JSON 时应当把解析错误写回结果', async () => {
    const data = await loadCases();
    const toolcall = data.toolCalls.invalidJson as ToolCall;
    const invoke = vi.fn(async () => data.result.success);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const realm = await createRealm({
      [data.toolName]: createTool(data.toolName, invoke),
    });

    await tools.calling(realm, new AbortController(), [toolcall]);

    expect(toolcall.result).toEqual(expect.stringMatching(/^error: /));
    expect(invoke).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('工具抛错时应当把错误信息写回结果', async () => {
    const data = await loadCases();
    const toolcall = data.toolCalls.set as ToolCall;
    const invoke = vi.fn(async () => {
      throw new Error(data.error.thrown);
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const realm = await createRealm({
      [data.toolName]: createTool(data.toolName, invoke),
    });

    await tools.calling(realm, new AbortController(), [toolcall]);

    expect(toolcall.result).toBe(`error: ${data.error.thrown}`);
    expect(error).toHaveBeenCalled();
  });

  it('抛出的不是 Error 时应当回落到 unknown error', async () => {
    const data = await loadCases();
    const toolcall = data.toolCalls.set as ToolCall;
    const invoke = vi.fn(async () => {
      throw data.error.thrown;
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const realm = await createRealm({
      [data.toolName]: createTool(data.toolName, invoke),
    });

    await tools.calling(realm, new AbortController(), [toolcall]);

    expect(toolcall.result).toBe(data.error.unknown);
  });

  it('调用期间应当在 realmInfos 上标记工具名，结束后清理', async () => {
    const data = await loadCases();
    const toolcall = data.toolCalls.set as ToolCall;
    let during: any;
    const invoke = vi.fn(async () => {
      during = useRealmState.getState().realmInfos[toolcall.id];
      return data.result.success;
    });
    const realm = await createRealm({
      [data.toolName]: createTool(data.toolName, invoke),
    });
    useRealmState.setState({ generating: true, realmInfos: {} });

    await tools.calling(realm, new AbortController(), [toolcall]);

    expect(during).toEqual({
      title: 'tool.calling_tool',
      content: data.toolName,
    });
    const infos = useRealmState.getState().realmInfos;
    expect(infos[toolcall.id]).toBeUndefined();
    expect(infos.main).toEqual({ title: 'tool.calling_tool' });
  });

  it('一轮超过并发上限时溢出的调用会排队等待，而不是失败', async () => {
    const data = await loadCases();
    const toolName = data.toolName;
    // 让前 8 个调用都挂在 invoke 里，第 9 个才会撞上并发上限
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const invoke = vi.fn(async (_ctx: CallContext) => {
      await gate;
      return data.result.success;
    });
    const realm = await createRealm({
      [toolName]: createTool(toolName, invoke),
    });
    const controller = new AbortController();

    // TaskRunner 的并发上限是 8，这里给 9 个调用
    const toolCalls: ToolCall[] = Array.from({ length: 9 }, (_, index) => ({
      index,
      id: `${data.toolCalls.set.id}_${index}`,
      name: toolName,
      arguments: data.toolCalls.set.arguments,
    }));
    const overflow = toolCalls[8];

    const calling = tools.calling(realm, controller, toolCalls);
    await settle();

    // 上限内先跑 8 个；第 9 个留在队列里（既不报错，也不写 error 结果）
    expect(invoke).toHaveBeenCalledTimes(8);
    expect(overflow.result).toBeUndefined();

    // 空位出现后第 9 个补位执行，全部调用都拿到结果
    release();
    await expect(calling).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledTimes(9);
    for (const toolCall of toolCalls) {
      expect(toolCall.result).toBe(data.result.success);
    }
  });
});
