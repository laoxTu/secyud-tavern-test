import { describe, expect, it, vi } from 'vitest';

import { Mutex } from '@/utils/mutex';

/** 造一个可控的异步动作，手动决定何时结束 */
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** 让出事件循环，等待队列推进 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Mutex / 串行执行', () => {
  it('同一时间只应当有一个动作在执行', async () => {
    const mutex = new Mutex();
    const order: string[] = [];
    const first = deferred();
    const second = deferred();

    const locking = [
      mutex.lock(async () => {
        order.push('first:start');
        await first.promise;
        order.push('first:end');
      }),
      mutex.lock(async () => {
        order.push('second:start');
        await second.promise;
        order.push('second:end');
      }),
    ];

    await tick();
    // 第二个动作必须等第一个结束
    expect(order).toEqual(['first:start']);

    first.release();
    await tick();
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);

    second.release();
    await expect(Promise.all(locking)).resolves.toEqual([
      'success',
      'success',
    ]);
    expect(order).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ]);
  });

  it('动作按入队顺序执行', async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3, 4].map((index) =>
        mutex.lock(async () => {
          await tick();
          order.push(index);
        }),
      ),
    );

    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('成功时应当时 resolve success', async () => {
    const mutex = new Mutex();

    await expect(mutex.lock(async () => {})).resolves.toBe('success');
  });

  it('前一个动作结束后队列应当清空', async () => {
    const mutex = new Mutex();

    await mutex.lock(async () => {});
    await tick();

    expect(mutex.queue).toHaveLength(0);
    expect(mutex.current).toBeUndefined();
  });
});

describe('Mutex / 失败处理', () => {
  it('动作抛错时应当把错误传给对应的调用方', async () => {
    const mutex = new Mutex();
    const error = new Error('boom');

    await expect(
      mutex.lock(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it('一个动作失败不应阻塞后面的动作', async () => {
    const mutex = new Mutex();
    const order: string[] = [];

    const failing = mutex.lock(async () => {
      order.push('failing');
      throw new Error('boom');
    });
    const next = mutex.lock(async () => {
      order.push('next');
    });

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('success');
    expect(order).toEqual(['failing', 'next']);
  });

  it('失败之后仍然可以继续加锁', async () => {
    const mutex = new Mutex();

    await expect(
      mutex.lock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(mutex.lock(async () => {})).resolves.toBe('success');
  });
});
