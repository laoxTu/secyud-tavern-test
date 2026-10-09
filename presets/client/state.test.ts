import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Preset } from '@/presets';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));

vi.mock('@/client', () => ({
  get: mocks.get,
  post: mocks.post,
  put: mocks.put,
  del: mocks.del,
  open: mocks.open,
}));

import { usePresetState } from '@/presets/client/state';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./fixtures.json')).default);
}

beforeEach(async () => {
  vi.clearAllMocks();
  usePresetState.setState({
    item: undefined,
    tab: 'property',
    cur: 0,
    max: 0,
    items: undefined,
    loading: false,
  });
});

describe('presets client state / 默认值', () => {
  it('应当按 json 里的默认页大小分页，并默认停在属性页', async () => {
    const data = await loadData();
    const state = usePresetState.getState();

    expect(state.size).toBe(data.defaultPageSize);
    expect(state.cur).toBe(0);
    expect(state.max).toBe(0);
    expect(state.tab).toBe('property');
  });
});

describe('presets client state / setItem', () => {
  it('带 id 时应当请求 types 并写入 item', async () => {
    const data = await loadData();
    mocks.get.mockResolvedValue(data.preset);

    await usePresetState.getState().setItem(data.preset.id);

    expect(mocks.get).toHaveBeenCalledWith('presets/{id}', {
      params: { id: data.preset.id, types: true },
    });
    expect(usePresetState.getState().item).toEqual(data.preset);
  });

  it('不带 id 时应当清空 item 且不发请求', async () => {
    const data = await loadData();
    usePresetState.setState({ item: data.preset as Preset });

    await usePresetState.getState().setItem(undefined);

    expect(mocks.get).not.toHaveBeenCalled();
    expect(usePresetState.getState().item).toBeUndefined();
  });
});

describe('presets client state / setTab', () => {
  it('应当切换当前页签', () => {
    usePresetState.getState().setTab('macros');

    expect(usePresetState.getState().tab).toBe('macros');

    usePresetState.getState().setTab(undefined);

    expect(usePresetState.getState().tab).toBeUndefined();
  });
});

describe('presets client state / refresh', () => {
  it('应当请求列表并算出总页数', async () => {
    const data = await loadData();
    mocks.get.mockResolvedValue(data.listResponse);

    await usePresetState.getState().refresh();

    const [url, options] = mocks.get.mock.calls[0];
    expect(url).toBe('presets');
    expect(options.params).toMatchObject({ size: data.defaultPageSize, skip: 0 });
    expect(usePresetState.getState().items).toEqual(data.listResponse.items);
    expect(usePresetState.getState().max).toBe(
      Math.ceil(data.listResponse.length / data.defaultPageSize),
    );
    expect(usePresetState.getState().loading).toBe(false);
  });

  it('翻页时应当按页号计算 skip', async () => {
    const data = await loadData();
    const page = 2;
    mocks.get.mockResolvedValue(data.largeResponse);

    await usePresetState.getState().refresh({ page });

    expect(mocks.get.mock.calls[0][1].params).toMatchObject({
      size: data.defaultPageSize,
      skip: page * data.defaultPageSize,
    });
    expect(usePresetState.getState().cur).toBe(page);
  });

  it('页号越界时应当回退到最后一页并重新请求', async () => {
    const data = await loadData();
    mocks.get.mockResolvedValue(data.shortResponse);

    await usePresetState.getState().refresh({ page: 9 });

    const max = Math.ceil(data.shortResponse.length / data.defaultPageSize);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(usePresetState.getState().cur).toBe(max - 1);
    expect(mocks.get.mock.calls[1][1].params.skip).toBe(
      (max - 1) * data.defaultPageSize,
    );
  });
});
