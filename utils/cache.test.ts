import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cache } from '@/utils/server';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./cache.cases.json')).default);
}

/** 缓存挂在 globalThis 单例上，逐用例清空避免相互影响 */
function clearCache() {
  (globalThis as { __cache?: Map<string, unknown> }).__cache?.clear();
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  const data = await loadCases();
  clearCache();
  // 记录一下 key 前缀，方便排查残留
  expect(data.keys.plain.startsWith('utils_cache_')).toBe(true);
});

afterEach(() => {
  clearCache();
  vi.useRealTimers();
});

describe('cache / set 与 get', () => {
  it('set 之后再 get 应当拿到同一个值', async () => {
    const data = await loadCases();

    await cache.set(data.keys.plain, data.values.first);
    const value = await cache.get(data.keys.plain, async () => data.values.second);

    expect(value).toEqual(data.values.first);
  });

  it('未命中时会调用 factory 并写入缓存', async () => {
    const data = await loadCases();
    const factory = vi.fn(async () => data.values.first);

    await expect(cache.get(data.keys.factory, factory)).resolves.toEqual(
      data.values.first,
    );
    expect(factory).toHaveBeenCalledTimes(1);

    await expect(cache.get(data.keys.factory, factory)).resolves.toEqual(
      data.values.first,
    );
    // 第二次命中，不再调用 factory
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('未命中且没有 factory 时应当抛错', async () => {
    const data = await loadCases();

    await expect(cache.get(data.keys.missing)).rejects.toThrow(
      'cache not found',
    );
  });

  it('set 的返回值就是写入的数据', async () => {
    const data = await loadCases();

    await expect(cache.set(data.keys.plain, data.values.first)).resolves.toEqual(
      data.values.first,
    );
  });
});

describe('cache / 过期与续期', () => {
  it('超过过期时间后应当重新取一次', async () => {
    const data = await loadCases();
    const factory = vi.fn(async () => data.values.second);

    await cache.set(data.keys.expired, data.values.first, data.spans.oneSecond);
    // 推进到过期之后
    vi.advanceTimersByTime(2000);

    await expect(cache.get(data.keys.expired, factory)).resolves.toEqual(
      data.values.second,
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('过期前命中会续期（滑动过期）', async () => {
    const data = await loadCases();
    const factory = vi.fn(async () => data.values.second);

    await cache.set(data.keys.sliding, data.values.first, data.spans.oneSecond);
    vi.advanceTimersByTime(800);
    // 命中并续期
    await cache.get(data.keys.sliding, factory);
    vi.advanceTimersByTime(800);
    // 若没有续期，此刻已经超过 1s
    await expect(cache.get(data.keys.sliding, factory)).resolves.toEqual(
      data.values.first,
    );
    expect(factory).not.toHaveBeenCalled();
  });

  it('不传 factory 时过期也会返回旧值', async () => {
    const data = await loadCases();

    await cache.set(data.keys.expired, data.values.first, data.spans.oneSecond);
    vi.advanceTimersByTime(2000);

    await expect(cache.get(data.keys.expired)).resolves.toEqual(
      data.values.first,
    );
  });
});

describe('cache / delete', () => {
  it('删除时返回被删掉的数据，再次 get 会走 factory', async () => {
    const data = await loadCases();

    await cache.set(data.keys.plain, data.values.first);
    await expect(cache.delete(data.keys.plain)).resolves.toEqual(
      data.values.first,
    );
    await expect(
      cache.get(data.keys.plain, async () => data.values.second),
    ).resolves.toEqual(data.values.second);
  });

  it('删除不存在的键时返回 undefined', async () => {
    const data = await loadCases();

    await expect(cache.delete(data.keys.missing)).resolves.toBeUndefined();
  });

  it('没有过期时间时删除仍然生效', async () => {
    const data = await loadCases();

    await cache.set(data.keys.plain, data.values.first, { month: 1 });
    await expect(cache.delete(data.keys.plain)).resolves.toEqual(
      data.values.first,
    );
    await expect(cache.delete(data.keys.plain)).resolves.toBeUndefined();
  });
});

describe('cache / 容量上限', () => {
  it('超过上限时应当按过期时间淘汰最旧的一批', async () => {
    const data = await loadCases();
    const { count, remain } = data.evict;

    for (let i = 0; i < count; i++) {
      await cache.set(`${data.keys.evict}${i}`, i, data.spans.oneDay);
    }

    const storage = (globalThis as { __cache?: Map<string, unknown> }).__cache!;
    expect(storage.size).toBe(remain);
    // 最先写入的键应当被淘汰，最后写入的仍然在
    expect(storage.has(`${data.keys.evict}0`)).toBe(false);
    expect(storage.has(`${data.keys.evict}${count - 1}`)).toBe(true);
  });
});
