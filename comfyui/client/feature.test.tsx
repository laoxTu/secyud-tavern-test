import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  paint: vi.fn(),
  configureInput: vi.fn(),
  success: vi.fn(),
  onSubmit: null as any,
  onValueChange: null as any,
}));

// 展示层整体换成最小桩：只需要拿到 onSubmit 与 onValueChange 两个入口
vi.mock('@/components', () => ({
  TooltipDialog: ({ children, onSubmit }: any) => {
    mocks.onSubmit = onSubmit;
    return children;
  },
  FieldSet: ({ children }: any) => children,
  FieldGroup: ({ children }: any) => children,
  GridField: ({ children }: any) => children,
  useFormRef: () => ({ current: null }),
  dialogs: { info: () => 'info' },
  element: () => null,
  spanHalf: 'span-half',
}));
// 只保留 feature.tsx 真正用到的部分，避免拉起整个 client 桶
vi.mock('@/comfyui/client', async () => {
  const { configurators } = await import('@/comfyui/client/configurator');
  const { proxy } = await import('@/comfyui/client/proxy');
  return {
    comfyuis: { configurators, proxy },
    ComfyUIWorkflowNameValueField: ({ onValueChange }: any) => {
      mocks.onValueChange = onValueChange;
      return null;
    },
  };
});
vi.mock('@/comfyui/client/proxy', () => ({
  proxy: {
    generate: mocks.generate,
    workflow: { paint: mocks.paint },
  },
}));
vi.mock('@/interceptors/client', () => ({
  handler: (fn: any) => fn,
  success: mocks.success,
}));
vi.mock('next-intl', () => ({
  useTranslations:
    () =>
    (key: string, values?: Record<string, any>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
}));

import { comfyuis } from '@/comfyui/client';
import type { ParamConfigurator } from '@/comfyui/client/configurator';
import { feature } from '@/comfyui/client/feature';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./feature.cases.json')).default);
}

const registered: string[] = [];

function registerConfigurator<T>(
  id: string,
  extra: Partial<ParamConfigurator<T>> = {},
) {
  const configurator = { id, ...extra } as ParamConfigurator<T>;
  comfyuis.configurators.registry.register(configurator);
  registered.push(id);
  return configurator;
}

/** 渲染出 feature 的生成器，并把它选中的工作流准备好 */
async function renderGenerator(paint: unknown) {
  mocks.paint.mockResolvedValue(paint);
  render(<feature.component />);

  await act(async () => {
    await mocks.onValueChange({ name: '工作流 A-wf-1', value: 'wf-1' });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const id of registered.splice(0)) {
    comfyuis.configurators.registry.unregister(id);
  }
});

describe('comfyui feature / 常量', () => {
  it('id 与顺序应当与模块一致', () => {
    expect(feature.id).toBe('comfyui');
    expect(feature.sequence).toBe(10);
    expect(feature.component).toBeTruthy();
  });
});

describe('comfyui feature / 选择工作流', () => {
  it('选择后应当拉取工作流与参数', async () => {
    const data = await loadCases();

    await renderGenerator({
      workflow: data.workflow,
      params: data.params,
    });

    expect(mocks.paint).toHaveBeenCalledWith(data.selected.value);
  });
});

describe('comfyui feature / 提交', () => {
  it('没有选择工作流时应当报错', async () => {
    render(<feature.component />);

    await expect(mocks.onSubmit(new FormData())).rejects.toThrow(
      'workflow is not selected',
    );
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('工作流内容不是合法 json 时应当报错', async () => {
    const data = await loadCases();
    await renderGenerator({ workflow: data.invalidWorkflow, params: [] });

    await expect(mocks.onSubmit(new FormData())).rejects.toThrow(
      'workflow is not serializable',
    );
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('空内容时同样视为不可序列化', async () => {
    const data = await loadCases();
    await renderGenerator({ workflow: data.emptyWorkflow, params: [] });

    await expect(mocks.onSubmit(new FormData())).rejects.toThrow(
      'workflow is not serializable',
    );
  });

  it('应当让每个参数改写工作流后再提交', async () => {
    const data = await loadCases();
    const param = registerConfigurator('text', {
      configureInput: mocks.configureInput,
    });
    mocks.generate.mockResolvedValue(data.generateResponse);
    await renderGenerator({ workflow: data.workflow, params: data.params });
    const form = new FormData();

    await mocks.onSubmit(form);

    // 只有注册过配置器的参数会被处理
    expect(mocks.configureInput).toHaveBeenCalledTimes(1);
    expect(mocks.configureInput.mock.calls[0][0]).toBe(form);
    expect(mocks.configureInput.mock.calls[0][1]).toEqual(data.params[0]);
    expect(mocks.configureInput.mock.calls[0][2]).toEqual(data.input);
    expect(param.configureInput).toBe(mocks.configureInput);
    expect(mocks.generate).toHaveBeenCalledWith(data.input);
  });

  it('提交成功后应当提示 prompt_id', async () => {
    const data = await loadCases();
    mocks.generate.mockResolvedValue(data.generateResponse);
    await renderGenerator({ workflow: data.workflow, params: [] });

    await mocks.onSubmit(new FormData());

    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(mocks.success.mock.calls[0][0]).toContain(
      data.generateResponse.prompt_id,
    );
  });
});
