import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validate } from 'uuid';

import { utils } from '@/database';
import { BusinessError } from '@/interceptors';
import type { Task, TaskInfo } from '@/tasks';
import { TaskRunner } from '@/tasks';
import { Mutex } from '@/utils/mutex';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

interface TestArgs {
  provider: string;
  value?: number;
}

/**
 * 基类的 execute 是 protected，用例用一个可控子类驱动它：
 * 默认挂起（由用例决定何时成功/失败），也可以切成「立即成功」。
 */
class TestRunner extends TaskRunner<TestArgs> {
  /** 每次 execute 收到的任务信息，按调用顺序排列 */
  readonly executions: TaskInfo<TestArgs>[] = [];
  /** 立即结束 execute，用于观察「不阻塞」的编排 */
  manual = true;
  result?: string;

  private deferreds: Array<{
    resolve: (value?: string) => void;
    reject: (err: unknown) => void;
  }> = [];

  protected async execute(
    task: TaskInfo<TestArgs>,
  ): Promise<string | undefined> {
    this.executions.push(task);
    if (!this.manual) return this.result;
    return await new Promise<string | undefined>((resolve, reject) => {
      this.deferreds.push({ resolve, reject });
    });
  }

  /** 结束第 index 个还没结束的 execute（默认第一个） */
  release(value?: string, index = 0) {
    this.deferreds.splice(index, 1)[0]?.resolve(value);
  }

  /** 让第 index 个还没结束的 execute 抛错（默认第一个） */
  fail(err: unknown, index = 0) {
    this.deferreds.splice(index, 1)[0]?.reject(err);
  }

  /** 入队但不启动，用来单独验证 pending 分支 */
  enqueue(task: Task) {
    return this.queue(task);
  }

  // 下面几个只是把 protected 暴露出来给断言用
  get pendingTasks(): Task[] {
    return this.pending;
  }

  get runningTasks(): Map<string, TaskInfo> {
    return this.running;
  }

  get mutexState() {
    return this.mutex;
  }
}

/** 让出事件循环，等 run → success/failed → finish 这条链推进 */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  // 只接管 Date，setTimeout 等仍走真实实现，方便用 settle() 推进微任务链
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tasks TaskRunner / 入队与执行', () => {
  it('create 应当生成 uuid 并立刻把任务交给 execute', async () => {
    const data = await loadCases();
    const runner = new TestRunner();
    const now = Date.now();

    const task = await runner.create(data.names.alpha, data.args.alpha);

    expect(validate(task.id)).toBe(true);
    expect(task.name).toBe(data.names.alpha);
    expect(task.args).toEqual(data.args.alpha);
    expect(runner.pendingTasks).toEqual([]);
    expect(runner.executions).toHaveLength(1);

    const info = runner.executions[0];
    expect(info.id).toBe(task.id);
    expect(info.name).toBe(data.names.alpha);
    expect(info.args).toEqual(data.args.alpha);
    expect(info.controller).toBeInstanceOf(AbortController);
    expect(info.status).toBe('running');
    expect(info.attempt).toBe(0);
    expect(info.queue).toBe(now);
    expect(info.start).toBe(now);
    expect(info.finish).toBeUndefined();
    expect(runner.runningTasks.get(task.id)).toBe(info);
  });

  it('每个任务都应当有独立的 AbortController', async () => {
    const data = await loadCases();
    const runner = new TestRunner();

    const tasks = await Promise.all([
      runner.create(data.names.alpha, data.args.alpha),
      runner.create(data.names.beta, data.args.beta),
    ]);

    expect(runner.runningTasks.size).toBe(2);
    const byId = new Map(runner.executions.map((u) => [u.id, u]));
    const controllers = tasks.map((u) => byId.get(u.id)!.controller);
    expect(controllers[0]).not.toBe(controllers[1]);

    controllers[0].abort();
    expect(controllers[0].signal.aborted).toBe(true);
    expect(controllers[1].signal.aborted).toBe(false);
  });

  it('并发 create 不丢任务，全部执行完后队列与运行集合都清空', async () => {
    const data = await loadCases();
    const runner = new TestRunner();
    runner.manual = false;
    runner.result = data.results.alpha;

    const names = [data.names.alpha, data.names.beta, data.names.gamma];
    const tasks = await Promise.all(
      names.map((name, index) =>
        runner.create(name, { provider: `provider.${index}` }),
      ),
    );
    await settle();

    const createdIds = tasks.map((u) => u.id);
    const executedIds = runner.executions.map((u) => u.id);
    expect(executedIds).toHaveLength(createdIds.length);
    // 同一个任务不会被启动两次
    expect([...executedIds].sort()).toEqual([...createdIds].sort());
    expect(runner.pendingTasks).toEqual([]);
    expect(runner.runningTasks.size).toBe(0);

    // 串行保证来自真实的 Mutex（不是桩），跑完应当没有残留的锁
    expect(runner.mutexState).toBeInstanceOf(Mutex);
    expect(runner.mutexState.queue).toHaveLength(0);
    expect(runner.mutexState.current).toBeUndefined();
  });
});

describe('tasks TaskRunner / 成功与失败', () => {
  it('execute 成功时应当落成 completed 并写入结果', async () => {
    const data = await loadCases();
    const runner = new TestRunner();
    const task = await runner.create(data.names.alpha, data.args.alpha);
    const info = runner.executions[0];
    const now = Date.now();
    vi.setSystemTime(now + 1000);

    runner.release(data.results.alpha);
    await settle();

    expect(info.status).toBe('completed');
    expect(info.result).toBe(data.results.alpha);
    expect(info.finish).toBe(now + 1000);
    expect(runner.runningTasks.has(task.id)).toBe(false);
    expect(runner.runningTasks.size).toBe(0);
  });

  it('execute 抛 BusinessError 时应当落成 failed 并序列化 code 与 data', async () => {
    const data = await loadCases();
    const runner = new TestRunner();
    await runner.create(data.names.alpha, data.args.alpha);
    const info = runner.executions[0];

    runner.fail(
      new BusinessError(
        data.failures.business.message,
        data.failures.business.code,
      ).withValue('field', 'default.value'),
    );
    await settle();

    expect(info.status).toBe('failed');
    const result = JSON.parse(info.result!);
    expect(result.message).toBe(data.failures.business.message);
    expect(result.code).toBe(data.failures.business.code);
    expect(result.data).toEqual({ field: 'default.value' });
    expect(runner.runningTasks.size).toBe(0);
  });

  it('execute 抛普通错误时也应当落成 failed', async () => {
    const data = await loadCases();
    const runner = new TestRunner();
    await runner.create(data.names.beta, data.args.beta);
    const info = runner.executions[0];

    runner.fail(new TypeError(data.failures.plain));
    await settle();

    expect(info.status).toBe('failed');
    const result = JSON.parse(info.result!);
    expect(result.name).toBe('TypeError');
    expect(result.message).toBe(data.failures.plain);
    expect(result.code).toBeUndefined();
    expect(runner.runningTasks.size).toBe(0);
  });
});

describe('tasks TaskRunner / 并发上限与队列', () => {
  it('达到上限时新任务应当留在队列，等前一个结束再自动启动', async () => {
    const data = await loadCases();
    const runner = new TestRunner(1);

    await runner.create(data.names.alpha, data.args.alpha);
    // 上限已满：这两个 create 会在 start 阶段被上限挡掉，但任务已经入队
    const settled = await Promise.allSettled([
      runner.create(data.names.beta, data.args.beta),
      runner.create(data.names.gamma, data.args.gamma),
    ]);

    expect(settled.map((u) => u.status)).toEqual(['rejected', 'rejected']);
    expect(settled[0]).toMatchObject({
      reason: { message: 'running task over limit!' },
    });
    expect(runner.pendingTasks.map((u) => u.name)).toEqual([
      data.names.beta,
      data.names.gamma,
    ]);
    expect(runner.executions.map((u) => u.name)).toEqual([data.names.alpha]);

    // 前一个结束后 finish 会自动拉起队列里的下一个
    runner.release(data.results.alpha);
    await settle();
    expect(runner.executions.map((u) => u.name)).toEqual([
      data.names.alpha,
      data.names.beta,
    ]);
    expect(runner.pendingTasks.map((u) => u.name)).toEqual([data.names.gamma]);

    runner.release(data.results.alpha);
    await settle();
    expect(runner.executions.map((u) => u.name)).toEqual([
      data.names.alpha,
      data.names.beta,
      data.names.gamma,
    ]);
    expect(runner.pendingTasks).toEqual([]);

    runner.release(data.results.alpha);
    await settle();
    expect(runner.runningTasks.size).toBe(0);
  });
});

describe('tasks TaskRunner / restart', () => {
  it('restart 应当取消原控制器、attempt+1 并重新执行', async () => {
    const data = await loadCases();
    const runner = new TestRunner();
    const task = await runner.create(data.names.alpha, data.args.alpha);
    const origin = runner.executions[0];
    const now = Date.now();
    vi.setSystemTime(now + 500);

    await runner.restart(task.id);

    expect(runner.executions).toHaveLength(2);
    const retried = runner.executions[1];
    expect(retried).not.toBe(origin);
    expect(retried.id).toBe(task.id);
    expect(retried.attempt).toBe(origin.attempt + 1);
    expect(retried.controller).not.toBe(origin.controller);
    expect(retried.status).toBe('running');
    expect(retried.start).toBe(now + 500);

    expect(origin.controller.signal.aborted).toBe(true);
    const reason = origin.controller.signal.reason as BusinessError;
    expect(reason.message).toBe('restart');
    expect(reason.code).toBe('error.restart');

    // 重试这一轮结束后运行集合清空
    runner.release(data.results.alpha, 1);
    await settle();
    expect(retried.status).toBe('completed');
    expect(retried.result).toBe(data.results.alpha);
    expect(runner.runningTasks.size).toBe(0);
  });

  it('restart 非运行中的任务应当报错', async () => {
    const data = await loadCases();
    const runner = new TestRunner();

    await expect(runner.restart(data.ids.missing)).rejects.toThrow(
      'only running task canbe restart!',
    );
    expect(runner.executions).toHaveLength(0);
  });
});

describe('tasks TaskRunner / delete', () => {
  it('删除排队中的任务应当标记 cancelled、移出队列且不执行', async () => {
    const data = await loadCases();
    const runner = new TestRunner(1);
    const queued: Task = {
      id: utils.uuid(),
      name: data.names.beta,
      args: data.args.beta,
      attempt: 0,
      status: 'pending',
    };
    await runner.enqueue(queued);
    expect(runner.pendingTasks).toEqual([queued]);

    await runner.delete(queued.id);

    expect(queued.status).toBe('cancelled');
    expect(runner.pendingTasks).toEqual([]);
    expect(runner.runningTasks.size).toBe(0);
    expect(runner.executions).toHaveLength(0);
  });

  it('删除运行中的任务应当取消控制器并移出运行集合', async () => {
    const data = await loadCases();
    const runner = new TestRunner();
    const task = await runner.create(data.names.alpha, data.args.alpha);
    const info = runner.executions[0];

    await runner.delete(task.id);

    expect(info.status).toBe('cancelled');
    expect(info.controller.signal.aborted).toBe(true);
    const reason = info.controller.signal.reason as BusinessError;
    expect(reason.message).toBe('canceled');
    expect(reason.code).toBe('error.canceled');
    expect(runner.runningTasks.has(task.id)).toBe(false);

    // 迟到的结果不会把任务重新登记回运行集合
    runner.release(data.results.alpha);
    await settle();
    expect(runner.runningTasks.size).toBe(0);
    expect(runner.executions).toHaveLength(1);
  });

  it('删除不存在的任务不应抛错，也不影响已有任务', async () => {
    const data = await loadCases();
    const runner = new TestRunner();
    const task = await runner.create(data.names.alpha, data.args.alpha);

    await expect(runner.delete(data.ids.missing)).resolves.toBeUndefined();

    expect(runner.runningTasks.has(task.id)).toBe(true);
    expect(runner.runningTasks.size).toBe(1);
    expect(runner.executions).toHaveLength(1);
  });
});
