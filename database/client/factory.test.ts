import { describe, expect, it, vi } from 'vitest';

import type { DataRequest, DataResponse } from '@/database';
import type { FetchState } from '@/database/client/factory';
import { states } from '@/database/client/factory';

interface Item {
  id: string;
}
interface Search {
  fuzzy: string;
}
interface Params {
  entryType: string;
}

type State = Partial<FetchState<Item, Search, Params>>;

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./factory.cases.json')).default);
}

type Fetcher = (
  request?: DataRequest<Search>,
  params?: Params,
) => Promise<DataResponse<Item>>;

/** 用一个真实对象模拟 zustand 的 set/get，保证 fetch 内部读到的就是刚写进去的状态 */
function createStore(initial: State, fetcher: Fetcher) {
  let state: State = { ...initial };
  const set = vi.fn((partial: State) => {
    state = { ...state, ...partial };
  });
  const get = () => state as FetchState<Item, Search, Params>;
  const fetch = states.createFetch<Item, Search, Params>(set, get, fetcher);

  return { set, fetch, read: () => state };
}

describe('database client factory / 默认请求', () => {
  it('没有 options 时应当只置 loading，并按当前状态请求', async () => {
    const data = await loadCases();
    const fetcher = vi.fn<Fetcher>(async () => ({
      items: data.items,
      length: data.responses.threeOfTen.length,
    }));
    const store = createStore(
      {
        cur: 0,
        size: data.pageSize,
        max: 0,
        loading: false,
        items: [],
      },
      fetcher,
    );

    await store.fetch();

    expect(store.set.mock.calls[0][0]).toEqual({ loading: true });
    expect(fetcher).toHaveBeenCalledWith(
      { search: undefined, size: data.pageSize, skip: 0 },
      undefined,
    );
    expect(store.read().items).toEqual(data.items);
    // 3 条 / 每页 10 → 1 页
    expect(store.read().max).toBe(1);
    expect(store.read().loading).toBe(false);
  });

  it('skip 应当等于 cur * size', async () => {
    const data = await loadCases();
    const fetcher = vi.fn<Fetcher>(async () => ({
      items: data.items,
      length: data.responses.hundred.length,
    }));
    const store = createStore({ cur: 3, size: 7, max: 0, loading: false }, fetcher);

    await store.fetch();

    expect(fetcher).toHaveBeenCalledWith(
      { search: undefined, size: 7, skip: 21 },
      undefined,
    );
    expect(store.read().max).toBe(Math.ceil(data.responses.hundred.length / 7));
  });
});

describe('database client factory / options 合并', () => {
  it('page 与 size 应当覆盖当前分页，search/params 走合并回调', async () => {
    const data = await loadCases();
    const fetcher = vi.fn<Fetcher>(async () => ({
      items: data.items,
      length: data.responses.twenty.length,
    }));
    const store = createStore(
      {
        cur: 0,
        size: data.pageSize,
        max: 0,
        loading: false,
        search: data.search,
        params: data.params,
      },
      fetcher,
    );
    const search = vi.fn((current?: Search) => ({
      fuzzy: `${current?.fuzzy}!`,
    }));
    const params = vi.fn((current?: Params) => ({
      entryType: `${current?.entryType}!`,
    }));

    await store.fetch({ page: 2, size: 5, search, params });

    expect(store.set.mock.calls[0][0]).toEqual({
      cur: 2,
      size: 5,
      search: { fuzzy: `${data.search.fuzzy}!` },
      params: { entryType: `${data.params.entryType}!` },
      loading: true,
    });
    expect(search).toHaveBeenCalledWith(data.search);
    expect(params).toHaveBeenCalledWith(data.params);
    expect(fetcher).toHaveBeenCalledWith(
      {
        search: { fuzzy: `${data.search.fuzzy}!` },
        size: 5,
        skip: 10,
      },
      { entryType: `${data.params.entryType}!` },
    );
    expect(store.read().max).toBe(Math.ceil(data.responses.twenty.length / 5));
  });

  it('只给 page/size 时 search 与 params 应当保持原值', async () => {
    const data = await loadCases();
    const fetcher = vi.fn<Fetcher>(async () => ({
      items: data.items,
      length: data.responses.twenty.length,
    }));
    const store = createStore(
      {
        cur: 0,
        size: data.pageSize,
        max: 0,
        loading: false,
        search: data.search,
        params: data.params,
      },
      fetcher,
    );

    await store.fetch({ page: 1, size: 5 });

    expect(fetcher).toHaveBeenCalledWith(
      { search: data.search, size: 5, skip: 5 },
      data.params,
    );
  });

  it('当前没有 search/params 时合并回调应当收到 undefined', async () => {
    const data = await loadCases();
    const fetcher = vi.fn<Fetcher>(async () => ({
      items: data.items,
      length: data.responses.threeOfTen.length,
    }));
    const store = createStore(
      { cur: 0, size: data.pageSize, max: 0, loading: false },
      fetcher,
    );

    await store.fetch({ search: (current) => current, params: (current) => current });

    expect(fetcher).toHaveBeenCalledWith(
      { search: undefined, size: data.pageSize, skip: 0 },
      undefined,
    );
  });
});

describe('database client factory / 越界回退', () => {
  it('cur 越界时应当回退到最后一页并重新请求', async () => {
    const data = await loadCases();
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce({
        items: data.items,
        length: data.responses.twentyFive.length,
      })
      .mockResolvedValueOnce({
        items: data.fallbackItems,
        length: data.responses.twentyFive.length,
      });
    const store = createStore({ cur: 5, size: 10, max: 0, loading: false }, fetcher);

    await store.fetch();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toEqual({
      search: undefined,
      size: 10,
      skip: 50,
    });
    // 25 条 / 每页 10 → 3 页，最后一页下标为 2
    expect(store.set.mock.calls[1][0]).toEqual({ cur: 2 });
    expect(fetcher.mock.calls[1][0]).toEqual({
      search: undefined,
      size: 10,
      skip: 20,
    });
    expect(store.read().cur).toBe(2);
    // items 取第二次请求的结果；max 由 25 条 / 每页 10 得出
    expect(store.read().items).toEqual(data.fallbackItems);
    expect(store.read().max).toBe(3);
  });

  it('cur 正好是最后一页时不应当回退', async () => {
    const data = await loadCases();
    const fetcher = vi.fn<Fetcher>(async () => ({
      items: data.items,
      length: data.responses.twentyFive.length,
    }));
    const store = createStore({ cur: 2, size: 10, max: 0, loading: false }, fetcher);

    await store.fetch();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.read().max).toBe(3);
    expect(store.read().cur).toBe(2);
  });

  it('结果为空时 max 为 0 且不回退', async () => {
    const data = await loadCases();
    const fetcher = vi.fn<Fetcher>(async () => ({
      items: [],
      length: data.responses.empty.length,
    }));
    const store = createStore({ cur: 3, size: 10, max: 0, loading: false }, fetcher);

    await store.fetch();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.read().max).toBe(0);
    expect(store.read().items).toEqual([]);
  });
});

describe('database client factory / 异常', () => {
  it('请求失败时应当结束 loading 并抛出原错误', async () => {
    const fetcher = vi.fn<Fetcher>(async () => {
      throw new Error('boom');
    });
    const store = createStore({ cur: 0, size: 10, max: 0, loading: false }, fetcher);

    await expect(store.fetch()).rejects.toThrow('boom');

    expect(store.read().loading).toBe(false);
    expect(store.set.mock.calls.at(-1)![0]).toEqual({ loading: false });
  });

  it('回退后的第二次请求失败时同样结束 loading，且不写入结果', async () => {
    const data = await loadCases();
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce({
        items: data.items,
        length: data.responses.twentyFive.length,
      })
      .mockRejectedValueOnce(new Error('boom'));
    const store = createStore({ cur: 5, size: 10, max: 0, loading: false }, fetcher);

    await expect(store.fetch()).rejects.toThrow('boom');

    expect(store.read().cur).toBe(2);
    // 结果与 max 都没写进去，保持初始值
    expect(store.read().items).toBeUndefined();
    expect(store.read().max).toBe(0);
    expect(store.read().loading).toBe(false);
  });
});
