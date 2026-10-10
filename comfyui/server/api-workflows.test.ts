import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComfyUIPaint, ComfyUIWorkflowInput } from '@/comfyui';

const mocks = vi.hoisted(() => ({
  workflowRepo: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    exist: vi.fn(),
    param: {
      list: vi.fn(),
      get: vi.fn(),
      add: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      make: vi.fn(),
    },
  },
}));

// 仓库层整体替换，不连 sqlite
vi.mock('@/comfyui/server', () => ({
  comfyuis: { repository: { workflow: mocks.workflowRepo } },
}));
// route 只负责拦截器编排，这里直接暴露处理函数
vi.mock('@/interceptors/server', () => ({
  route: (handler: unknown) => handler,
}));

import { workflows } from '@/comfyui/server/api-workflows';
// 归档层用真实实现，导入导出要真的走一遍 zip
import { archives, type Archive } from '@/utils/archive';

const handlers = workflows as any;

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./api-workflows.cases.json')).default);
}

/** 仓库里的 content 是字符串，fixture 里放对象方便阅读 */
function withContent(data: any) {
  return { ...data.workflow, content: JSON.stringify(data.workflowInput) };
}

/** 按 Next.js 的签名调用处理函数（route 已被替换为直通） */
function call(
  handler: any,
  options: {
    request?: Request;
    params?: Record<string, string>;
    searchParams?: Record<string, any>;
  } = {},
) {
  return handler(
    options.request ?? new Request('http://localhost/api/comfyuis/workflows'),
    {
      params: Promise.resolve(options.params ?? {}),
      searchParams: options.searchParams ?? {},
    },
  );
}

function jsonRequest(url: string, body: unknown, method = 'POST') {
  return new Request(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * jsdom 的 File 塞不进 Node 的 Request，只伪造 handler 用到的那一小部分：
 * forms.file 只取 file.arrayBuffer()。
 */
function uploadRequest(buffer: Buffer) {
  const upload = { arrayBuffer: async () => new Uint8Array(buffer).buffer };
  return {
    formData: async () => ({ get: () => upload }),
  } as unknown as Request;
}

/** 按 exportProcess 的结构手工打一个包，导入用例用它当上传内容 */
async function buildPackage(data: any) {
  const nodes: Archive = {};
  archives.set.text(nodes, 'workflow.json', JSON.stringify(data.workflowInput));
  archives.set.json(nodes, 'meta.json', {
    workflow: { ...data.workflow, content: undefined, id: undefined },
    params: data.workflowParams,
  });
  return await archives.archiveToZip(nodes);
}

beforeEach(() => {
  vi.clearAllMocks();
  // once 队列残留会串到后续用例，单独重置
  mocks.workflowRepo.param.add.mockReset();
  mocks.workflowRepo.param.list.mockResolvedValue({ items: [], length: 0 });
});

describe('comfyui api-workflows / 工作流 CRUD', () => {
  it('GET 列表应当把查询参数原样交给仓库', async () => {
    const data = await loadCases();
    mocks.workflowRepo.list.mockResolvedValue(data.listResponse);

    const response = await call(handlers.GET, { searchParams: data.listRequest });

    expect(mocks.workflowRepo.list).toHaveBeenCalledWith(data.listRequest);
    await expect(response.json()).resolves.toEqual(data.listResponse);
  });

  it('POST 应当用请求体创建工作流并返回 id', async () => {
    const data = await loadCases();
    mocks.workflowRepo.create.mockResolvedValue(data.createdId);

    const response = await call(handlers.POST, {
      request: jsonRequest(
        'http://localhost/api/comfyuis/workflows',
        data.createBody,
      ),
    });

    expect(mocks.workflowRepo.create).toHaveBeenCalledWith(data.createBody);
    await expect(response.json()).resolves.toEqual({ id: data.createdId });
  });

  it('GET /[id] 应当按 id 读取并返回工作流', async () => {
    const data = await loadCases();
    const workflow = withContent(data);
    mocks.workflowRepo.get.mockResolvedValue(workflow);

    const response = await call(handlers['[id]'].GET, {
      params: { id: workflow.id },
    });

    expect(mocks.workflowRepo.get).toHaveBeenCalledWith(workflow.id);
    await expect(response.json()).resolves.toEqual(workflow);
  });

  it('PUT /[id] 应当把路径 id 与请求体分别传给仓库', async () => {
    const data = await loadCases();
    mocks.workflowRepo.update.mockResolvedValue(data.workflow.id);

    const response = await call(handlers['[id]'].PUT, {
      params: { id: data.workflow.id },
      request: jsonRequest(
        `http://localhost/api/comfyuis/workflows/${data.workflow.id}`,
        data.updateBody,
        'PUT',
      ),
    });

    expect(mocks.workflowRepo.update).toHaveBeenCalledWith(
      data.workflow.id,
      data.updateBody,
    );
    await expect(response.json()).resolves.toEqual({ id: data.workflow.id });
  });

  it('DELETE /[id] 应当删除并返回 null', async () => {
    const data = await loadCases();

    const response = await call(handlers['[id]'].DELETE, {
      params: { id: data.workflow.id },
    });

    expect(mocks.workflowRepo.delete).toHaveBeenCalledWith(data.workflow.id);
    await expect(response.json()).resolves.toBeNull();
  });
});

describe('comfyui api-workflows / clone', () => {
  it('应当以源工作流为底合并请求体，并整组复制参数', async () => {
    const data = await loadCases();
    const workflow = withContent(data);
    mocks.workflowRepo.get.mockResolvedValue(workflow);
    mocks.workflowRepo.param.list.mockResolvedValue({
      items: data.workflowParams,
      length: data.workflowParams.length,
    });
    mocks.workflowRepo.create.mockResolvedValue(data.createdId);

    const response = await call(handlers['[id]'].clone.POST, {
      params: { id: workflow.id },
      request: jsonRequest(
        `http://localhost/api/comfyuis/workflows/${workflow.id}/clone`,
        data.cloneBody,
      ),
    });

    expect(mocks.workflowRepo.get).toHaveBeenCalledWith(workflow.id);
    expect(mocks.workflowRepo.param.list).toHaveBeenCalledWith(workflow.id);
    expect(mocks.workflowRepo.create).toHaveBeenCalledWith({
      ...workflow,
      ...data.cloneBody,
      id: null,
    });
    expect(mocks.workflowRepo.param.make).toHaveBeenCalledWith(
      data.createdId,
      data.workflowParams,
    );
    await expect(response.json()).resolves.toEqual({ id: data.createdId });
  });
});

describe('comfyui api-workflows / 参数 CRUD', () => {
  it('GET 参数列表应当把 id 与查询参数分别传入', async () => {
    const data = await loadCases();
    const listed = { items: data.workflowParams, length: data.workflowParams.length };
    mocks.workflowRepo.param.list.mockResolvedValue(listed);

    const response = await call(handlers['[id]'].params.GET, {
      params: { id: data.workflow.id },
      searchParams: data.paramListRequest,
    });

    expect(mocks.workflowRepo.param.list).toHaveBeenCalledWith(
      data.workflow.id,
      data.paramListRequest,
    );
    await expect(response.json()).resolves.toEqual(listed);
  });

  it('POST 参数应当用请求体新增并返回 sequence', async () => {
    const data = await loadCases();
    mocks.workflowRepo.param.add.mockResolvedValue(data.addedSequence);

    const response = await call(handlers['[id]'].params.POST, {
      params: { id: data.workflow.id },
      request: jsonRequest('http://localhost/api/comfyuis/workflows/params', data.newParam),
    });

    expect(mocks.workflowRepo.param.add).toHaveBeenCalledWith(
      data.workflow.id,
      data.newParam,
    );
    await expect(response.json()).resolves.toEqual({
      sequence: data.addedSequence,
    });
  });

  it('GET /[sequence] 应当按 id 与序号读取参数', async () => {
    const data = await loadCases();
    mocks.workflowRepo.param.get.mockResolvedValue(data.param);

    const response = await call(handlers['[id]'].params['[sequence]'].GET, {
      params: { id: data.param.masterId, sequence: data.sequenceParam },
    });

    expect(mocks.workflowRepo.param.get).toHaveBeenCalledWith(
      data.param.masterId,
      data.sequenceParam,
    );
    await expect(response.json()).resolves.toEqual(data.param);
  });

  it('PUT /[sequence] 应当更新参数并返回 null', async () => {
    const data = await loadCases();

    const response = await call(handlers['[id]'].params['[sequence]'].PUT, {
      params: { id: data.param.masterId, sequence: data.sequenceParam },
      request: jsonRequest(
        'http://localhost/api/comfyuis/workflows/params',
        data.newParam,
        'PUT',
      ),
    });

    expect(mocks.workflowRepo.param.set).toHaveBeenCalledWith(
      data.param.masterId,
      data.sequenceParam,
      data.newParam,
    );
    await expect(response.json()).resolves.toBeNull();
  });

  it('DELETE /[sequence] 应当删除参数并返回 null', async () => {
    const data = await loadCases();

    const response = await call(handlers['[id]'].params['[sequence]'].DELETE, {
      params: { id: data.param.masterId, sequence: data.sequenceParam },
    });

    expect(mocks.workflowRepo.param.del).toHaveBeenCalledWith(
      data.param.masterId,
      data.sequenceParam,
    );
    await expect(response.json()).resolves.toBeNull();
  });
});

describe('comfyui api-workflows / 参数 clone', () => {
  it('应当以源参数为底合并请求体后新增', async () => {
    const data = await loadCases();
    mocks.workflowRepo.param.get.mockResolvedValue(data.param);
    mocks.workflowRepo.param.add.mockResolvedValue(data.addedSequence);

    const response = await call(
      handlers['[id]'].params['[sequence]'].clone.POST,
      {
        params: { id: data.param.masterId, sequence: data.sequenceParam },
        request: jsonRequest(
          'http://localhost/api/comfyuis/workflows/params/clone',
          data.paramCloneBody,
        ),
      },
    );

    expect(mocks.workflowRepo.param.get).toHaveBeenCalledWith(
      data.param.masterId,
      data.sequenceParam,
    );
    expect(mocks.workflowRepo.param.add).toHaveBeenCalledWith(
      data.param.masterId,
      { ...data.param, ...data.paramCloneBody },
    );
    await expect(response.json()).resolves.toEqual({
      sequence: data.addedSequence,
    });
  });

  it('请求体为空时应当保留源参数的全部字段', async () => {
    const data = await loadCases();
    mocks.workflowRepo.param.get.mockResolvedValue(data.param);
    mocks.workflowRepo.param.add.mockResolvedValue(data.addedSequence);

    await call(handlers['[id]'].params['[sequence]'].clone.POST, {
      params: { id: data.param.masterId, sequence: data.sequenceParam },
      request: jsonRequest(
        'http://localhost/api/comfyuis/workflows/params/clone',
        {},
      ),
    });

    expect(mocks.workflowRepo.param.add).toHaveBeenCalledWith(
      data.param.masterId,
      data.param,
    );
  });
});

describe('comfyui api-workflows / 参数生成', () => {
  it('应当按节点类型追加参数，lora 序号断开即停止收集', async () => {
    const data = await loadCases();
    // fixture 的 inputs 是字面量对象，按声明类型收窄才能用 string 索引节点输入
    const input = data.workflowInput as ComfyUIWorkflowInput;
    const workflow = withContent(data);
    const listed: any[] = [];
    mocks.workflowRepo.get.mockResolvedValue(workflow);
    mocks.workflowRepo.param.list.mockImplementation(async () => ({
      items: listed,
      length: listed.length,
    }));
    for (const sequence of data.generatedSequences) {
      mocks.workflowRepo.param.add.mockResolvedValueOnce(sequence);
    }

    const response = await call(handlers['[id]'].params.generate.POST, {
      params: { id: workflow.id },
    });

    expect(mocks.workflowRepo.get).toHaveBeenCalledWith(workflow.id);
    expect(mocks.workflowRepo.param.list).toHaveBeenCalledWith(workflow.id);

    const unetName = input['1'].inputs.unet_name;
    expect(listed).toEqual([
      {
        masterId: workflow.id,
        sequence: data.generatedSequences[0],
        type: 'model_select',
        name: 'diffusion_model_1',
        config: {
          type: 'diffusion_model',
          node: '1',
          key: 'unet_name',
          value: { name: unetName, value: unetName },
        },
      },
      {
        masterId: workflow.id,
        sequence: data.generatedSequences[1],
        type: 'llm_text_editor',
        name: 'positive_prompt_2',
        config: { node: '2', key: 'text', prompt: '' },
      },
      {
        masterId: workflow.id,
        sequence: data.generatedSequences[2],
        type: 'power_lora_select',
        name: 'power_lora_3',
        config: {
          node: '3',
          value: ['lora_1', 'lora_2'].map((key) => {
            const lora = input['3'].inputs[key];
            return { ...lora, lora: { name: lora.lora, value: lora.lora } };
          }),
        },
      },
      {
        masterId: workflow.id,
        sequence: data.generatedSequences[3],
        type: 'image_callback',
        name: 'callback_4',
        config: { node: '4' },
      },
    ]);
    // 负向提示词节点（title 不以 positive 开头）不生成参数
    expect(listed.map((u) => u.name)).not.toContain('positive_prompt_5');
    await expect(response.json()).resolves.toBeNull();
  });

  it('再次生成时不应重复追加同名同类型的参数', async () => {
    const data = await loadCases();
    const workflow = withContent(data);
    const listed: any[] = [];
    mocks.workflowRepo.get.mockResolvedValue(workflow);
    mocks.workflowRepo.param.list.mockImplementation(async () => ({
      items: listed,
      length: listed.length,
    }));
    mocks.workflowRepo.param.add.mockResolvedValue(data.generatedSequences[0]);

    await call(handlers['[id]'].params.generate.POST, {
      params: { id: workflow.id },
    });
    expect(mocks.workflowRepo.param.add).toHaveBeenCalledTimes(
      data.generatedSequences.length,
    );
    const snapshot = structuredClone(listed);

    await call(handlers['[id]'].params.generate.POST, {
      params: { id: workflow.id },
    });

    expect(mocks.workflowRepo.param.add).toHaveBeenCalledTimes(
      data.generatedSequences.length,
    );
    expect(listed).toEqual(snapshot);
  });

  it('工作流不存在时不应查参数也不应新增', async () => {
    const data = await loadCases();
    mocks.workflowRepo.get.mockResolvedValue(undefined);

    const response = await call(handlers['[id]'].params.generate.POST, {
      params: { id: data.workflow.id },
    });

    expect(mocks.workflowRepo.param.list).not.toHaveBeenCalled();
    expect(mocks.workflowRepo.param.add).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toBeNull();
  });
});

describe('comfyui api-workflows / 导出', () => {
  it('应当把内容与 meta 分别写进 zip，并带上下载响应头', async () => {
    const data = await loadCases();
    const content = JSON.stringify(data.workflowInput);
    // 打包时会把 content / id 从入参上抹掉（见 exportProcess），先留一份原值
    const workflowId = data.workflow.id;
    const workflow = { ...data.workflow, content };
    mocks.workflowRepo.get.mockResolvedValue(workflow);
    mocks.workflowRepo.param.list.mockResolvedValue({
      items: data.workflowParams,
      length: data.workflowParams.length,
    });

    const response = await call(handlers['[id]'].export.GET, {
      params: { id: workflowId },
    });

    expect(mocks.workflowRepo.get).toHaveBeenCalledWith(workflowId);
    expect(mocks.workflowRepo.param.list).toHaveBeenCalledWith(workflowId);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('content-disposition')).toContain(
      encodeURIComponent(`workflow_${workflow.name}.zip`),
    );

    const nodes = await archives.zipToArchive(
      Buffer.from(await response.arrayBuffer()),
    );
    await expect(archives.get.text(nodes, 'workflow.json')).resolves.toBe(
      content,
    );

    const meta = await archives.get.json<ComfyUIPaint>(nodes, 'meta.json');
    expect(meta!.workflow.name).toBe(workflow.name);
    expect(meta!.workflow.description).toBe(workflow.description);
    // 内容单独存，meta 里的 content / 主键都被清掉
    expect(meta!.workflow.content).toBeUndefined();
    expect(meta!.workflow.id).toBeUndefined();
    expect(meta!.params).toEqual(data.workflowParams);
  });
});

describe('comfyui api-workflows / 导入', () => {
  it('应当解出 workflow 与 params 后分别落库', async () => {
    const data = await loadCases();
    const content = JSON.stringify(data.workflowInput);
    mocks.workflowRepo.create.mockResolvedValue(data.importCreatedId);

    const response = await call(handlers.import.POST, {
      request: uploadRequest(await buildPackage(data)),
    });

    expect(mocks.workflowRepo.create).toHaveBeenCalledWith({
      ...data.workflow,
      content,
      id: null,
    });
    expect(mocks.workflowRepo.param.make).toHaveBeenCalledWith(
      data.importCreatedId,
      data.workflowParams,
    );
    await expect(response.json()).resolves.toEqual({ id: data.importCreatedId });
  });

  it('缺少 meta.json 时应当报导入失败且不落库', async () => {
    const data = await loadCases();
    const nodes: Archive = {};
    archives.set.text(nodes, 'workflow.json', JSON.stringify(data.workflowInput));

    await expect(
      call(handlers.import.POST, {
        request: uploadRequest(await archives.archiveToZip(nodes)),
      }),
    ).rejects.toThrow('import failed. invalid file');
    expect(mocks.workflowRepo.create).not.toHaveBeenCalled();
    expect(mocks.workflowRepo.param.make).not.toHaveBeenCalled();
  });

  it('export 出来的包应当能被 import 等值解回', async () => {
    const data = await loadCases();
    const content = JSON.stringify(data.workflowInput);
    const workflowId = data.workflow.id;
    const workflow = { ...data.workflow, content };
    mocks.workflowRepo.get.mockResolvedValue(workflow);
    mocks.workflowRepo.param.list.mockResolvedValue({
      items: data.workflowParams,
      length: data.workflowParams.length,
    });
    mocks.workflowRepo.create.mockResolvedValue(data.importCreatedId);

    const exported = await call(handlers['[id]'].export.GET, {
      params: { id: workflowId },
    });
    const buffer = Buffer.from(await exported.arrayBuffer());

    await call(handlers.import.POST, { request: uploadRequest(buffer) });

    // 主键不复用，名称/描述/内容/参数都与导出前一致
    expect(mocks.workflowRepo.create).toHaveBeenCalledWith({
      ...data.workflow,
      content,
      id: null,
    });
    expect(mocks.workflowRepo.param.make).toHaveBeenCalledWith(
      data.importCreatedId,
      data.workflowParams,
    );
  });
});
