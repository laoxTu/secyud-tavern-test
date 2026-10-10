import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { archives, type Archive, type ArchiveFolder } from '@/utils/archive';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./archive.cases.json')).default);
}

/** 造一个「顶层文件 + 一层嵌套文件」的归档 */
async function createArchive() {
  const data = await loadCases();
  const archive: Archive = {};
  archives.set.text(archive, data.names.root, data.texts.root);
  const folder: ArchiveFolder = {
    type: 'folder',
    name: data.names.folder,
    nodes: {},
  };
  archive[data.names.folder] = folder;
  archives.set.text(folder.nodes, data.names.inner, data.texts.inner);
  return { data, archive, folder };
}

/** 把归档摊平成「路径 → 文本」，便于比较往返结果 */
async function flatten(archive: Archive, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const node of Object.values(archive)) {
    const key = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.type === 'file') {
      result[key] = (await archives.get.text(archive, node.name)) ?? '';
    } else {
      Object.assign(result, await flatten(node.nodes, key));
    }
  }
  return result;
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('archives / set 与 get', () => {
  it('set.text 写入的节点可以按名字读回', async () => {
    const { data, archive } = await createArchive();

    expect(await archives.get.text(archive, data.names.root)).toBe(
      data.texts.root,
    );
    expect(archive[data.names.root]).toMatchObject({
      type: 'file',
      name: data.names.root,
    });
  });

  it('set.json 与 get.json 应当往返对象', async () => {
    const data = await loadCases();
    const archive: Archive = {};

    archives.set.json(archive, 'config.json', data.json.expected);

    await expect(archives.get.json(archive, 'config.json')).resolves.toEqual(
      data.json.expected,
    );
  });

  it('set.text 传 undefined 时节点存在但读不到内容', async () => {
    const archive: Archive = {};

    archives.set.text(archive, 'empty.txt', undefined);

    expect(archive['empty.txt']).toBeDefined();
    await expect(archives.get.text(archive, 'empty.txt')).resolves.toBeUndefined();
    await expect(archives.get.buffer(archive, 'empty.txt')).resolves.toBeUndefined();
  });

  it('get.buffer 读不到时返回 undefined，非文件节点也不算命中', async () => {
    const { data, folder } = await createArchive();
    const archive: Archive = { [folder.name]: folder };

    await expect(archives.get.buffer(archive, 'nope.txt')).resolves.toBeUndefined();
    await expect(archives.get.buffer(archive, data.names.folder)).resolves.toBeUndefined();
  });

  it('get.json 遇到非法 json 时退化成 null', async () => {
    const data = await loadCases();
    const archive: Archive = {};
    archives.set.text(archive, 'bad.json', data.json.invalid);

    await expect(archives.get.json(archive, 'bad.json')).resolves.toBeNull();
  });
});

describe('archives / get.fuzzy', () => {
  it('应当按前缀取文件，忽略后缀差异', async () => {
    const { data, archive } = await createArchive();

    // 文件名是 a.txt，用 a. 前缀也能命中
    await expect(archives.get.fuzzy(archive, 'a.')).resolves.toBe(
      data.texts.root,
    );
  });

  it('没有匹配的前缀时返回 undefined', async () => {
    const { archive } = await createArchive();

    await expect(archives.get.fuzzy(archive, 'zzz')).resolves.toBeUndefined();
  });

  it('同一前缀命中多个时取第一个', async () => {
    const archive: Archive = {};
    archives.set.text(archive, 'same.meta.json', 'meta');
    archives.set.text(archive, 'same.content.txt', 'content');

    await expect(archives.get.fuzzy(archive, 'same.')).resolves.toBe('meta');
  });
});

describe('archives / zip 往返', () => {
  it('应当保留目录结构与文件内容', async () => {
    const { data, archive } = await createArchive();

    const buffer = await archives.archiveToZip(archive);
    const restored = await archives.zipToArchive(buffer);

    expect(await flatten(restored)).toEqual({
      [data.names.root]: data.texts.root,
      [`${data.names.folder}/${data.names.inner}`]: data.texts.inner,
    });
  });

  it('往返后嵌套目录仍然是 folder 节点', async () => {
    const { data, archive } = await createArchive();

    const restored = await archives.zipToArchive(
      await archives.archiveToZip(archive),
    );
    const folder = restored[data.names.folder];

    expect(folder.type).toBe('folder');
    if (folder.type === 'folder') {
      expect(Object.keys(folder.nodes)).toEqual([data.names.inner]);
    }
  });

  it('内容为空的文件不会被写进 zip，往返后就消失了', async () => {
    const archive: Archive = {};
    archives.set.text(archive, 'empty.txt', undefined);
    archives.set.text(archive, 'kept.txt', 'x');

    const restored = await archives.zipToArchive(
      await archives.archiveToZip(archive),
    );

    expect(Object.keys(restored)).toEqual(['kept.txt']);
  });

  it('读回的节点是惰性的，可以重复读同一份内容', async () => {
    const { data, archive } = await createArchive();
    const restored = await archives.zipToArchive(
      await archives.archiveToZip(archive),
    );
    const node = restored[data.names.root];

    expect(node.type).toBe('file');
    if (node.type === 'file') {
      const first = await node.content();
      const second = await node.content();
      expect(typeof node.content).toBe('function');
      expect(first?.toString()).toBe(data.texts.root);
      expect(second).toEqual(first);
    }
  });

  it('应当忽略 root/ 之外的文件', async () => {
    const data = await loadCases();
    const zip = new JSZip();
    zip.file('root/kept.txt', 'kept');
    zip.file(data.names.outside, data.texts.outside);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const restored = await archives.zipToArchive(buffer);

    expect(Object.keys(restored)).toEqual(['kept.txt']);
    await expect(archives.get.text(restored, 'kept.txt')).resolves.toBe('kept');
  });
});
