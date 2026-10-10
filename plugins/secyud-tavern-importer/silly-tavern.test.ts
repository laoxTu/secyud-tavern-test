import { describe, expect, it } from 'vitest';

// parsecard 只安装在插件自己的 node_modules 下（根 node_modules 没有这个包），
// 所以这里按 @plugins 别名进到插件的依赖目录里取类，跟源码解析到的是同一份实现。
import {
  CharacterCard,
  OpenAIPreset,
} from '@plugins/secyud-tavern-importer/node_modules/parsecard/dist/index.js';
import { sillyTaverns } from '@plugins/secyud-tavern-importer/server/silly-tavern';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./silly-tavern.cases.json')).default);
}

/** 与 api.ts 一样，先用 parsecard 解析原始 json，再把角色卡交给转换函数 */
function chara(card: unknown, cover?: string): Promise<any> {
  return sillyTaverns.chara(CharacterCard.fromJSON(card), cover);
}

function preset(card: unknown, cover?: string): Promise<any> {
  return sillyTaverns.preset(OpenAIPreset.fromJSON(card), cover);
}

/** 按 code 找条目，找不到直接失败，省掉每处 `!` */
function byCode(items: any[], code: string) {
  const found = items.find((u) => u.code === code);
  if (!found) throw new Error(`entry not found: ${code}`);
  return found;
}

describe('silly-tavern / 角色卡：预设元信息', () => {
  it('角色卡基本信息应当映射到预设字段', async () => {
    const data = await loadCases();
    const card = CharacterCard.fromJSON(data.card);

    const result = await chara(data.card);

    expect(result.name).toBe(card.name);
    // 描述取创作者注释，版本取角色卡版本
    expect(result.description).toBe(card.creatorNotes);
    expect(result.version).toBe(card.characterVersion);
    expect(result.tags).toEqual(data.card.data.tags);
    expect(result.properties).toEqual({ author: card.creator });
    // 依赖酒馆基础架构
    expect(result.requires).toEqual([
      { name: 'silly-tavern', value: 'silly-tavern' },
    ]);
    expect(result.cover).toBeUndefined();
  });

  it('预设 id 应当是指定的 s + 去横线 uuid 形态，且每次都不一样', async () => {
    const data = await loadCases();

    const first = await chara(data.card);
    const second = await chara(data.card);

    expect(first.id).toMatch(/^s[0-9a-f]{32}$/);
    expect(second.id).toMatch(/^s[0-9a-f]{32}$/);
    expect(first.id).not.toBe(second.id);
  });

  it('封面应当原样透传给预设', async () => {
    const data = await loadCases();

    const result = await chara(data.card, 'cover-file-id');

    expect(result.cover).toBe('cover-file-id');
  });
});

describe('silly-tavern / 角色卡：宏条目', () => {
  it('基础宏与备用开场白宏应当按固定顺序生成', async () => {
    const data = await loadCases();

    const { entries } = await chara(data.card);

    expect(entries.macros.map((u: any) => u.code)).toEqual([
      'chara_name',
      'chara_desc',
      'chara_personality',
      'chara_mes_example',
      'opening',
      'system_prompt',
      'callback',
      'opening_0',
      'opening_1',
    ]);
    // 宏的开关字段都有默认值
    for (const macro of entries.macros) {
      expect(macro.json).toBe(false);
      expect(macro.multiple).toBe(false);
      expect(macro.hidden).toBe(false);
      expect(macro.disabled).toBe(false);
    }
  });

  it('基础宏应当逐字段映射角色卡内容', async () => {
    const data = await loadCases();
    const card = CharacterCard.fromJSON(data.card);

    const { entries } = await chara(data.card);

    expect(byCode(entries.macros, 'chara_name')).toEqual({
      name: '角色名称',
      disabled: false,
      code: 'chara_name',
      key: 'chara_name',
      value: card.name,
      json: false,
      multiple: false,
      hidden: false,
    });
    expect(byCode(entries.macros, 'chara_desc').value).toBe(
      data.macroText.cardDescription,
    );
    expect(byCode(entries.macros, 'chara_personality').value).toBe(
      card.personality,
    );
    expect(byCode(entries.macros, 'chara_mes_example').value).toBe(
      card.mesExample,
    );
    expect(byCode(entries.macros, 'opening').value).toBe(card.firstMes);
    expect(byCode(entries.macros, 'system_prompt').value).toBe(
      card.systemPrompt,
    );
    expect(byCode(entries.macros, 'system_prompt').name).toBe('系统提示词');
    // callback 与 system_prompt 是两条独立条目（值映射见报告）
    expect(byCode(entries.macros, 'callback').key).toBe('callback');
  });

  it('备用开场白应当依次生成 opening_<序号> 宏', async () => {
    const data = await loadCases();
    const greetings = data.card.data.alternate_greetings;

    const { entries } = await chara(data.card);

    greetings.forEach((greeting: string, index: number) => {
      const macro = byCode(entries.macros, `opening_${index}`);
      expect(macro).toMatchObject({
        key: 'opening',
        value: greeting,
        name: `开场白（${index}）`,
      });
    });
  });

  it('缺少字段的角色卡应当只产出空值宏', async () => {
    const data = await loadCases();

    const { entries } = await chara(data.minimalCard);

    expect(entries.macros.map((u: any) => u.code)).toEqual([
      'chara_name',
      'chara_desc',
      'chara_personality',
      'chara_mes_example',
      'opening',
      'system_prompt',
      'callback',
    ]);
    expect(byCode(entries.macros, 'chara_name').value).toBe(
      data.minimalCard.data.name,
    );
    expect(byCode(entries.macros, 'chara_desc').value).toBe('');
    expect(byCode(entries.macros, 'callback').value).toBe('');
    expect(entries.lorebooks).toEqual([]);
    expect(entries.regexes).toEqual([]);
    expect(entries.scripts).toEqual([]);
    expect(entries.styles).toEqual([]);
  });
});

describe('silly-tavern / 角色卡：世界书条目', () => {
  it('世界书条目应当按位置/关键词/开关映射为 lorebook', async () => {
    const data = await loadCases();
    // fixture 里的原始条目字段是可选的，断言按运行时形状取值
    const raw = data.card.data.character_book.entries as any[];

    const { entries } = await chara(data.card);
    const lorebooks = entries.lorebooks;

    // code 取 `sl` + uid
    expect(lorebooks.map((u: any) => u.code)).toEqual([
      'sl7',
      'sl2',
      'sl5',
      'sl9',
      'sl11',
    ]);

    // 常驻 + position 4：放到最后并按深度算 layer（fixture 里 depth 与 delay 同值，
    // 两种读法都得 160，字段取值差异见报告）
    expect(byCode(lorebooks, 'sl7')).toMatchObject({
      disabled: false,
      type: 'plaintext',
      match: 'always',
      expression: { last: true },
      content: raw[0].content,
      priority: 100,
      layer: (10 - raw[0].extensions.depth) * 20,
      role: 'system',
      name: raw[0].comment,
    });

    // 关键词条目：主/次关键词各成一组
    expect(byCode(lorebooks, 'sl2')).toMatchObject({
      disabled: true,
      type: 'plaintext',
      match: 'normal',
      expression: {
        keywords: [raw[1].keys, raw[1].secondary_keys],
        keywordsLength: 2,
        fitCount: 1,
      },
      content: data.macroText.cardKeywordContent,
      priority: 100,
      layer: 0,
      role: 'user',
      name: raw[1].comment,
    });

    // 只有次要关键词时也走 normal
    expect(byCode(lorebooks, 'sl5')).toMatchObject({
      disabled: false,
      match: 'normal',
      expression: {
        keywords: [raw[2].secondary_keys],
        keywordsLength: 1,
        fitCount: 1,
      },
      layer: 0,
    });

    // 缺字段兜底：没有关键词也没有备注，match 保持 always
    expect(byCode(lorebooks, 'sl9')).toMatchObject({
      disabled: false,
      match: 'always',
      expression: {},
      content: '',
      layer: 0,
      role: 'knowledge',
      name: '',
    });

    // 常驻但不在 depth 位置：表达式与 layer 都不动
    expect(byCode(lorebooks, 'sl11')).toMatchObject({
      match: 'always',
      expression: {},
      layer: 0,
    });
  });

  it('世界书内容里的宏同样会被转换', async () => {
    const data = await loadCases();

    const { entries } = await chara(data.macroCard);

    expect(byCode(entries.lorebooks, 'sl1').content).toBe(
      data.macroText.lorebook,
    );
  });
});

describe('silly-tavern / 角色卡：正则脚本', () => {
  it('正则脚本应当按 markdownOnly/promptOnly 映射 target', async () => {
    const data = await loadCases();
    const raw = data.card.data.extensions.regex_scripts;

    const { entries } = await chara(data.card);

    expect(entries.regexes).toHaveLength(raw.length);
    raw.forEach((script: any, index: number) => {
      expect(entries.regexes[index]).toEqual({
        disabled: script.disabled ?? false,
        pattern: script.findRegex,
        replacement: script.replaceString,
        target:
          script.promptOnly && script.markdownOnly
            ? 'both'
            : script.markdownOnly
              ? 'output'
              : 'input',
        name: script.scriptName,
      });
    });
    // 三种 target 分支都要真的有数据覆盖
    expect(entries.regexes.map((u: any) => u.target)).toEqual([
      'both',
      'output',
      'input',
      'input',
    ]);
  });

  it('没有正则脚本时 regexes 为空数组', async () => {
    const data = await loadCases();

    const { entries } = await chara(data.minimalCard);

    expect(entries.regexes).toEqual([]);
  });
});

describe('silly-tavern / 酒馆宏转换', () => {
  it('酒馆宏应当转换为 Eta 表达式', async () => {
    const data = await loadCases();

    const { entries } = await chara(data.macroCard);

    expect(byCode(entries.macros, 'chara_desc').value).toBe(
      data.macroText.description,
    );
    expect(byCode(entries.macros, 'opening').value).toBe(
      data.macroText.firstMes,
    );
    expect(byCode(entries.macros, 'system_prompt').value).toBe(
      data.macroText.systemPrompt,
    );
  });
});

describe('silly-tavern / 变量赋值宏', () => {
  // 修复前两处分支都写成 entries[1]：单次赋值时 entries 只有一个元素，
  // `entries[1].length` 直接抛 TypeError 让整个导入失败；写两次则按第二个值的字符拆宏。
  // 现在 entries 就是该 key 的值数组，第 i 次赋值对应 `key_i`。
  /** 只挑出变量赋值产生的宏（`key_序号`），按顺序比较 */
  function assignmentMacros(macros: any[]) {
    return macros
      .filter((u) => /^(hp|mp)_\d+$/.test(u.code))
      .map((u) => ({ code: u.code, key: u.key, value: u.value }));
  }

  it('角色卡：单次赋值一条宏，同 key 两次赋值各取自己的值', async () => {
    const data = await loadCases();

    const { entries } = await chara(data.varCard);

    expect(assignmentMacros(entries.macros)).toEqual(data.varText.macros);
  });

  it('角色卡：赋值片段应当从正文里摘除', async () => {
    const data = await loadCases();

    const { entries } = await chara(data.varCard);

    // 描述里摘掉 {{setvar::hp::10}}，开场白里摘掉两次赋值
    expect(byCode(entries.macros, 'chara_desc').value).toBe(
      data.varText.description,
    );
    expect(byCode(entries.macros, 'opening').value).toBe(data.varText.firstMes);
  });

  it('OpenAI 预设：赋值片段同样成宏并从 prompt 内容里摘除', async () => {
    const data = await loadCases();

    const { entries } = await preset(data.varPreset);

    // 预设分支没有 mp，只比较 hp 的两条
    const expected = data.varText.macros.filter(
      (u: any) => u.key === 'hp',
    );
    expect(assignmentMacros(entries.macros)).toEqual(expected);
    expect(byCode(entries.lorebooks, 'var-one').content).toBe(
      data.varText.one,
    );
    expect(byCode(entries.lorebooks, 'var-two').content).toBe(
      data.varText.two,
    );
  });
});

describe('silly-tavern / OpenAI 预设', () => {
  it('prompt 条目应当映射为 lorebook 并按注入位置计算 layer', async () => {
    const data = await loadCases();
    // fixture 里 injection_depth 声明为可选，断言时按运行时形状收窄
    const [main, absolute, disabled, bare] = data.openaiPreset.prompts as any[];
    const raw = data.openaiPreset.prompts;

    const { entries } = await preset(data.openaiPreset);
    const lorebooks = entries.lorebooks;

    // 每条 prompt 一条 lorebook，code 取 identifier
    expect(lorebooks).toHaveLength(raw.length);
    expect(lorebooks.map((u: any) => u.code)).toEqual(
      raw.map((u: any) => u.identifier),
    );

    // injection_position 0：放在最后，layer 按 10 - depth 反算
    expect(byCode(lorebooks, main.identifier)).toMatchObject({
      disabled: false,
      type: 'plaintext',
      match: 'always',
      expression: { last: true },
      content: '主内容 <%~ it.char %>',
      priority: 100,
      layer: (10 - main.injection_depth) * 20,
      role: 'system',
      name: main.name,
    });

    // injection_position 非 0：layer 直接用 depth
    expect(byCode(lorebooks, absolute.identifier)).toMatchObject({
      expression: {},
      layer: absolute.injection_depth * 20,
      role: 'user',
      name: absolute.name,
    });

    // enabled 为 false 的条目映射为 disabled
    expect(byCode(lorebooks, disabled.identifier)).toMatchObject({
      disabled: true,
      expression: {},
      layer: disabled.injection_depth * 20,
      role: 'assistant',
    });

    // 缺 injection_position 时走非 0 分支，depth 缺失按 0 处理
    expect(byCode(lorebooks, bare.identifier)).toMatchObject({
      type: 'plaintext',
      match: 'always',
      expression: {},
      content: '',
      layer: 0,
      name: bare.name,
    });
  });

  it('相同 identifier 的 prompt 会各自产出一条世界书条目（当前实现不去重）', async () => {
    const data = await loadCases();
    const duplicated = data.openaiPreset.prompts.filter(
      (u: any) => u.identifier === 'duplicate',
    );

    const { entries } = await preset(data.openaiPreset);

    expect(duplicated).toHaveLength(2);
    const matched = entries.lorebooks.filter(
      (u: any) => u.code === 'duplicate',
    );
    expect(matched).toHaveLength(duplicated.length);
    expect(matched.map((u: any) => u.content)).toEqual(
      duplicated.map((u: any) => u.content),
    );
  });

  it('预设元信息与宏应当按 OpenAI 预设格式生成', async () => {
    const data = await loadCases();
    const card = OpenAIPreset.fromJSON(data.openaiPreset);

    const result = await preset(data.openaiPreset, 'cover-file-id');

    expect(result.name).toBe(card.name);
    // 与角色卡分支不同，这里的描述就是预设名，版本固定 1.0.0
    expect(result.description).toBe(card.name);
    expect(result.version).toBe('1.0.0');
    expect(result.tags).toEqual(['preset', 'silly-tavern']);
    expect(result.opening).toBe('<%~ it.opening %>');
    expect(result.requires).toEqual([]);
    expect(result.properties).toEqual({});
    expect(result.cover).toBe('cover-file-id');
    expect(result.id).toMatch(/^s[0-9a-f]{32}$/);
    // preset 分支不产出正则/脚本/样式，宏也来自 prompt 内容
    expect(result.entries.regexes).toEqual([]);
    expect(result.entries.scripts).toEqual([]);
    expect(result.entries.styles).toEqual([]);
    expect(result.entries.macros).toEqual([]);
  });

  it('没有 prompts 时应当只产出空条目列表', async () => {
    const result = await preset({ name: '空预设' });

    expect(result.name).toBe('空预设');
    expect(result.entries.lorebooks).toEqual([]);
    expect(result.entries.macros).toEqual([]);
  });
});
