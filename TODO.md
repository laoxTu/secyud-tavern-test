# 测试待办（Tree）

> 目录与 `src/` 一一对应，文件名对应同名源码模块。
> `[x]` = 已有用例（可补强），`[ ]` = 待写。

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
│   ├── [ ] index.test.ts
│   ├── client/
│   │   ├── [ ] factory.test.ts
│   │   ├── [ ] state.test.ts
│   │   ├── [ ] proxy.test.ts
│   │   └── [ ] content.test.tsx
│   ├── server/
│   │   ├── [ ] factory.test.ts
│   │   ├── [ ] storage.test.ts
│   │   ├── [ ] repository.test.ts
│   │   └── [ ] api.test.ts
│   ├── macros/
│   │   ├── [x] index.test.ts               # 只测 Eta 库
│   │   ├── [ ] realm.test.ts
│   │   ├── [ ] property.test.ts
│   │   ├── [ ] feature.test.tsx
│   │   └── server/
│   │       └── [ ] storage.test.ts
│   ├── regexes/
│   │   ├── [ ] realm.test.ts
│   │   └── server/
│   │       └── [ ] storage.test.ts
│   ├── scripts/
│   │   ├── [ ] realm.test.ts
│   │   └── server/
│   │       └── [ ] storage.test.ts
│   └── styles/
│       ├── [x] realm.test.ts
│       └── server/
│           └── [ ] storage.test.ts
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
