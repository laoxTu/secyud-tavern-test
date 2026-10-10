import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRegistry } from '@/plugins';
import type { ToastMessage } from '@/signal';
import { signals } from '@/signal';
import { registry, signals as serverSignals } from '@/signal/server';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

const registeredIds: string[] = [];

/** fixture 里的订阅是数组（json 装不下 Map），这里装成 registry 需要的事件对象 */
function register(...connections: any[]) {
  const events = connections.map((connection) => ({
    id: connection.id,
    sequence: connection.sequence,
    subscriptions: new Map<string, any>(
      connection.subscriptions.map((item: any) => [
        item.type,
        { status: item.status, targets: [...item.targets] },
      ]),
    ),
    send: vi.fn(),
  }));
  for (const event of events) {
    registry.register(event as any);
    registeredIds.push(event.id);
  }
  return events;
}

afterEach(() => {
  // registry 是全局单例，用例用完就清，避免互相污染
  for (const id of registeredIds.splice(0)) registry.unregister(id);
  vi.restoreAllMocks();
});

describe('signal server / registry', () => {
  it('registry 就是 sse-manager 的全局注册表', () => {
    expect(serverSignals.registry).toBe(registry);
    expect(registry).toBe(getRegistry('sse-manager'));
  });

  it('signals 复用了主模块的工具方法', () => {
    expect(serverSignals.setAbort).toBe(signals.setAbort);
    expect(serverSignals.createSub).toBe(signals.createSub);
    expect(typeof serverSignals.send).toBe('function');
    expect(typeof serverSignals.toast).toBe('function');
  });
});

describe('signal server / send', () => {
  it('只有订阅了该类型的连接会收到消息', async () => {
    const data = await loadCases();
    const [all, none] = register(data.connections.all, data.connections.none);

    await serverSignals.send(data.message);

    expect(all.send).toHaveBeenCalledTimes(1);
    expect(all.send).toHaveBeenCalledWith(data.message);
    expect(none.send).not.toHaveBeenCalled();
  });

  it('status 为 all 时不做 target 过滤', async () => {
    const data = await loadCases();
    const [all] = register(data.connections.all);

    await serverSignals.send({ ...data.message, target: data.missTarget });

    expect(all.send).toHaveBeenCalledTimes(1);
  });

  it('status 为 part 时只发给 targets 命中的连接', async () => {
    const data = await loadCases();
    const [part] = register(data.connections.part);
    const target = data.connections.part.subscriptions[0].targets[0];
    expect(target).not.toBe(data.missTarget);

    await serverSignals.send({ ...data.message, target });
    expect(part.send).toHaveBeenCalledTimes(1);

    await serverSignals.send({ ...data.message, target: data.missTarget });
    expect(part.send).toHaveBeenCalledTimes(1);

    // 没有 target 的消息也进不了 part 订阅
    await serverSignals.send(data.message);
    expect(part.send).toHaveBeenCalledTimes(1);
  });

  it('发送抛错的连接被注销，后面的连接继续收到消息', async () => {
    const data = await loadCases();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [broken, tail] = register(
      data.connections.broken,
      data.connections.tail,
    );
    broken.send.mockImplementation(() => {
      throw new Error(data.errorText);
    });

    await serverSignals.send(data.message);

    expect(broken.send).toHaveBeenCalledTimes(1);
    expect(registry.record(data.connections.broken.id)).toBeNull();
    expect(tail.send).toHaveBeenCalledTimes(1);
    expect((error.mock.calls[0][0] as Error).message).toBe(data.errorText);
  });

  it('没有 send 实现的连接被跳过且不会被注销', async () => {
    const data = await loadCases();
    const [silent] = register(data.connections.silent);
    silent.send = undefined as any;

    await expect(serverSignals.send(data.message)).resolves.toBeUndefined();

    expect(registry.record(data.connections.silent.id)).toBe(silent);
  });

  it('按 registry.sorted() 的顺序依次发送', async () => {
    const data = await loadCases();
    const events = register(...data.ordered);
    const order: string[] = [];
    for (const event of events) {
      event.send.mockImplementation(async () => {
        order.push(event.id);
      });
    }

    await serverSignals.send(data.message);

    const expected = [...data.ordered]
      .sort((a: any, b: any) => a.sequence - b.sequence)
      .map((item: any) => item.id);
    expect(order).toEqual(expected);
    // fixture 的注册顺序本身是乱的，确保上面的断言不是碰巧成立
    expect(order).not.toEqual(data.ordered.map((item: any) => item.id));
  });
});

describe('signal server / toast', () => {
  it('应当把消息包成 type 为 toast 的信号发出去', async () => {
    const data = await loadCases();
    const [event] = register(data.connections.toast);

    // fixture 的 type 是 json 里的 string，这里按真实签名收窄成 ToastType
    await serverSignals.toast(data.toastMessage as ToastMessage);

    expect(event.send).toHaveBeenCalledWith({
      type: 'toast',
      data: data.toastMessage,
    });
  });

  it('没有订阅 toast 的连接收不到', async () => {
    const data = await loadCases();
    const [none] = register(data.connections.none);

    // fixture 的 type 是 json 里的 string，这里按真实签名收窄成 ToastType
    await serverSignals.toast(data.toastMessage as ToastMessage);

    expect(none.send).not.toHaveBeenCalled();
  });
});
