import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

// 状态层最终都走请求层，这里整体替换掉
vi.mock('@/client', () => ({
  get: mocks.get,
  post: mocks.post,
  put: mocks.put,
  del: mocks.del,
  open: vi.fn(),
}));

import { comfyuis } from '@/comfyui';
import {
  useComfyUIModelSettingState,
  useComfyUIModelState,
  useComfyUIParamState,
  useComfyUIState,
  useComfyUIWorkflowState,
} from '@/comfyui/client/state';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./state.cases.json')).default);
}

beforeEach(() => {
  vi.clearAllMocks();
  useComfyUIState.setState({ page: comfyuis.model.name });
  useComfyUIWorkflowState.setState({ item: undefined, items: [], cur: 0 });
  useComfyUIModelState.setState({ items: [], cur: 0, max: 0 });
  useComfyUIParamState.setState({ items: [], cur: 0, max: 0 });
});

describe('comfyui state / 设置', () => {
  it('默认值应当来自模块常量', () => {
    expect(useComfyUIModelSettingState.getState()).toMatchObject(
      comfyuis.setting.default,
    );
  });

  it('持久化键应当与模块常量一致', () => {
    expect(useComfyUIModelSettingState.persist.getOptions().name).toBe(
      comfyuis.model.setting,
    );
  });
});

describe('comfyui state / 页面切换', () => {
  it('初始页面是模型页，setPage 后切换', () => {
    expect(useComfyUIState.getState().page).toBe(comfyuis.model.name);

    useComfyUIState.getState().setPage('comfyui.workflow');

    expect(useComfyUIState.getState().page).toBe('comfyui.workflow');
  });

  it('页面状态用 localStorage 持久化', () => {
    expect(useComfyUIState.persist.getOptions().name).toBe('comfyui');
  });
});

describe('comfyui state / 模型列表', () => {
  it('初始分页参数应当是 0 / 10', () => {
    const state = useComfyUIModelState.getState();

    expect(state.cur).toBe(0);
    expect(state.size).toBe(10);
    expect(state.max).toBe(0);
    expect(state.loading).toBe(false);
  });

  it('refresh 应当按当前分页请求模型并写入结果', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.modelsResponse);

    await useComfyUIModelState.getState().refresh();

    expect(mocks.get).toHaveBeenCalledWith('comfyuis/models', {
      params: { search: undefined, size: 10, skip: 0 },
    });
    const state = useComfyUIModelState.getState();
    expect(state.items).toEqual(data.modelsResponse.items);
    // 21 条 / 每页 10 → 3 页
    expect(state.max).toBe(3);
    expect(state.loading).toBe(false);
  });

  it('翻页时 skip 应当按 cur * size 计算', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.modelsResponse);

    await useComfyUIModelState.getState().refresh({ page: 2, size: 5 });

    expect(mocks.get.mock.calls[0][1].params).toMatchObject({
      size: 5,
      skip: 10,
    });
  });

  it('请求失败时应当抛出并结束 loading', async () => {
    mocks.get.mockRejectedValue(new Error('boom'));

    await expect(useComfyUIModelState.getState().refresh()).rejects.toThrow(
      'boom',
    );
    expect(useComfyUIModelState.getState().loading).toBe(false);
  });
});

describe('comfyui state / 工作流列表', () => {
  it('每页条数应当是 7', () => {
    expect(useComfyUIWorkflowState.getState().size).toBe(7);
  });

  it('refresh 应当把查询条件交给工作流接口', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.workflowsResponse);

    await useComfyUIWorkflowState.getState().refresh({
      search: () => ({ fuzzy: '工作流' }),
    });

    expect(mocks.get).toHaveBeenCalledWith('comfyuis/workflows', {
      params: { search: { fuzzy: '工作流' }, size: 7, skip: 0 },
    });
    expect(useComfyUIWorkflowState.getState().items).toEqual(
      data.workflowsResponse.items,
    );
  });

  it('setItem 应当按 id 拉取详情，无 id 时清空', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(data.workflow);

    await useComfyUIWorkflowState.getState().setItem(data.workflow.id);
    expect(useComfyUIWorkflowState.getState().item).toEqual(data.workflow);

    await useComfyUIWorkflowState.getState().setItem(undefined);
    expect(useComfyUIWorkflowState.getState().item).toBeUndefined();
  });
});

describe('comfyui state / 参数列表', () => {
  it('refresh 应当用当前工作流的 id 请求参数', async () => {
    const data = await loadCases();
    useComfyUIWorkflowState.setState({ item: data.workflow as any });
    mocks.get.mockResolvedValue(data.paramsResponse);

    await useComfyUIParamState.getState().refresh();

    expect(mocks.get).toHaveBeenCalledWith(
      'comfyuis/workflows/{id}/params',
      {
        params: {
          id: data.workflow.id,
          search: undefined,
          size: 5,
          skip: 0,
        },
      },
    );
    const state = useComfyUIParamState.getState();
    expect(state.items).toEqual(data.paramsResponse.items);
    expect(state.max).toBe(3);
  });

  it('没有当前工作流时应当报错', async () => {
    useComfyUIWorkflowState.setState({ item: undefined });

    await expect(useComfyUIParamState.getState().refresh()).rejects.toThrow();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('空结果时 max 为 0 且不重复请求', async () => {
    const data = await loadCases();
    useComfyUIWorkflowState.setState({ item: data.workflow as any });
    mocks.get.mockResolvedValue(data.emptyResponse);

    await useComfyUIParamState.getState().refresh();

    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(useComfyUIParamState.getState().max).toBe(0);
  });
});
