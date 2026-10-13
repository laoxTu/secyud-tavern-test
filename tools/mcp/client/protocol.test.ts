import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ raw: vi.fn() }));

// 只拦代理层：用例关心的是发给 mcp 服务器的报文与实际发出的请求形状，不真发请求
vi.mock('@/global/client/proxy', () => ({ proxy: { raw: mocks.raw } }));

import { BusinessError } from '@/interceptors';
import type { McpConfig } from '@/tools/mcp';
import { McpClient } from '@/tools/mcp/client/protocol';

type SentRequest = { param: any; payload: any };

/** 发出去的报文，按顺序累积，断言请求形状用 */
let sent: SentRequest[] = [];

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./protocol.cases.json')).default);
}

/** json 响应，会话id按 Streamable HTTP 的约定放在响应头里 */
function jsonResponse(payload: any, session?: string) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...(session ? { 'mcp-session-id': session } : {}),
    },
  });
}

/** sse 响应，一条消息一个事件 */
function sseResponse(messages: any[]) {
  const body = messages
    .map((u) => `event: message\ndata: ${JSON.stringify(u)}\n\n`)
    .join('');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function ok(id: number, result: any) {
  return { jsonrpc: '2.0', id, result };
}

/**
 * 按方法分发响应，模拟一个最小的 mcp 服务器。
 * 未声明的方法直接抛错，避免用例漏配之后静默通过。
 */
function serve(handlers: Record<string, (payload: any) => Response>) {
  mocks.raw.mockImplementation(async (param: any) => {
    const payload = JSON.parse(param.body);
    sent.push({ param, payload });
    const handler = handlers[payload.method];
    if (!handler) throw new Error(`unexpected method: ${payload.method}`);
    return handler(payload);
  });
}

/** 一个回显工具的最小服务器 */
async function serveEcho(
  overrides: Record<string, (payload: any) => Response> = {},
) {
  const data = await loadCases();
  serve({
    initialize: (p) =>
      jsonResponse(ok(p.id, data.initializeResult), data.sessionId),
    'notifications/initialized': () => new Response(null, { status: 202 }),
    'tools/list': (p) => jsonResponse(ok(p.id, data.tools)),
    'tools/call': (p) => jsonResponse(ok(p.id, data.callText)),
    ...overrides,
  });
  return data;
}

function createClient(config: McpConfig) {
  return new McpClient(structuredClone(config));
}

/** 中止时请求层抛的错误。不用 DOMException：jsdom 里的原型链与 Error 不同源 */
function abortError() {
  return Object.assign(new Error('The operation was aborted.'), {
    name: 'AbortError',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.raw.mockReset();
  sent = [];
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tools mcp protocol / 会话', () => {
  it('应当依次发 initialize / initialized / tools/list，并在后续请求带上会话id', async () => {
    const data = await serveEcho();
    const client = createClient(data.config);

    const tools = await client.listTools(new AbortController().signal);

    expect(sent.map((u) => u.payload.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
    expect(tools).toEqual(data.tools.tools);

    // 端点、方法与请求头
    const first = sent[0].param;
    expect(first.url).toBe(data.config.url);
    expect(first.method).toBe('POST');
    expect(first.headers['Content-Type']).toBe('application/json');
    // 两种 Accept 都要声明，否则部分服务端判 406
    expect(first.headers['Accept']).toBe('application/json, text/event-stream');
    expect(first.headers['X-Token']).toBe(data.config.headers['X-Token']);
    // 会话id来自响应头，第一次请求时还没有
    expect(first.headers['Mcp-Session-Id']).toBeUndefined();

    // 初始化参数
    expect(sent[0].payload.params.protocolVersion).toBe('2025-06-18');
    expect(sent[0].payload.params.clientInfo.name).toBe('secyud-tavern');

    // 后续请求带上会话id
    expect(sent[2].param.headers['Mcp-Session-Id']).toBe(data.sessionId);
  });

  it('同一个实例只初始化一次', async () => {
    const data = await serveEcho();
    const client = createClient(data.config);
    const signal = new AbortController().signal;

    await client.listTools(signal);
    await client.listTools(signal);

    const methods = sent.map((u) => u.payload.method);
    expect(methods.filter((u) => u === 'initialize')).toHaveLength(1);
    expect(methods.filter((u) => u === 'tools/list')).toHaveLength(2);
  });

  it('初始化失败后应当清掉缓存，允许下一次重试', async () => {
    const data = await loadCases();
    let attempt = 0;
    serve({
      initialize: (p) => {
        if (attempt++ === 0) return new Response('boom', { status: 500 });
        return jsonResponse(ok(p.id, data.initializeResult), data.sessionId);
      },
      'notifications/initialized': () => new Response(null, { status: 202 }),
      'tools/list': (p) => jsonResponse(ok(p.id, data.tools)),
    });
    const client = createClient(data.config);
    const signal = new AbortController().signal;

    await expect(client.listTools(signal)).rejects.toThrow(BusinessError);
    await expect(client.listTools(signal)).resolves.toEqual(data.tools.tools);
  });
});

describe('tools mcp protocol / tools/call', () => {
  it('应当把工具名与参数发出去，并返回文本结果', async () => {
    const data = await serveEcho();
    const client = createClient(data.config);

    const result = await client.callTool(
      data.call.name,
      data.call.arguments,
      new AbortController().signal,
    );

    expect(result).toBe(data.expected.callText);
    expect(sent.at(-1)!.payload.params).toEqual({
      name: data.call.name,
      arguments: data.call.arguments,
    });
  });

  it('服务端用 sse 回包时应当跳过通知，只取 id 匹配的那条', async () => {
    const data = await serveEcho({
      'tools/call': (p) =>
        sseResponse([
          { jsonrpc: '2.0', method: 'notifications/progress', params: {} },
          ok(p.id, data.callText),
        ]),
    });
    const client = createClient(data.config);

    const result = await client.callTool(
      data.call.name,
      data.call.arguments,
      new AbortController().signal,
    );

    expect(result).toBe(data.expected.callText);
  });

  it('图片这类非文本内容应当转成 json 拼接', async () => {
    const data = await serveEcho({
      'tools/call': (p) => jsonResponse(ok(p.id, data.callMulti)),
    });
    const client = createClient(data.config);

    const result = await client.callTool(
      data.call.name,
      data.call.arguments,
      new AbortController().signal,
    );

    // 非文本项按 json 序列化，键顺序由 fixture 决定，这里拆开比对而不是比字符串
    const [text, image] = result.split('\n');
    expect(text).toBe(data.callMulti.content[0].text);
    expect(JSON.parse(image)).toEqual(data.callMulti.content[1]);
  });

  it('没有内容时返回空串', async () => {
    const data = await serveEcho({
      'tools/call': (p) => jsonResponse(ok(p.id, data.callEmpty)),
    });
    const client = createClient(data.config);

    const result = await client.callTool(
      data.call.name,
      data.call.arguments,
      new AbortController().signal,
    );

    expect(result).toBe(data.expected.callEmpty);
  });

  it('isError 的结果要标成 error，模型才知道调用失败了', async () => {
    const data = await serveEcho({
      'tools/call': (p) => jsonResponse(ok(p.id, data.callError)),
    });
    const client = createClient(data.config);

    const result = await client.callTool(
      data.call.name,
      data.call.arguments,
      new AbortController().signal,
    );

    expect(result).toBe(data.expected.callError);
  });
});

describe('tools mcp protocol / 失败', () => {
  it('jsonrpc 层的 error 应当抛 BusinessError，并带上方法与错误码', async () => {
    const data = await serveEcho({
      'tools/call': (p) =>
        jsonResponse({
          jsonrpc: '2.0',
          id: p.id,
          error: data.jsonrpcError,
        }),
    });
    const client = createClient(data.config);

    const promise = client.callTool(
      data.call.name,
      data.call.arguments,
      new AbortController().signal,
    );

    await expect(promise).rejects.toMatchObject({
      code: 'error.mcp.request_failed',
      data: { method: 'tools/call', url: data.config.url },
    });
    await expect(promise).rejects.toThrow(data.jsonrpcError.message);
  });

  it('非 2xx 响应应当抛 BusinessError 并带上状态码', async () => {
    const data = await loadCases();
    serve({
      initialize: () => new Response('nope', { status: 401 }),
    });
    const client = createClient(data.config);

    const promise = client.listTools(new AbortController().signal);

    await expect(promise).rejects.toMatchObject({
      code: 'error.mcp.request_failed',
      data: { status: 401, url: data.config.url },
    });
  });

  it('超过 timeout 秒应当中止请求', async () => {
    const data = await loadCases();
    const config = { ...data.config, timeout: 5 };
    mocks.raw.mockImplementation(
      (_param: any, options: any) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(abortError()));
        }),
    );

    vi.useFakeTimers();
    try {
      const promise = createClient(config).listTools(
        new AbortController().signal,
      );
      const assertion = expect(promise).rejects.toThrow('aborted');

      // timeout 配置的单位是秒，定时器拿到的是 *1000
      await vi.advanceTimersByTimeAsync(config.timeout * 1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('外部中止时子信号应当被传递下去', async () => {
    const data = await loadCases();
    let received: AbortSignal | undefined;
    mocks.raw.mockImplementation(
      (_param: any, options: any) =>
        new Promise((_resolve, reject) => {
          received = options.signal;
          options.signal.addEventListener('abort', () => reject(abortError()));
        }),
    );

    const outer = new AbortController();
    const client = createClient(data.config);
    const promise = client.listTools(outer.signal);

    expect(received).toBeDefined();
    expect(received).not.toBe(outer.signal);
    expect(received!.aborted).toBe(false);

    outer.abort();
    expect(received!.aborted).toBe(true);
    await expect(promise).rejects.toThrow('aborted');
  });
});
