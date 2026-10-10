import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  historyAdd: vi.fn(),
}));

// 仓库层整体替换掉，用例只关心调度与回写
vi.mock('@/tasks/server/repository', () => ({
  repository: {
    create: mocks.create,
    update: mocks.update,
    delete: mocks.remove,
    history: { add: mocks.historyAdd },
  },
}));

import type { TaskProvider } from '@/tasks/server/manager';
import { TaskManager, registry } from '@/tasks/server/manager';
import { BusinessError } from '@/interceptors';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./manager.cases.json')).default);
}

/** 让 provider 挂起，由用例决定何时结束 */
const deferreds: Array<{ resolve: () => void; reject: (err: unknown) => void }> =
  [];

const registered: string[] = [];

function registerProvider(id: string) {
  const execute = vi.fn<
    (...args: [args: unknown, controller: AbortController]) => Promise<void>
  >(
    () =>
      new Promise<void>((resolve, reject) => {
        deferreds.push({ resolve, reject });
      }),
  );
  registry.register({ id, execute } as unknown as TaskProvider);
  registered.push(id);
  return execute;
}

/** 立刻结束的 provider，用来观察回写顺序 */
function registerInstantProvider(id: string) {
  const execute = vi.fn<
    (...args: [args: unknown, controller: AbortController]) => Promise<void>
  >(async () => {});
  registry.register({ id, execute } as unknown as TaskProvider);
  registered.push(id);
  return execute;
}

/** 让出事件循环，等 finish → 回写 → start 这条链推进 */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 把还挂着的 provider 全部放行，避免用例之间互相影响 */
async function drain() {
  for (let i = 0; i < 10; i++) {
    deferreds.splice(0).forEach((u) => u.resolve());
    await settle();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // 注册表会往 console.debug 打日志，用例里静音
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
});

afterEach(async () => {
  await drain();
  vi.useRealTimers();
  for (const id of registered.splice(0)) registry.unregister(id);
  vi.restoreAllMocks();
});

describe('tasks manager / 注册与执行', () => {
  it('create 应当入库、按 provider id 派发并回写状态', async () => {
    const data = await loadCases();
    const executeOne = registerProvider(data.providers.one);
    const executeTwo = registerProvider(data.providers.two);
    const manager = new TaskManager();
    const now = Date.now();

    const task = await manager.create(data.names.one, data.args.one);

    // 入库的就是 create 返回的那个对象
    expect(mocks.create.mock.calls[0][0]).toBe(task);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: task.id,
        name: data.names.one,
        args: data.args.one,
        attempt: 0,
      }),
    );
    // 只调用指定的 provider
    expect(executeOne).toHaveBeenCalledTimes(1);
    expect(executeTwo).not.toHaveBeenCalled();
    expect(executeOne.mock.calls[0][0]).toEqual(data.args.one);
    expect(executeOne.mock.calls[0][1]).toBeInstanceOf(AbortController);

    // 启动时回写 running
    expect(mocks.update).toHaveBeenCalledWith(task.id, {
      start: now,
      status: 'running',
      attempt: 0,
    });
    expect(manager.get(task.id)).toBeDefined();

    vi.setSystemTime(now + 1000);
    deferreds.splice(0).forEach((u) => u.resolve());
    await settle();

    // 结束时回写终态与结果
    expect(mocks.update).toHaveBeenLastCalledWith(task.id, {
      finish: now + 1000,
      status: 'completed',
      result: data.result,
    });
    expect(manager.get(task.id)).toBeUndefined();
  });

  it('provider 抛错时应当回写 failed 与序列化后的原因', async () => {
    const data = await loadCases();
    registerProvider(data.providers.one);
    const manager = new TaskManager();
    const task = await manager.create(data.names.one, data.args.one);

    deferreds
      .splice(0)[0]
      .reject(
        new BusinessError(data.failure.message, data.failure.code),
      );
    await settle();

    const [id, payload] = mocks.update.mock.calls.at(-1)!;
    expect(id).toBe(task.id);
    expect(payload.status).toBe('failed');
    const result = JSON.parse(payload.result);
    expect(result.message).toBe(data.failure.message);
    expect(result.code).toBe(data.failure.code);
    expect(manager.get(task.id)).toBeUndefined();
  });

  it('provider 立即完成时也应当先回写 running、再回写终态', async () => {
    const data = await loadCases();
    registerInstantProvider(data.providers.two);
    const manager = new TaskManager();

    const task = await manager.create(data.names.two, data.args.two);
    await settle();

    expect(mocks.update.mock.calls.map((u) => u[1].status)).toEqual([
      'running',
      'completed',
    ]);
    expect(mocks.update.mock.calls.map((u) => u[0])).toEqual([
      task.id,
      task.id,
    ]);
    expect(mocks.update.mock.calls[1][1].result).toBe(data.result);
  });
});

describe('tasks manager / 并发上限', () => {
  it('同时最多运行 8 个，空出位置后队列里的任务自动补位', async () => {
    const data = await loadCases();
    const executeOne = registerProvider(data.providers.one);
    const executeTwo = registerProvider(data.providers.two);
    const manager = new TaskManager();

    const tasks = [];
    for (let index = 0; index < 8; index++) {
      tasks.push(
        await manager.create(data.names.one, {
          provider: data.providers.one,
          value: index,
        }),
      );
    }

    expect(executeOne).toHaveBeenCalledTimes(8);
    expect(new Set(tasks.map((u) => u.id)).size).toBe(8);
    for (const task of tasks) expect(manager.get(task.id)).toBeDefined();

    // 第 9 个受上限限制，先留在队列里不执行
    await Promise.allSettled([
      manager.create(data.names.two, data.args.two),
    ]);
    expect(executeOne).toHaveBeenCalledTimes(8);
    expect(executeTwo).not.toHaveBeenCalled();

    // 放行一个之后应当自动补位执行
    deferreds.shift()!.resolve();
    await settle();
    expect(executeTwo).toHaveBeenCalledTimes(1);
    expect(executeTwo.mock.calls[0][0]).toEqual(data.args.two);
  });
});

describe('tasks manager / restart', () => {
  it('restart 应当先把原状态写进历史，再重新执行', async () => {
    const data = await loadCases();
    const execute = registerProvider(data.providers.one);
    const manager = new TaskManager();
    const task = await manager.create(data.names.one, data.args.one);
    const running = manager.get(task.id)!;

    await manager.restart(task.id);

    expect(mocks.historyAdd).toHaveBeenCalledTimes(1);
    expect(mocks.historyAdd.mock.calls[0][0]).toBe(task.id);
    expect(mocks.historyAdd.mock.calls[0][1]).toBe(running);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenCalledWith(task.id, {
      start: expect.any(Number),
      status: 'running',
      attempt: 1,
    });
    // 历史先落库，新的一轮才开始
    expect(mocks.historyAdd.mock.invocationCallOrder[0]).toBeLessThan(
      execute.mock.invocationCallOrder[1],
    );
  });

  it('restart 非运行中的任务应当报错且不写历史', async () => {
    const data = await loadCases();
    const manager = new TaskManager();

    await expect(manager.restart(data.ids.missing)).rejects.toThrow(
      'only running task canbe restart!',
    );
    expect(mocks.historyAdd).not.toHaveBeenCalled();
  });
});

describe('tasks manager / delete', () => {
  it('delete 应当取消运行中的任务并删除数据库记录', async () => {
    const data = await loadCases();
    const execute = registerProvider(data.providers.one);
    const manager = new TaskManager();
    const task = await manager.create(data.names.one, data.args.one);
    const controller = execute.mock.calls[0][1] as AbortController;

    await manager.delete(task.id);

    expect(controller.signal.aborted).toBe(true);
    expect(mocks.remove).toHaveBeenCalledWith(task.id);
    expect(manager.get(task.id)).toBeUndefined();
  });

  it('删除不存在的任务也应当把删除交给仓库且不抛错', async () => {
    const data = await loadCases();
    const manager = new TaskManager();

    await expect(manager.delete(data.ids.missing)).resolves.toBeUndefined();

    expect(mocks.remove).toHaveBeenCalledWith(data.ids.missing);
  });
});
