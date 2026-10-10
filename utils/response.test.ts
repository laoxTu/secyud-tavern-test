import { describe, expect, it } from 'vitest';

import { response } from '@/utils/server';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./response.cases.json')).default);
}

describe('response / json', () => {
  it('应当返回 200 与 application/json，并保留原结构', async () => {
    const data = await loadCases();

    const res = response.json(data.value);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual(data.value);
  });

  it('null 应当序列化成 json 的 null', async () => {
    const res = response.null();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toBeNull();
  });
});

describe('response / create', () => {
  it('应当透传 body、状态码与响应头', async () => {
    const data = await loadCases();
    const { body, status, headers } = data.created;

    const res = response.create(body, { status, headers });

    expect(res.status).toBe(status);
    expect(res.headers.get('x-custom')).toBe(headers['x-custom']);
    await expect(res.text()).resolves.toBe(body);
  });
});

describe('response / 文件响应', () => {
  it('download 应当带上 attachment 与编码后的文件名', async () => {
    const data = await loadCases();

    const res = response.download(data.filename, Buffer.from(data.text));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent(data.filename)}`,
    );
    await expect(res.text()).resolves.toBe(data.text);
  });

  it('resource 应当带上 inline 与文件类型', async () => {
    const data = await loadCases();

    const res = response.resource(
      data.filename,
      data.filetype,
      Buffer.from(data.text),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(data.filetype);
    expect(res.headers.get('content-disposition')).toBe(
      `inline; filename*=UTF-8''${encodeURIComponent(data.filename)}`,
    );
    await expect(res.text()).resolves.toBe(data.text);
  });

  it('也应当支持 ReadableStream 作为响应体', async () => {
    const data = await loadCases();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(data.text));
        controller.close();
      },
    });

    const res = response.resource(data.filename, data.filetype, stream);

    await expect(res.text()).resolves.toBe(data.text);
  });
});
