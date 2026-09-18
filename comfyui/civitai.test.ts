import { beforeEach, describe, it } from 'vitest';

import { ComfyUIModel } from '@/comfyui';
import { civitais } from '@/comfyui/civitai/client';

describe('civitai', () => {
  beforeEach(() => {});

  it('应当获取模型', async () => {
    const models: ComfyUIModel[] = [];
    const json = await import('./model-version.json');
    civitais.extract(json, json.model ?? {}, models, '');
    expect(models).toHaveLength(1);
  });
});
