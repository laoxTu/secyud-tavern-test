import { describe, expect, it } from 'vitest';

import { files } from '@/files';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

describe('files / 常量', () => {
  it('实体名应当是 file', async () => {
    const data = await loadCases();

    expect(files.name).toBe(data.name);
  });
});

describe('files / url', () => {
  it('没有 id 时应当返回空串', async () => {
    const data = await loadCases();

    expect(files.url()).toBe('');
    expect(files.url(null)).toBe('');
    expect(files.url(undefined)).toBe('');
    expect(files.url('')).toBe('');
    expect(files.url(data.urls.rootRelative)).toBe('');
    expect(files.url(data.urls.plain)).toBe('');
    expect(files.url(data.ids.plain)).toBe('');
    expect(files.url(data.ids.withoutDash)).toBe('');
  });

  it('uuid 应当拼成资源接口地址（大小写都认）', async () => {
    const data = await loadCases();

    expect(files.url(data.ids.v7)).toBe(`/api/files/${data.ids.v7}/resource`);
    expect(files.url(data.ids.uppercase)).toBe(
      `/api/files/${data.ids.uppercase}/resource`,
    );
  });

  it('合法 URL 应当原样返回', async () => {
    const data = await loadCases();

    expect(files.url(data.urls.https)).toBe(data.urls.https);
    expect(files.url(data.urls.data)).toBe(data.urls.data);
    expect(files.url(data.urls.file)).toBe(data.urls.file);
  });
});

describe('files / outer', () => {
  it('合法 URL 应当判定为外部地址', async () => {
    const data = await loadCases();

    expect(files.outer(data.urls.https)).toBe(true);
    expect(files.outer(data.urls.data)).toBe(true);
    expect(files.outer(data.urls.file)).toBe(true);
  });

  it('uuid 与相对路径都不是外部地址', async () => {
    const data = await loadCases();

    expect(files.outer(data.ids.v7)).toBe(false);
    expect(files.outer(data.urls.protocolRelative)).toBe(false);
    expect(files.outer(data.urls.rootRelative)).toBe(false);
    expect(files.outer(data.urls.plain)).toBe(false);
    expect(files.outer(null)).toBe(false);
    expect(files.outer(undefined)).toBe(false);
    expect(files.outer('')).toBe(false);
  });
});

describe('files / mime', () => {
  it('应当把 mime 拆成主类型与参数', async () => {
    const data = await loadCases();

    for (const item of data.mime) {
      expect(
        files.deserializeMimeType(item.input),
        item.title,
      ).toEqual({ type: item.type, args: item.args });
    }
  });

  it('空 mime 应当落到空类型且没有参数', async () => {
    const data = await loadCases();

    expect(files.deserializeMimeType(data.emptyMime.input)).toEqual({
      type: data.emptyMime.type,
      args: data.emptyMime.args,
    });
  });

  it('应当能把主类型与参数还原成 mime', async () => {
    const data = await loadCases();

    for (const item of data.mime) {
      expect(
        files.serializeMimeType({
          type: item.type,
          args: item.args,
        }),
        item.title,
      ).toBe(item.serialized);
    }
    expect(
      files.serializeMimeType({
        type: data.emptyMime.type,
        args: data.emptyMime.args,
      }),
    ).toBe(data.emptyMime.serialized);
  });

  it('拆开再拼回去应当与规范化后的 mime 一致', async () => {
    const data = await loadCases();

    for (const item of data.mime) {
      expect(
        files.serializeMimeType(files.deserializeMimeType(item.input)),
        item.title,
      ).toBe(item.serialized);
    }
  });

  it('args 为空串时应当只留主类型', async () => {
    const data = await loadCases();

    expect(
      files.serializeMimeType({ type: data.mime[1].type, args: '' }),
    ).toBe(data.mime[1].type);
  });
});
