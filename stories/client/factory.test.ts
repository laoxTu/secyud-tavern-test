import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/client', () => ({
  get: mocks.get,
  post: mocks.post,
  put: mocks.put,
  del: mocks.del,
  open: vi.fn(),
}));
vi.mock('@/stories/client', async () => {
  const { proxy } = await import('@/stories/client/proxy');
  return { stories: { proxy } };
});

import { createStoryEntryState } from '@/stories/client/factory';
import { useStoryState } from '@/stories/client/state';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./proxy.cases.json')).default);
}

beforeEach(() => {
  vi.clearAllMocks();
  useStoryState.setState({ item: undefined });
});

describe('stories client factory / 初始值', () => {
  it('应当带上名字、默认数据与分页初始值', () => {
    const useEntries = createStoryEntryState('macros', { text: '' });
    const state = useEntries.getState();

    expect(state.name).toBe('macros');
    expect(state.defaultData).toEqual({ text: '' });
    expect(state.size).toBe(5);
    expect(state.cur).toBe(0);
    expect(state.max).toBe(0);
    expect(state.loading).toBe(false);
  });

  it('可以自定义每页条数', () => {
    const useEntries = createStoryEntryState('macros', { text: '' }, 20);

    expect(useEntries.getState().size).toBe(20);
  });
});

describe('stories client factory / 列表请求', () => {
  it('应当把 entryType 注入 search，并保留调用方的 search', async () => {
    const data = await loadCases();
    useStoryState.setState({ item: data.story as any });
    mocks.get.mockResolvedValue({ items: [], length: 0 });
    const useEntries = createStoryEntryState('macros', {});

    // 注意：store 上 refresh 的声明类型只接受 page/size（PagedItemsState 的签名），
    // 运行期它会原样转发给 fetch，所以要传 search 时得走 fetch（或在类型上放宽）
    await useEntries.getState().fetch({
      search: (cur) => ({ ...cur, filter: 'a' }),
    });

    expect(mocks.get).toHaveBeenCalledWith('stories/{id}/entries', {
      params: {
        id: data.ids.story,
        search: { filter: 'a', entryType: 'macros' },
        size: 5,
        skip: 0,
      },
    });
  });

  it('没有 search 时只带 entryType', async () => {
    const data = await loadCases();
    useStoryState.setState({ item: data.story as any });
    mocks.get.mockResolvedValue({ items: [], length: 0 });
    const useEntries = createStoryEntryState('macros', {});

    await useEntries.getState().refresh();

    expect(mocks.get).toHaveBeenCalledWith('stories/{id}/entries', {
      params: {
        id: data.ids.story,
        search: { entryType: 'macros' },
        size: 5,
        skip: 0,
      },
    });
  });

  it('应当按响应长度算页数', async () => {
    const data = await loadCases();
    useStoryState.setState({ item: data.story as any });
    mocks.get.mockResolvedValue({ items: [data.entry], length: 11 });
    const useEntries = createStoryEntryState('macros', {});

    await useEntries.getState().refresh();

    expect(useEntries.getState().items).toEqual([data.entry]);
    // 11 条 / 每页 5 → 3 页
    expect(useEntries.getState().max).toBe(3);
  });

  it('翻页时 skip 应当等于 cur * size', async () => {
    const data = await loadCases();
    useStoryState.setState({ item: data.story as any });
    mocks.get.mockResolvedValue({ items: [], length: 30 });
    const useEntries = createStoryEntryState('macros', {});

    await useEntries.getState().refresh();
    await useEntries.getState().refresh({ page: 2 });

    expect(mocks.get).toHaveBeenLastCalledWith('stories/{id}/entries', {
      params: {
        id: data.ids.story,
        search: { entryType: 'macros' },
        size: 5,
        skip: 10,
      },
    });
    expect(useEntries.getState().cur).toBe(2);
  });
});
