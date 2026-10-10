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
// state 里读的是 client 桶上的 stories.proxy；这里只把桶换成「真实 proxy」，
// 不加载桶里那些组件，同时保证请求层仍走 mock
vi.mock('@/stories/client', async () => {
  const { proxy } = await import('@/stories/client/proxy');
  return { stories: { proxy } };
});

import { useStoryState } from '@/stories/client/state';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./proxy.cases.json')).default);
}

beforeEach(() => {
  vi.clearAllMocks();
  useStoryState.setState({ item: undefined, items: [], cur: 0, max: 0 });
});

describe('stories client state / 初始值', () => {
  it('分页与标签的初始值应当固定', () => {
    const state = useStoryState.getState();

    expect(state.size).toBe(7);
    expect(state.cur).toBe(0);
    expect(state.max).toBe(0);
    expect(state.loading).toBe(false);
    expect(state.tab).toBe('property');
    expect(state.item).toBeUndefined();
  });

  it('setTab 应当切换标签', () => {
    useStoryState.getState().setTab('entries');

    expect(useStoryState.getState().tab).toBe('entries');

    useStoryState.getState().setTab(undefined);
    expect(useStoryState.getState().tab).toBeUndefined();
  });
});

describe('stories client state / setItem', () => {
  it('传 id 时应当带上 types 选项拉详情', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.story);

    await useStoryState.getState().setItem(data.ids.story);

    expect(mocks.get).toHaveBeenCalledWith('stories/{id}', {
      params: { id: data.ids.story, types: true },
    });
    expect(useStoryState.getState().item).toEqual(data.story);
  });

  it('不传 id 时清空且不发请求', async () => {
    const data = await loadCases();
    useStoryState.setState({ item: data.story as any });

    await useStoryState.getState().setItem(undefined);

    expect(mocks.get).not.toHaveBeenCalled();
    expect(useStoryState.getState().item).toBeUndefined();
  });
});

describe('stories client state / 列表', () => {
  it('refresh 应当按当前分页请求并写入结果', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue({ items: [data.story], length: 15 });

    await useStoryState.getState().refresh();

    expect(mocks.get).toHaveBeenCalledWith('stories', {
      params: { search: undefined, size: 7, skip: 0 },
    });
    const state = useStoryState.getState();
    expect(state.items).toEqual([data.story]);
    // 15 条 / 每页 7 → 3 页
    expect(state.max).toBe(3);
    expect(state.loading).toBe(false);
  });

  it('请求失败时应当抛出并结束 loading', async () => {
    mocks.get.mockRejectedValue(new Error('boom'));

    await expect(useStoryState.getState().refresh()).rejects.toThrow('boom');

    expect(useStoryState.getState().loading).toBe(false);
  });
});
