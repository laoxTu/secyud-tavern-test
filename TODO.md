# 测试待办（Tree）

> 目录与 `src/` 一一对应，文件名对应同名源码模块。
> `[x]` = 已有用例（可补强），`[ ]` = 待写。
> 写用例前先看 `GUIDELINES.md`（数据一律 json 动态 import、mock 边界、jsdom 限制、未确认行为先不加断言）。
> 用例数据统一放 json、用 `(await import('./xxx.json')).default` 动态加载；需要改动时先 `structuredClone` 克隆一份。
> 当前：26 文件 / 272 用例通过（无 `it.fails`）。

```text
tests/
├── [ ] client.test.ts                      # src/client.ts
├── [x] template.test.ts                    # 占位，待删或替换
│
├── utils/
│   ├── [ ] array.test.ts
│   ├── [x] json-utils.test.ts
│   ├── [x] json-patch.test.ts
│   ├── [ ] str.test.ts
│   ├── [ ] cn.test.ts                      # src/utils/lib/utils.ts
│   ├── client/
│   │   └── hooks/
│   │       └── [ ] use-mobile.test.ts
│   └── server/
│       ├── [ ] cache.test.ts
│       ├── [ ] file.test.ts
│       ├── [x] hasher.test.ts
│       └── [ ] response.test.ts
│
├── plugins/
│   ├── [x] registry.test.ts
│   └── secyud-tavern-importer/
│       ├── [ ] silly-tavern.test.ts
│       └── [ ] api.test.ts
│
├── database/
│   ├── [ ] index.test.ts                   # utils 助手
│   ├── client/
│   │   ├── [ ] factory.test.ts
│   │   └── [ ] storage.test.ts
│   └── server/
│       ├── [ ] index.test.ts               # databases.get/query/exists
│       ├── [ ] factory.test.ts
│       └── [ ] provider.test.ts
│
├── interceptors/
│   ├── [ ] index.test.ts                   # BusinessError / checker / errors
│   ├── client/
│   │   └── [ ] index.test.ts
│   └── server/
│       ├── [ ] index.test.ts               # route / 拦截器链
│       ├── [ ] error.test.ts
│       └── [ ] register.test.ts
│
├── signal/
│   ├── [ ] index.test.ts                   # sseUtils / signals
│   ├── client/
│   │   ├── [ ] index.test.ts
│   │   └── [ ] proxy.test.ts
│   └── server/
│       ├── [ ] index.test.ts
│       └── [ ] api.test.ts
│
├── files/
│   ├── [ ] index.test.ts                   # url / mime
│   ├── client/
│   │   ├── [ ] proxy.test.ts
│   │   └── [ ] content.test.tsx
│   └── server/
│       ├── [ ] repository.test.ts
│       └── [ ] api.test.ts
│
├── global/
│   ├── [ ] index.test.ts                   # forms / config
│   ├── client/
│   │   ├── [ ] state.test.ts
│   │   ├── [ ] proxy.test.ts
│   │   └── [ ] menu.test.tsx
│   └── server/
│       ├── [ ] api.test.ts
│       └── [ ] repository.test.ts
│
├── generated/
│   ├── [ ] resources.test.ts
│   ├── [ ] api-path.test.ts
│   └── [ ] registerer.test.ts              # client + server
│
├── localization/
│   ├── [ ] config.test.ts
│   └── [ ] request.test.ts
│
├── components/
│   ├── [ ] index.test.ts                   # element / submitTargetFormOnKey
│   ├── [ ] hooks.test.tsx
│   └── [ ] pager.test.tsx
│
├── presets/
│   ├── [x] index.test.ts
│   ├── client/
│   │   ├── [x] factory.test.ts
│   │   ├── [x] state.test.ts
│   │   ├── [x] proxy.test.ts
│   │   └── [ ] content.test.tsx
│   ├── server/
│   │   ├── [x] factory.test.ts
│   │   ├── [x] storage.test.ts
│   │   ├── [x] repository.test.ts
│   │   └── [x] api.test.ts
│   ├── macros/
│   │   ├── [x] index.test.ts               # 只测 Eta 库
│   │   ├── [x] realm.test.ts
│   │   ├── [x] property.test.ts
│   │   ├── [ ] feature.test.tsx
│   │   └── server/
│   │       └── [x] storage.test.ts
│   ├── regexes/
│   │   ├── [x] realm.test.ts
│   │   └── server/
│   │       └── [x] storage.test.ts
│   ├── scripts/
│   │   ├── [x] realm.test.ts
│   │   └── server/
│   │       └── [x] storage.test.ts
│   └── styles/
│       ├── [x] realm.test.ts
│       └── server/
│           └── [x] storage.test.ts
│
├── lorebooks/
│   ├── [ ] index.test.ts
│   ├── [ ] matcher.test.ts
│   ├── [ ] realm.test.ts
│   ├── [ ] tool.test.ts
│   ├── [ ] content.test.tsx
│   ├── matchers/
│   │   ├── [ ] always.test.ts
│   │   ├── [ ] date-editor.test.ts
│   │   ├── [ ] event.test.ts
│   │   ├── [ ] normal.test.ts
│   │   ├── [ ] variable.test.ts
│   │   └── [ ] vector.test.ts
│   └── server/
│       └── [ ] storage.test.ts
│
├── memories/
│   ├── [ ] index.test.ts
│   ├── [ ] rag.test.ts
│   ├── [ ] realm.test.ts
│   ├── [ ] tool.test.ts
│   ├── [ ] transformer.test.ts
│   ├── [ ] setting.test.tsx
│   ├── [ ] content.test.tsx
│   └── server/
│       └── [ ] storage.test.ts
│
├── stories/
│   ├── [ ] realms.test.ts                  # client/realms/index.ts
│   ├── [ ] renderer.test.ts
│   ├── client/
│   │   ├── [ ] state.test.ts
│   │   ├── [ ] factory.test.ts
│   │   ├── [ ] proxy.test.ts
│   │   ├── [ ] content.test.tsx
│   │   ├── [ ] component.test.tsx
│   │   └── realms/
│   │       ├── [ ] state.test.ts
│   │       ├── [ ] feature.test.tsx
│   │       └── [ ] page.test.tsx
│   ├── server/
│   │   ├── [ ] repository.test.ts
│   │   ├── [ ] factory.test.ts
│   │   └── [ ] api.test.ts
│   └── images/
│       ├── [ ] api.test.ts
│       └── [ ] client.test.tsx
│
├── comfyui/
│   ├── [x] civitai.test.ts
│   ├── [x] select.test.ts
│   ├── client/
│   │   ├── [ ] proxy.test.ts
│   │   ├── [ ] state.test.ts
│   │   ├── [ ] feature.test.tsx
│   │   └── [ ] tool.test.tsx
│   ├── callback/
│   │   └── [ ] client.test.ts
│   ├── editor/
│   │   ├── [x] generator.test.ts
│   │   └── [ ] configurators.test.ts
│   ├── select/
│   │   └── [ ] client.test.ts
│   ├── civitai/
│   │   ├── [ ] client.test.ts
│   │   └── [ ] server.test.ts
│   └── server/
│       ├── [ ] importers.test.ts
│       ├── [ ] api-workflows.test.ts
│       ├── [ ] api-models.test.ts
│       ├── [ ] repository-workflow.test.ts
│       ├── [ ] repository-model.test.ts
│       ├── [ ] storage.test.ts
│       └── [ ] tool.test.ts
│
├── models/
│   ├── [ ] index.test.ts
│   ├── client/
│   │   ├── [ ] processer.test.ts
│   │   ├── [ ] engine.test.ts
│   │   ├── [ ] index.test.ts               # convert / key / cache
│   │   ├── [ ] state.test.ts
│   │   ├── [ ] proxy.test.ts
│   │   └── [ ] setting.test.tsx
│   ├── server/
│   │   ├── [ ] engine.test.ts
│   │   ├── [ ] repository.test.ts
│   │   ├── [ ] api.test.ts
│   │   └── [ ] storage.test.ts
│   ├── openai/
│   │   ├── [ ] index.test.ts
│   │   ├── client/
│   │   │   └── [ ] engine.test.tsx
│   │   └── server/
│   │       └── [ ] engine.test.ts
│   ├── anthropic/
│   │   ├── [ ] index.test.ts
│   │   ├── client/
│   │   │   └── [ ] engine.test.tsx
│   │   └── server/
│   │       └── [ ] engine.test.ts
│   └── deepseek/
│       ├── [ ] index.test.ts
│       ├── client/
│       │   └── [ ] engine.test.tsx
│       └── server/
│           └── [ ] engine.test.ts
│
├── tasks/
│   ├── [ ] index.test.ts                   # TaskRunner
│   ├── client/
│   │   ├── [ ] state.test.ts
│   │   ├── [ ] proxy.test.ts
│   │   └── [ ] content.test.tsx
│   └── server/
│       ├── [ ] manager.test.ts
│       ├── [ ] repository.test.ts
│       └── [ ] api.test.ts
│
└── tools/
    ├── client/
    │   ├── [ ] task.test.ts
    │   ├── [ ] realm.test.ts
    │   └── [ ] index.test.tsx
    ├── server/
    │   └── [ ] storage.test.ts
    ├── agents/
    │   ├── client/
    │   │   └── [ ] index.test.tsx
    │   └── server/
    │       └── [ ] index.test.ts
    ├── elicits/
    │   └── client/
    │       ├── [ ] states.test.ts
    │       ├── [ ] tool.test.tsx
    │       └── [ ] feature.test.tsx
    ├── fetchers/
    │   └── client/
    │       └── [ ] index.test.tsx
    ├── scripts/
    │   ├── client/
    │   │   └── [ ] index.test.tsx
    │   └── server/
    │       └── [ ] index.test.ts
    └── variables/
        ├── [ ] index.test.ts
        └── client/
            └── [ ] index.test.tsx
```

## 跳过（不建用例）

```text
* 桶文件 / 纯类型：**/index.ts、utils/json-schema.ts、**/server/storage.ts(接口)
* DDL：**/server/schema.ts
* 空实现：tools/{variables,fetchers,elicits}/server/index.ts、{lorebooks,memories}/server/provider.ts
* 纯展示 / 无逻辑包装：components/ui/**、components/{dialog,empty,field,input,media,resizeable,tooltip,collapsible}.tsx、models/client/component.tsx、tools/client/{content,feature}.tsx、**/loading.tsx
* 注册 / 编排：各模块 client/index.tsx 的注册函数、comfyui/{index.ts,tool.ts,select/index.ts}
* 生成物：app/api/**/route.ts
```

## 进度

### presets：已完成
- 用例：`presets/**` 共 18 个文件（`macros/index.test.ts` 与 `styles/realm.test.ts` 为原有，其余新增），数据落在 13 个 fixture json。
- 剩余展示层未做：`presets/client/content.test.tsx`、`presets/macros/feature.test.tsx`。

### 已按确认的预期改动源码
- `src/presets/regexes/server/storage.ts`：meta 写 `item`（原来传的是函数，序列化后内容丢失），正则条目现在可以正常归档往返。
- `src/presets/server/storage.ts`：重建封面沿用 meta 里的原始 MIME（原来又拼了一次 `image/`）。
- `src/presets/macros/client/realm.ts`：单选条件改 `&&`（没有选择时取第一个，已有选择时保留）；残留的已删除 code 跳过而不是抛错。
- `src/presets/macros/client/feature.tsx`：删掉被 setter 立即覆盖的死赋值。

### 已确认为设计、不加断言
- 同 code 的样式/脚本条目重复注入属既定软处理，重复 id 由页面报错暴露。

