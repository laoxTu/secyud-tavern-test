import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  subscription: vi.fn(),
}));

// 请求层整体替换掉，用例只关心状态编排与拼出来的参数
vi.mock('@/client', () => ({
  get: mocks.get,
  post: mocks.post,
  put: mocks.put,
  del: mocks.del,
  open: vi.fn(),
}));
// state 读的是 client 桶上的 tasks.proxy：只把桶换成真实 proxy，
// 不加载桶里的组件，同时保证请求层仍走 mock
vi.mock('@/tasks/client', async () => {
  const { proxy } = await import('@/tasks/client/proxy');
  return { tasks: { name: 'task', proxy } };
});
// signal 侧这里只关心「编排顺序与入参」；订阅请求本身（url/params）由 tests/signal 覆盖。
// 注意：**不要**用 `await import('@/signal/client/proxy')` 取真实 proxy —— 上游让 proxy.ts
// 反过来 `import { useSseConnection } from '.'`（即 '@/signal/client'），异步 mock 工厂会与
// 它形成循环等待，整个文件卡死在收集阶段（本文件曾因此让全量跑不完）。
vi.mock('@/signal/client', () => ({
  signals: { proxy: { subscription: mocks.subscription } },
}));

import type { TaskState } from '@/tasks/client/state';
import { useTaskState } from '@/tasks/client/state';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./state.cases.json')).default);
}

/** 按 fixture 造一份列表响应 */
function listResponse(data: { items: unknown[] }, length: number) {
  return { items: structuredClone(data.items), length };
}

beforeEach(() => {
  vi.clearAllMocks();
  useTaskState.setState({
    items: undefined,
    loading: false,
    cur: 0,
    size: 7,
    max: 0,
    search: undefined,
  });
});

describe('tasks client state / 初始值', () => {
  it('分页与标签的初始值应当固定', () => {
    const state = useTaskState.getState();

    expect(state.cur).toBe(0);
    expect(state.size).toBe(7);
    expect(state.max).toBe(0);
    expect(state.loading).toBe(false);
    // tab 是 state 工厂在 create 时补上的键，TaskState 自身没有声明，
    // 这里按运行时形状断言
    expect((state as TaskState & { tab: string }).tab).toBe('property');
    expect(state.items).toBeUndefined();
  });
});

describe('tasks client state / 列表', () => {
  it('refresh 应当按当前分页请求任务并写入结果', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(listResponse(data, data.lengths.paged));

    await useTaskState.getState().refresh();

    expect(mocks.get).toHaveBeenCalledWith('tasks', {
      params: { search: undefined, size: 7, skip: 0 },
    });
    const state = useTaskState.getState();
    expect(state.items).toEqual(data.items);
    // 15 条 / 每页 7 → 3 页
    expect(state.max).toBe(3);
    expect(state.loading).toBe(false);
  });

  it('列表返回后应当订阅这些任务的 task_progress', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(listResponse(data, data.lengths.paged));

    await useTaskState.getState().refresh();

    expect(mocks.subscription).toHaveBeenCalledWith({
      ...data.subscription,
      targets: data.items.map((u: { id: string }) => u.id),
    });
    // 先拿到列表再订阅
    expect(mocks.get.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.subscription.mock.invocationCallOrder[0],
    );
  });

  it('空列表时仍然订阅，targets 为空数组且 max 为 0', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(listResponse({ items: [] }, data.lengths.empty));

    await useTaskState.getState().refresh();

    expect(mocks.subscription).toHaveBeenCalledWith({
      ...data.subscription,
      targets: [],
    });
    const state = useTaskState.getState();
    expect(state.items).toEqual([]);
    expect(state.max).toBe(0);
  });

  it('翻页时 skip 应当按 cur * size 计算', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(listResponse(data, data.lengths.paged));

    await useTaskState.getState().refresh({ page: 2, size: 5 });

    expect(mocks.get.mock.calls[0][1].params).toMatchObject({
      size: 5,
      skip: 10,
    });
    expect(useTaskState.getState().cur).toBe(2);
  });

  it('当前页越界时应当回退到最后一页重新取一次', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(listResponse(data, data.lengths.single));
    useTaskState.setState({ cur: 2 });

    await useTaskState.getState().refresh();

    // 7 条 / 每页 7 → 只有 1 页，第 2 页越界
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.get.mock.calls[0][1].params).toMatchObject({ skip: 14 });
    expect(mocks.get.mock.calls[1][1].params).toMatchObject({ skip: 0 });
    const state = useTaskState.getState();
    expect(state.cur).toBe(0);
    expect(state.max).toBe(1);
    expect(state.items).toEqual(data.items);
  });

  it('请求失败时应当抛出、结束 loading 且不订阅', async () => {
    mocks.get.mockRejectedValue(new Error('boom'));

    await expect(useTaskState.getState().refresh()).rejects.toThrow('boom');

    expect(mocks.subscription).not.toHaveBeenCalled();
    expect(useTaskState.getState().loading).toBe(false);
  });
});
