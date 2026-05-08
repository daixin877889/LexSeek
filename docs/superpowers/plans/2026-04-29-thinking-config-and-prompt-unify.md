# 思考模式配置 + 节点/提示词统一纳管 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 models 表加思考模式开关字段、nodes 表加节点级思考默认值字段；用 chatModelFactory 当期实施 anthropic+gemini 思考协议；把 4 处硬编 LLM 调用迁到统一节点管理；删除冗余旧版本 prompts 与 e2e 残留数据。

**Architecture:** 三方决议（模型层硬门禁 + 节点层默认 + 前端临时开关）通过 `resolveThinkingFromNodeConfig` helper 收口；硬编调用统一走 `invokeNodeJson`；分 PR 1（schema + UI + 新节点 + 删硬编）和 PR 2（提示词重构）。

**Tech Stack:** Prisma + PostgreSQL / Nuxt 4 + Vue 3 + Tailwind v4 / @langchain/{anthropic,deepseek,google-genai,openai} / shadcn-vue / vitest + fast-check

**Spec：** `docs/superpowers/specs/2026-04-29-thinking-config-and-prompt-unify-design.md`

---

## File Structure

### Phase 1 (PR 1) — 修改/创建文件清单

| 文件 | 改动类型 | 责任 |
|---|---|---|
| `prisma/models/model.prisma` | Modify | 加 `supportsThinking` 字段 |
| `prisma/models/node.prisma` | Modify | 加 `thinkingEnabled` 字段 |
| `prisma/migrations/<ts>_add_thinking_fields/migration.sql` | Auto-create | 由 prisma migrate dev 自动生成 |
| `shared/types/model.ts` | Modify | `CreateModelInput` / `UpdateModelInput` 加 `supportsThinking?: boolean` |
| `shared/types/node.ts` | Modify | `CreateNodeInput` 加 `thinkingEnabled?: boolean` |
| `server/services/node/node.service.ts` | Modify | NodeConfig 接口扩字段 + 3 处构造 + 末尾导出 `resolveThinking` / `resolveThinkingFromNodeConfig` |
| `server/services/node/node.dao.ts` | Modify | createNodeDao + updateNodeDao 写入 thinkingEnabled |
| `server/services/model/models.dao.ts` | Modify | createModelDao + updateModelDao 写入 supportsThinking |
| `server/services/node/chatModelFactory.ts` | Modify | 修 budget_tokens=10000 现有 bug；加 `applyThinkingParams` 内部函数 |
| `server/services/agent-platform/factory/runtime.ts` | Modify | thinking 决议改造 |
| `server/agents/case-analysis/runAnalysisSubAgent.ts` | Modify | 同上 |
| `server/services/workflow/agents/moduleAgent.ts` | Modify | 同上 |
| `server/services/workflow/agents/assistantAgent.ts` | Modify | 同上 |
| `server/services/agent-platform/subAgent/subAgentToolFactory.ts` | Modify | 同上 |
| `server/agents/case-module/agent.config.ts` | Modify | 同上 |
| `server/api/v1/admin/models/index.post.ts` | Modify | zod schema 加 supportsThinking |
| `server/api/v1/admin/models/[id].patch.ts`（注：实际是 `[id]/index.patch.ts` 或类似）| Modify | 同上 |
| `server/api/v1/admin/nodes/index.post.ts` | Modify | zod schema 加 thinkingEnabled |
| `server/api/v1/admin/nodes/[id].patch.ts` | Modify | 同上 |
| `app/components/admin/models/ModelFormDialog.vue` | Modify | 加 supports_thinking Checkbox |
| `app/components/admin/nodes/NodeFormDialog.vue` | Modify | 加 thinking_enabled Checkbox + 联动 |
| `prisma/seeds/seedData.sql` | Modify | 给现有 17 models / 23 nodes INSERT 加新字段；新增 3 nodes / 6 prompts INSERT；删除 4 旧 prompts + 87 e2e node_groups |
| `server/services/material/material.service.ts` | Modify | 删硬编 anthropic Haiku → invokeNodeJson |
| `server/agents/contract/docx/partyDetector.ts` | Modify | 删 LLM_PROMPT → invokeNodeJson |
| `server/services/case/initAnalysis.service.ts` | Modify | 删硬编 systemPrompt → invokeNodeJson |
| `server/services/memory/consolidator.service.ts` | Modify | 复用 runMemoryExtractionService |
| `server/services/case/caseExtraction.service.ts` | Modify | 删 dead code CASE_COURT_FIELDS_PROMPT_APPENDIX |
| `tests/server/node/chatModelFactory.test.ts` | Modify | 加 applyThinkingParams 单测 |
| `tests/server/node/node.service.test.ts` | Modify | 加 resolveThinking 单测 |

### Phase 2 (PR 2) — 修改文件清单

| 文件 | 改动类型 | 责任 |
|---|---|---|
| `prisma/seeds/seedData.sql` | Modify | INSERT 3 条 documentMain user prompt + UPDATE search_intent_router v2 |
| `server/services/agent-platform/nodeConfig/promptRenderer.ts` | Modify | PromptRenderContext 加 fileIds + userExtraText |
| `server/services/workflow/agents/documentMainAgent.ts` | Modify | 删 buildInitialPromptFromDraft → 读 nodeConfig.prompts |
| `server/services/retrieval/intentClassifier.service.ts` | Modify | 删 DEFAULT_SYSTEM_PROMPT + typeHint 改占位符 |
| `server/api/v1/case/extract.post.ts` | Modify | 删 SUMMARY_PROMPT_TEMPLATE → material_summarizer 节点 |

---

# Phase 1 — PR 1: Schema + UI + 新节点 + 删硬编

## Task 1：Prisma schema 加字段 + 生成迁移

**Files:**
- Modify: `prisma/models/model.prisma`
- Modify: `prisma/models/node.prisma`
- Auto-create: `prisma/migrations/<ts>_add_thinking_fields/migration.sql`

- [ ] **Step 1: 修改 model.prisma**

在 `models` 模型的 `priority` 字段后追加：

```prisma
  /// 模型是否支持思考切换（true = 节点可配 thinkingEnabled，UI 才显示开关）
  supportsThinking           Boolean   @default(false) @map("supports_thinking")
```

- [ ] **Step 2: 修改 node.prisma**

在 `nodes` 模型的 `useSkillsAsLogic` 字段后追加：

```prisma
  /// 节点是否启用思考模式（仅当关联模型 supportsThinking=true 时生效）
  thinkingEnabled  Boolean  @default(false) @map("thinking_enabled")
```

- [ ] **Step 3: 生成迁移**

```bash
bun run prisma:migrate --name add_thinking_fields
```

预期：
- 自动生成 `prisma/migrations/<ts>_add_thinking_fields/migration.sql` 含两条 ALTER TABLE
- dev 库自动应用迁移
- prisma client 自动重新生成

- [ ] **Step 4: 同步 testing 库**

```bash
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' bun run prisma:deploy
```

预期：testing 库结构同步。

- [ ] **Step 5: 验证迁移文件无业务数据**

```bash
cat prisma/migrations/<ts>_add_thinking_fields/migration.sql
```

预期：仅含 `ALTER TABLE` 语句，无 INSERT/UPDATE/DELETE。

- [ ] **Step 6: Commit**

```bash
git add prisma/models/ prisma/migrations/ generated/prisma/
git commit -m "feat(db): nodes/models 表加 thinking 模式字段"
```

---

## Task 2：shared/types 输入类型扩展

**Files:**
- Modify: `shared/types/model.ts`
- Modify: `shared/types/node.ts`

- [ ] **Step 1: 修改 model.ts CreateModelInput / UpdateModelInput**

定位 `CreateModelInput` 接口（约第 X 行），在 `outputCostPerMillionTokens` 后追加：

```ts
    /** 是否支持思考切换 */
    supportsThinking?: boolean
```

定位 `UpdateModelInput` 接口，最后追加同样的字段。

- [ ] **Step 2: 修改 node.ts CreateNodeInput**

定位 `CreateNodeInput` 接口，在 `outputSchema` 后追加：

```ts
    thinkingEnabled?: boolean
```

`UpdateNodeInput = Partial<Omit<CreateNodeInput, 'name'>>` 自动继承。

- [ ] **Step 3: typecheck**

```bash
bun run typecheck
```

预期：通过（生成的 prisma client 已含新字段）。

- [ ] **Step 4: Commit**

```bash
git add shared/types/model.ts shared/types/node.ts
git commit -m "feat(types): CreateModelInput/CreateNodeInput 加 thinking 字段"
```

---

## Task 3：DAO 写入新字段

**Files:**
- Modify: `server/services/model/models.dao.ts`
- Modify: `server/services/node/node.dao.ts`

- [ ] **Step 1: 修改 createModelDao**

在 `createModelDao` 的 `data: { ... }` 里追加：

```ts
            ...(data.supportsThinking !== undefined && { supportsThinking: data.supportsThinking }),
```

- [ ] **Step 2: 修改 updateModelDao**

同样追加上面那行（updateModelDao 已使用 `...(data.X !== undefined && { X: data.X })` 模式）。

- [ ] **Step 3: 修改 createNodeDao + updateNodeDao**

参考上面同样模式给 `data` 加：

```ts
            ...(data.thinkingEnabled !== undefined && { thinkingEnabled: data.thinkingEnabled }),
```

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add server/services/model/models.dao.ts server/services/node/node.dao.ts
git commit -m "feat(dao): models/nodes DAO 透写 thinking 字段"
```

---

## Task 4：NodeConfig 接口扩字段 + 3 处构造逻辑

**Files:**
- Modify: `server/services/node/node.service.ts`

- [ ] **Step 1: 在 NodeConfig 接口加两个字段**

定位 `interface NodeConfig`（约 line 63）的 `modelMaxOutputTokens?: number` 后追加：

```ts
    /** 节点是否启用思考模式 */
    thinkingEnabled: boolean
    /** 关联模型是否支持思考切换 */
    modelSupportsThinking: boolean
```

- [ ] **Step 2: 修改 getNodeConfigService 的 config 构造**

在三处构造点（`getNodeConfigService` / `getNodeConfigByIdService` / `getNodeConfigsByTypes`）的返回 config 对象里追加：

```ts
            thinkingEnabled: nodeConfig.thinkingEnabled ?? false,
            modelSupportsThinking: nodeConfig.model.supportsThinking ?? false,
```

注意 `getNodeConfigsByTypes` 用的是 `node.thinkingEnabled` / `node.model.supportsThinking`。

- [ ] **Step 3: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: 跑现有 node service 测试**

```bash
npx vitest run tests/server/node/node.service.test.ts --reporter=verbose
```

预期：现有测试全过（新字段有默认值）。

- [ ] **Step 5: Commit**

```bash
git add server/services/node/node.service.ts
git commit -m "feat(node): NodeConfig 加 thinkingEnabled/modelSupportsThinking 字段"
```

---

## Task 5：node.service.ts 末尾导出 resolveThinking / resolveThinkingFromNodeConfig

**Files:**
- Modify: `server/services/node/node.service.ts`
- Test: `tests/server/node/node.service.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/server/node/node.service.test.ts` 末尾追加：

```ts
import { resolveThinking, resolveThinkingFromNodeConfig } from '~~/server/services/node/node.service'

describe('resolveThinking', () => {
    it('模型不支持思考时强制返回 false', () => {
        expect(resolveThinking(false, true, true)).toBe(false)
        expect(resolveThinking(false, undefined, true)).toBe(false)
    })
    it('前端 ctx.thinking 显式时优先', () => {
        expect(resolveThinking(true, true, false)).toBe(true)
        expect(resolveThinking(true, false, true)).toBe(false)
    })
    it('ctx.thinking undefined 时回落节点配置', () => {
        expect(resolveThinking(true, undefined, true)).toBe(true)
        expect(resolveThinking(true, undefined, false)).toBe(false)
    })
})

describe('resolveThinkingFromNodeConfig', () => {
    it('从 NodeConfig 读字段并决议', () => {
        const cfg = { modelSupportsThinking: true, thinkingEnabled: true } as any
        expect(resolveThinkingFromNodeConfig(cfg, undefined)).toBe(true)
        expect(resolveThinkingFromNodeConfig(cfg, false)).toBe(false)
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run tests/server/node/node.service.test.ts -t 'resolveThinking' --reporter=verbose
```

预期：FAIL（函数未定义）。

- [ ] **Step 3: 实现 helper**

在 `server/services/node/node.service.ts` 文件末尾追加：

```ts
/**
 * 决议某次 LLM 调用最终是否启用思考模式。
 * 优先级：模型硬门禁 > 前端 ctx.thinking > 节点配置默认值。
 */
export function resolveThinking(
    modelSupportsThinking: boolean,
    ctxThinking: boolean | undefined,
    nodeThinkingEnabled: boolean,
): boolean {
    if (!modelSupportsThinking) return false
    if (ctxThinking !== undefined) return ctxThinking
    return nodeThinkingEnabled
}

/** 调用方便捷封装。 */
export function resolveThinkingFromNodeConfig(
    nodeConfig: NodeConfig,
    ctxThinking: boolean | undefined,
): boolean {
    return resolveThinking(
        nodeConfig.modelSupportsThinking,
        ctxThinking,
        nodeConfig.thinkingEnabled,
    )
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run tests/server/node/node.service.test.ts -t 'resolveThinking' --reporter=verbose
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add server/services/node/node.service.ts tests/server/node/node.service.test.ts
git commit -m "feat(node): 新增 resolveThinking 决议 helper"
```

---

## Task 6：chatModelFactory 修复 budget_tokens / maxTokens 冲突

**Files:**
- Modify: `server/services/node/chatModelFactory.ts`
- Test: `tests/server/node/chatModelFactory.test.ts`

> 设计说明：现有 `chatModelFactory.ts` 已经在 anthropic / gemini creator 内部实现了 thinking 字段处理（line 110/132），本 task 只修复"budget_tokens 10000 > maxTokens 8192"的 API 冲突，**不引入新的 `applyThinkingParams` 抽象**——现有结构已经足够清晰。DeepSeek SDK / OpenAI 兼容端点的 thinking 路径按 spec §4 当期不实施（保持现状不发送 thinking 参数）。

- [ ] **Step 1: 修复 anthropic 现有 bug**

定位 `chatModelFactory.ts:128-134`（anthropic creator 的 thinking 段），把 `budget_tokens: 10_000` 改为 `budget_tokens: 4096`。

```ts
                ...(config.thinking && {
                    thinking: { type: 'enabled' as const, budget_tokens: 4096 },
                }),
```

- [ ] **Step 2: 同样修复 gemini creator**

定位 `chatModelFactory.ts:110` `thinkingConfig: { thinkingBudget: 10_000 }` → `thinkingBudget: 4096, includeThoughts: true`。

```ts
                ...(config.thinking && {
                    thinkingConfig: { thinkingBudget: 4096, includeThoughts: true },
                }),
```

- [ ] **Step 3: 验证 maxTokens 在 thinking=true 时足够**

定位 anthropic creator 的 maxTokens 行：`maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS`

改为：

```ts
            // thinking=true 时强制 maxTokens >= 6500（budget_tokens 4096 + 2000 输出余量 + 余量）
            maxTokens: config.thinking
                ? Math.max(config.maxTokens ?? DEFAULT_MAX_TOKENS, 8192)
                : (config.maxTokens ?? DEFAULT_MAX_TOKENS),
```

- [ ] **Step 4: 跑现有 chatModelFactory 测试**

```bash
npx vitest run tests/server/node/chatModelFactory.test.ts --reporter=verbose
```

预期：全部通过（如有断言用 10000 budget_tokens 的旧值需同步改）。

- [ ] **Step 5: Commit**

```bash
git add server/services/node/chatModelFactory.ts tests/server/node/chatModelFactory.test.ts
git commit -m "fix(model): anthropic budget_tokens 与 maxTokens 冲突"
```

---

## Task 7：7 处调用点改造

**Files:**
- Modify: `server/services/agent-platform/factory/runtime.ts`
- Modify: `server/agents/case-analysis/runAnalysisSubAgent.ts`
- Modify: `server/services/workflow/agents/moduleAgent.ts`
- Modify: `server/services/workflow/agents/assistantAgent.ts`
- Modify: `server/services/agent-platform/subAgent/subAgentToolFactory.ts`
- Modify: `server/agents/case-module/agent.config.ts`

- [ ] **Step 1: 修改 runtime.ts:119**

在文件顶部 import 处加：

```ts
import { resolveThinkingFromNodeConfig } from '~~/server/services/node/node.service'
```

修改 `createChatModel({ ... })` 的 `thinking: ctx.thinking ?? false` 行：

```ts
        thinking: resolveThinkingFromNodeConfig(nodeConfig, ctx.thinking),
```

- [ ] **Step 2: 修改 runAnalysisSubAgent.ts:96**

在文件顶部加 import（同上）。修改 `createChatModel({ thinking, ... })`：

```ts
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
        thinking: resolveThinkingFromNodeConfig(nodeConfig, thinking),
        maxTokens: nodeConfig.modelMaxOutputTokens,
    })
```

- [ ] **Step 3: 修改 moduleAgent.ts:89**

参考上面模式，把 `thinking: options.thinking` 改成 `thinking: resolveThinkingFromNodeConfig(nodeConfig, options.thinking)`。

- [ ] **Step 4: 修改 assistantAgent.ts:84**

```ts
        thinking: resolveThinkingFromNodeConfig(mainConfig, thinking),
```

- [ ] **Step 5: 修改 subAgentToolFactory.ts:122**

子代理工厂内部的 `createChatModel` 没传 thinking 字段。改为：

```ts
                    const model = createChatModel({
                        sdkType: config.modelSdkType,
                        modelName: config.modelName,
                        apiKey: activeApiKey.apiKey,
                        baseUrl: config.modelProviderBaseUrl,
                        temperature: 0.7,
                        streaming: true,
                        thinking: resolveThinkingFromNodeConfig(config, undefined),  // 子代理无 ctx.thinking，用节点默认
                        maxTokens: config.modelMaxOutputTokens,
                    })
```

- [ ] **Step 6: 修改 case-module/agent.config.ts:57**

```ts
            thinking: resolveThinkingFromNodeConfig(nodeConfig, ctx.thinking),
```

注意 case-module/agent.config.ts 的 ctx 是 AgentRunnerContext（含 thinking），nodeConfig 来自 runtime 的 `getNodeConfigCached`。

- [ ] **Step 7: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 8: 跑相关单测**

```bash
npx vitest run tests/server/agent-platform/ tests/server/agents/ --reporter=verbose
```

- [ ] **Step 9: Commit**

```bash
git add server/services/agent-platform/factory/runtime.ts server/agents/ server/services/workflow/agents/ server/services/agent-platform/subAgent/
git commit -m "feat(agent): 7 处调用点统一走 resolveThinkingFromNodeConfig"
```

---

## Task 8：admin models API zod 加 supportsThinking

**Files:**
- Modify: `server/api/v1/admin/models/index.post.ts`
- Modify: `server/api/v1/admin/models/[id].patch.ts`

- [ ] **Step 1: 修改 POST bodySchema**

定位 `bodySchema` 末尾（在 `outputCostPerMillionTokens` 字段之后），追加：

```ts
    supportsThinking: z.boolean()
        .optional()
        .default(false),
```

并修改 `createModelService` 调用，把 `supportsThinking: parsed.data.supportsThinking` 加进 body 里（参考现有字段透传方式）。

- [ ] **Step 2: 修改 PATCH bodySchema**

同上模式（PATCH 用 `.optional()` 不需 default）。

- [ ] **Step 3: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: 跑 admin models API 测试**

```bash
npx vitest run tests/server -t 'admin models' --reporter=verbose
```

- [ ] **Step 5: Commit**

```bash
git add server/api/v1/admin/models/
git commit -m "feat(api): admin models 接受 supportsThinking 字段"
```

---

## Task 9：admin nodes API zod 加 thinkingEnabled

**Files:**
- Modify: `server/api/v1/admin/nodes/index.post.ts`
- Modify: `server/api/v1/admin/nodes/[id].patch.ts`

- [ ] **Step 1: 修改 POST bodySchema**

定位 `bodySchema` 末尾（在 `outputSchema` 字段之后），追加：

```ts
    thinkingEnabled: z.boolean()
        .optional()
        .default(false),
```

把 `parsed.data.thinkingEnabled` 透传给 `createNodeService`。

- [ ] **Step 2: 修改 PATCH bodySchema**

同上模式。

- [ ] **Step 3: typecheck + 测试**

```bash
bun run typecheck
npx vitest run tests/server -t 'admin nodes' --reporter=verbose
```

- [ ] **Step 4: Commit**

```bash
git add server/api/v1/admin/nodes/
git commit -m "feat(api): admin nodes 接受 thinkingEnabled 字段"
```

---

## Task 10：ModelFormDialog UI 加 supports_thinking 开关

**Files:**
- Modify: `app/components/admin/models/ModelFormDialog.vue`

- [ ] **Step 1: form 默认值加字段**

在 `form` 初始化对象（`getDefaultForm` 等）里追加：

```ts
    supportsThinking: false,
```

提交逻辑里把 `supportsThinking: form.value.supportsThinking` 加入 body。

编辑加载（`watch(() => props.model)` 类似处）追加：

```ts
    supportsThinking: model.supportsThinking ?? false,
```

- [ ] **Step 2: 模板加 Checkbox**

定位 SDK 类型 `<Select v-model="form.sdkType">` 之后，追加：

```vue
                <!-- 仅 chat 类型显示思考开关 -->
                <div v-if="form.modelType === 'chat'" class="flex items-center space-x-2">
                    <Checkbox id="supportsThinking" v-model="form.supportsThinking" />
                    <Label for="supportsThinking" class="cursor-pointer">
                        支持思考切换
                        <span class="text-xs text-muted-foreground ml-2">
                            （勾选后，关联此模型的节点可在节点编辑页配置"启用思考模式"开关）
                        </span>
                    </Label>
                </div>
```

import `Checkbox`：

```ts
import { Checkbox } from '~/components/ui/checkbox'
```

- [ ] **Step 3: modelType 切换时自动重置 supports_thinking**

```ts
watch(() => form.value.modelType, (newType) => {
    if (newType !== 'chat') {
        form.value.supportsThinking = false
    }
})
```

- [ ] **Step 4: 启动 dev server 手工验证**

```bash
bun dev
```

打开 `http://localhost:3000/admin/models`，新建模型：
- modelType=chat → 看到"支持思考切换"复选框
- modelType=embedding → 复选框消失
- 切回 chat → 复选框恢复 false

- [ ] **Step 5: Commit**

```bash
git add app/components/admin/models/ModelFormDialog.vue
git commit -m "feat(ui): ModelFormDialog 加思考切换开关（仅 chat 类型显示）"
```

---

## Task 11：NodeFormDialog UI 加 thinking_enabled 开关 + 联动

**Files:**
- Modify: `app/components/admin/nodes/NodeFormDialog.vue`

- [ ] **Step 1: form 默认值加字段**

在 `getDefaultForm` 加：

```ts
    thinkingEnabled: false,
```

编辑加载处加：`thinkingEnabled: node.thinkingEnabled ?? false,`

提交 body 加：`thinkingEnabled: form.value.thinkingEnabled,`

- [ ] **Step 2: 加 selectedModelSupportsThinking computed**

```ts
const selectedModelSupportsThinking = computed(() => {
    const m = models.value.find(x => String(x.id) === form.value.modelId)
    return m?.supportsThinking === true
})
```

- [ ] **Step 3: modelId 切换时联动重置**

```ts
watch(() => form.value.modelId, () => {
    if (!selectedModelSupportsThinking.value) {
        form.value.thinkingEnabled = false
    }
})
```

- [ ] **Step 4: 模板加 Checkbox**

在 "关联模型 Select" 后面加：

```vue
                <div v-if="selectedModelSupportsThinking" class="flex items-center space-x-2">
                    <Checkbox id="thinkingEnabled" v-model="form.thinkingEnabled" />
                    <Label for="thinkingEnabled" class="cursor-pointer">
                        启用思考模式
                        <span class="text-xs text-muted-foreground ml-2">
                            （前端用户深度思考开关优先；前端无开关的场景将使用此默认值）
                        </span>
                    </Label>
                </div>
```

import `Checkbox`。

- [ ] **Step 5: dev server 手工验证**

打开 `http://localhost:3000/admin/nodes`：
- 在 admin/models 把 deepseek-chat 的 supports_thinking 临时打开
- 新建节点 → 选 deepseek-chat → 看到"启用思考模式"复选框
- 改选 text-embedding-v2 → 复选框消失，thinkingEnabled 自动重置为 false
- 把 deepseek-chat 的 supports_thinking 改回 false（恢复现状）

- [ ] **Step 6: Commit**

```bash
git add app/components/admin/nodes/NodeFormDialog.vue
git commit -m "feat(ui): NodeFormDialog 加思考开关 + 模型联动"
```

---

## Task 12：dev/testing 库 INSERT 3 个新节点 + 6 条新 prompts

**Files:**
- 直接 SQL 修改 dev / testing 库（不进 migration.sql）

- [ ] **Step 1: 准备 SQL 脚本（一次性）**

打开终端：

```bash
cd /Users/daixin/work/dev/LexSeek/LexSeek
```

写到临时文件 `/tmp/thinking-data.sql`（**不进 git**）：

```sql
-- 新增 3 个节点（id 自增；模型 id=1）
INSERT INTO nodes (name, title, description, type, priority, model_id, tools, output_schema, group_id, status, thinking_enabled)
VALUES (
    'materialAutoSummary', '材料自动摘要',
    '材料 OCR/ASR/文本就绪后异步生成 100 字内摘要，写入 caseMaterials.summary 用于卡片展示',
    'extraction', 110, 1, '[]', NULL, NULL, 1, false
);
INSERT INTO nodes (name, title, description, type, priority, model_id, tools, output_schema, group_id, status, thinking_enabled)
VALUES (
    'contractPartyDetect', '合同甲乙方与类型识别',
    '合同上传后从前 1500 字识别甲方/乙方/合同类型；正则失败时 LLM 兜底',
    'extraction', 41, 1, '[]',
    '{"type":"object","required":["partyA","partyB","contractType"],"properties":{"partyA":{"type":["string","null"],"description":"甲方完整名称；无法识别返回 null"},"partyB":{"type":["string","null"],"description":"乙方完整名称；无法识别返回 null"},"contractType":{"type":["string","null"],"description":"合同类型，必须从枚举中选一个，无法识别返回 null","enum":["买卖合同","租赁合同","劳动合同","劳务合同","服务合同","承揽合同","建设工程合同","技术合同","委托合同","行纪合同","居间合同","保管合同","仓储合同","运输合同","赠与合同","借款合同","保证合同","抵押合同","质押合同","定金合同","保险合同","合伙合同","股权转让合同","其他",null]}}}'::jsonb,
    NULL, 1, false
);
INSERT INTO nodes (name, title, description, type, priority, model_id, tools, output_schema, group_id, status, thinking_enabled)
VALUES (
    'analysisSummary', '案件分析结果摘要',
    '案件分析模块完成后对 200-400 字摘要写入 caseAnalyses.summary，用于案件分析列表卡片',
    'extraction', 105, 1, '[]', NULL, NULL, 1, false
);
```

继续写 6 条新 prompts（用 INSERT 时的 node_id 用上面 INSERT 返回的实际 id；若使用脚本批量则 SELECT 子查询）：

```sql
-- prompt 1: materialAutoSummary_system
INSERT INTO prompts (name, title, content, variables, version, type, status, node_id) VALUES (
    'materialAutoSummary_system', '材料自动摘要系统提示词',
    E'你是法律材料摘要助手。请阅读下方案件材料正文，输出一段简明摘要。\n\n输出要求：\n- 严格不超过 100 字\n- 保留关键事实、时间、数字、当事人姓名等核心信息\n- 不加"摘要："、"总结："等开场白，也不加结尾总结语\n- 输出纯文本，不使用 Markdown 格式或编号\n- 直接输出摘要正文',
    '[]'::jsonb, 'v1', 'system', 1,
    (SELECT id FROM nodes WHERE name = 'materialAutoSummary')
);

-- prompt 2: contractPartyDetect_system
INSERT INTO prompts (name, title, content, variables, version, type, status, node_id) VALUES (
    'contractPartyDetect_system', '合同甲乙方识别系统提示词',
    E'你是法律合同识别助手。从用户提供的合同前 1500 字中识别甲方、乙方、合同类型，以严格 JSON 格式输出。\n\n字段说明：\n- partyA：合同中甲方的完整名称（公司全称或个人姓名），识别不出填 null\n- partyB：合同中乙方的完整名称，识别不出填 null\n- contractType：合同类型，必须从下方候选清单中选一个，识别不出填 null\n\n候选合同类型：\n{{contractTypeOptions}}\n\n输出要求：\n- 严格 JSON，三个字段都必须存在\n- 无法识别填 null，禁止编造\n- 只输出 JSON，不要任何解释、注释或 Markdown 代码块',
    '["contractTypeOptions"]'::jsonb, 'v1', 'system', 1,
    (SELECT id FROM nodes WHERE name = 'contractPartyDetect')
);

-- prompt 3: analysisSummary_system
INSERT INTO prompts (name, title, content, variables, version, type, status, node_id) VALUES (
    'analysisSummary_system', '案件分析结果摘要系统提示词',
    E'你是法律案件分析摘要助手。请阅读下方某个案件分析模块的完整分析报告，输出一段专业摘要。\n\n输出要求：\n- 字数控制在 200-400 字之间\n- 保留：关键事实、关键结论、关键法律依据\n- 省略：方法论说明、思考过程、过渡性语句\n- 不加"摘要："、"本报告"等开场白，也不加结尾总结语\n- 用中文专业表达，符合法律行业用语\n- 输出纯文本，不使用 Markdown 格式或编号\n- 直接输出摘要正文',
    '[]'::jsonb, 'v1', 'system', 1,
    (SELECT id FROM nodes WHERE name = 'analysisSummary')
);
```

> documentMain 的 3 条 user prompt 在 PR 2 (Task 21) 才创建，**不在本 task 范围**。

- [ ] **Step 2: 应用到 dev 库**

```bash
docker exec -i postgres-postgres-1 psql -U daixin -d ls_new < /tmp/thinking-data.sql
```

预期：3 条节点 INSERT、3 条 prompt INSERT 全部成功。

- [ ] **Step 3: 应用到 testing 库**

```bash
docker exec -i postgres-postgres-1 psql -U daixin -d ls_new_testing < /tmp/thinking-data.sql
```

- [ ] **Step 4: 验证**

```bash
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "SELECT id, name, type, model_id, thinking_enabled FROM nodes WHERE name IN ('materialAutoSummary','contractPartyDetect','analysisSummary');"
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "SELECT id, name, version, status, node_id FROM prompts WHERE name LIKE 'materialAutoSummary%' OR name LIKE 'contractPartyDetect%' OR name LIKE 'analysisSummary%';"
```

预期：3 条节点 + 3 条 prompts 全部 status=1。

- [ ] **Step 5: 删除临时脚本**

```bash
rm /tmp/thinking-data.sql
```

- [ ] **Step 6: 无需 commit（仅数据变更，PR 2 阶段在 seedData.sql 同步）**

继续下一 task。

---

## Task 13：dev/testing 库 DELETE 4 条 status=0 + 87 个 e2e node_groups

**Files:** 直接 SQL 修改

- [ ] **Step 1: 写删除 SQL**

```bash
cat > /tmp/cleanup.sql <<'EOF'
-- 删除 4 条 status=0 旧版本 prompts
DELETE FROM prompts WHERE id IN (6, 14, 15, 20);

-- 清理 e2e 残留 node_groups（保留 id=1/2/3）
DELETE FROM node_groups WHERE id NOT IN (1, 2, 3);
EOF
```

- [ ] **Step 2: 应用到 dev 库**

```bash
docker exec -i postgres-postgres-1 psql -U daixin -d ls_new < /tmp/cleanup.sql
```

预期：DELETE 4（prompts）；DELETE 87+（node_groups）。

- [ ] **Step 3: 应用到 testing 库**

```bash
docker exec -i postgres-postgres-1 psql -U daixin -d ls_new_testing < /tmp/cleanup.sql
```

- [ ] **Step 4: 验证**

```bash
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "SELECT count(*) FROM prompts WHERE status = 0 AND deleted_at IS NULL;"
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "SELECT count(*) FROM node_groups;"
```

预期：第一条 = 0；第二条 = 3。

- [ ] **Step 5: 清理临时文件**

```bash
rm /tmp/cleanup.sql
```

---

## Task 14：seedData.sql 同步 schema 字段 + INSERT/DELETE 数据

**Files:**
- Modify: `prisma/seeds/seedData.sql`

- [ ] **Step 1: 给现有 17 条 models INSERT 末尾追加 supports_thinking 字段**

定位 `INSERT INTO "public"."models"` 行（17 条），在每条 INSERT 的列清单 `output_cost_per_million_tokens` 后追加 `supports_thinking`，VALUES 末尾对应位置加 `false`：

例如：
```sql
INSERT INTO "public"."models" ("id", "provider_id", ..., "output_cost_per_million_tokens", "supports_thinking", "created_at", ...) VALUES (1, 1, ..., NULL, 'f', '2026-01-05 15:18:33+08', ...);
```

- [ ] **Step 2: 给现有 23 条 nodes INSERT 末尾追加 thinking_enabled 字段**

同上模式，列清单加 `thinking_enabled`，VALUES 末尾加 `false`。

- [ ] **Step 3: 删除 4 条 status=0 旧 prompt INSERT**

定位以下行并整行删除：
- `INSERT ... VALUES (6, 'caseMain_system', ...)`
- `INSERT ... VALUES (14, 'caseMain_system', ...)`
- `INSERT ... VALUES (15, 'caseMain_system', ...)`
- `INSERT ... VALUES (20, 'documentMain_system', ...)`

- [ ] **Step 4: 删除 87 个 e2e 残留 node_groups INSERT**

定位 `INSERT INTO "public"."node_groups"` 部分，仅保留 id=1/2/3 三行，其余全删。

- [ ] **Step 5: 在 seedData 末尾追加 3 个新节点 + 3 条新 prompts INSERT**

按 Task 12 的 SQL 内容，把 INSERT 写成 seedData 风格（含 id 字段）。具体 id 用 24/25/26（节点）和 42/43/44（prompts，因为现有最大 prompt id 是 41）：

```sql
INSERT INTO "public"."nodes" ("id", "name", "title", "description", "type", "priority", "model_id", "tools", "output_schema", "group_id", "status", "thinking_enabled", "use_skills_as_logic", "created_at", "updated_at", "deleted_at") VALUES (24, 'materialAutoSummary', '材料自动摘要', '材料 OCR/ASR/文本就绪后异步生成 100 字内摘要，写入 caseMaterials.summary 用于卡片展示', 'extraction', 110, 1, '[]', NULL, NULL, 1, 'f', 'f', '2026-04-29 10:00:00+08', '2026-04-29 10:00:00+08', NULL);
-- 同样 25 contractPartyDetect / 26 analysisSummary（output_schema 用 §7.1 完整 JSON）
```

prompts 同样追加 3 行 INSERT（id=42/43/44）。

- [ ] **Step 6: 验证 seedData 仍可加载**

```bash
docker exec postgres-postgres-1 psql -U daixin -d postgres -c 'CREATE DATABASE ls_seed_test;'
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_seed_test?schema=public&TimeZone=UTC' bun run prisma:deploy
docker exec -i postgres-postgres-1 psql -U daixin -d ls_seed_test < prisma/seeds/seedData.sql
docker exec postgres-postgres-1 psql -U daixin -d ls_seed_test -c "SELECT count(*) FROM nodes; SELECT count(*) FROM prompts; SELECT count(*) FROM node_groups;"
docker exec postgres-postgres-1 psql -U daixin -d postgres -c 'DROP DATABASE ls_seed_test;'
```

预期：26 nodes / 27 prompts (24 旧 status=1 + 3 新) / 3 node_groups。

- [ ] **Step 7: Commit**

```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(seed): 同步 thinking 字段 + 新增 3 节点/3 prompts + 清理冗余"
```

---

## Task 15：material.service.ts 改造 → materialAutoSummary 节点

**Files:**
- Modify: `server/services/material/material.service.ts`

- [ ] **Step 1: 修改 generateMaterialSummaryService 函数**

> 设计说明：纯文本摘要场景**不走 invokeNodeJson**（其内部强依赖 JSON.parse），而是 `getValidNodeConfig + createChatModel + generateSummaryService` 三步——`generateSummaryService` 已有 maxChars 切片处理，复用合理。

定位 `material.service.ts:484-510`（`generateMaterialSummaryService`），整段替换为：

```ts
import { getValidNodeConfig } from '../node/node.service'
import { createChatModel } from '../node/chatModelFactory'
import { generateSummaryService } from '../ai/summaryService'

export async function generateMaterialSummaryService(materialId: number): Promise<void> {
    try {
        const material = await prisma.caseMaterials.findUnique({
            where: { id: materialId },
            select: { id: true, summary: true, ossFileId: true, type: true },
        })
        if (!material || material.summary) return

        const content = await loadMaterialText(materialId, 500)
        if (!content) return

        const config = await getValidNodeConfig('materialAutoSummary', '材料自动摘要')
        const apiKey = config.modelApiKeys.find(k => k.status === 1)?.apiKey
        if (!apiKey) {
            logger.warn('materialAutoSummary 节点无可用 API Key', { materialId })
            return
        }
        const systemPrompt = config.prompts.find(p => p.type === 'system' && p.status === 1)?.content
        if (!systemPrompt) {
            logger.warn('materialAutoSummary 节点无 system prompt', { materialId })
            return
        }

        const model = createChatModel({
            sdkType: config.modelSdkType,
            modelName: config.modelName,
            apiKey,
            baseUrl: config.modelProviderBaseUrl,
            temperature: 0,
            streaming: false,
        })
        const summary = await generateSummaryService(model, content, { maxChars: 100, systemPrompt })

        await prisma.caseMaterials.update({
            where: { id: materialId },
            data: { summary },
        })
    } catch (e) {
        logger.warn('generateMaterialSummaryService 失败（不阻塞主流程）', { materialId, error: e })
    }
}
```

- [ ] **Step 2: 删 import 中不再使用的 createChatModel / generateSummaryService**

检查 material.service.ts 顶部 import，如果 createChatModel / generateSummaryService 不再使用，移除。

- [ ] **Step 3: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: 跑相关测试**

```bash
npx vitest run tests/server -t 'generateMaterialSummary' --reporter=verbose
```

- [ ] **Step 5: 手工冒烟（dev server）**

```bash
bun dev
```

上传一份材料，等 OCR 完成后看 caseMaterials.summary 字段是否生成 100 字内摘要。

- [ ] **Step 6: Commit**

```bash
git add server/services/material/material.service.ts
git commit -m "refactor(material): 100 字摘要走 materialAutoSummary 节点替代硬编 Anthropic"
```

---

## Task 16：partyDetector.ts 改造 → contractPartyDetect 节点

**Files:**
- Modify: `server/agents/contract/docx/partyDetector.ts`

- [ ] **Step 1: 替换 detectParties 函数**

整段替换 `detectParties` 函数（line 53-95），改为：

```ts
import { invokeNodeJson } from '~~/server/services/agent-platform/tools/invokeNodeJson'
import { CONTRACT_TYPE_OPTIONS } from '#shared/types/contract'
import { z } from 'zod'

const llmResultSchema = z.object({
    partyA: z.string().nullable(),
    partyB: z.string().nullable(),
    contractType: z.string().nullable(),
})

export async function detectParties(paragraphs: string[]): Promise<PartyDetectionResult> {
    const fullText = paragraphs.join('\n')

    const matchA = pickValidCandidate(fullText, PARTY_A_PATTERN)
    const matchB = pickValidCandidate(fullText, PARTY_B_PATTERN)
    if (matchA && matchB) {
        return { partyA: matchA, partyB: matchB, contractType: null, source: 'regex' }
    }

    try {
        const preview = fullText.slice(0, 1500)
        const result = await invokeNodeJson({
            nodeName: 'contractPartyDetect',
            temperature: 0,
            schema: llmResultSchema,
            buildPrompt: (template) => {
                const rendered = template.replace('{{contractTypeOptions}}', CONTRACT_TYPE_OPTIONS.map(t => `- ${t}`).join('\n'))
                return `${rendered}\n\n合同内容：\n${preview}`
            },
            errorPrefix: 'contractPartyDetect',
        })
        return {
            partyA: result.partyA ?? null,
            partyB: result.partyB ?? null,
            contractType: result.contractType ?? null,
            source: 'llm',
        }
    } catch (_err) {
        return { partyA: null, partyB: null, contractType: null, source: 'none' }
    }
}
```

- [ ] **Step 2: 删除常量 LLM_PROMPT 和不再使用的 import**

删 `LLM_PROMPT` 常量（line 41-51）；删除 `import { createChatModel } from ...`、`import { getValidNodeConfig }` 等不再使用的 import。

- [ ] **Step 3: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: 跑相关测试**

```bash
npx vitest run tests/server -t 'partyDetector\|detectParties' --reporter=verbose
```

- [ ] **Step 5: 手工冒烟**

上传一份合同（带"甲方："和"乙方："关键字），看自动填的甲方/乙方/合同类型字段是否仍正确。

- [ ] **Step 6: Commit**

```bash
git add server/agents/contract/docx/partyDetector.ts
git commit -m "refactor(contract): 甲乙方识别走 contractPartyDetect 独立节点"
```

---

## Task 17：initAnalysis.service.ts 改造 → analysisSummary 节点

**Files:**
- Modify: `server/services/case/initAnalysis.service.ts`

- [ ] **Step 1: 修改 completeAnalysisWithRAG 中的 summary 调用**

> 设计说明：同 Task 15，纯文本摘要走 `getValidNodeConfig + createChatModel + generateSummaryService`，不用 invokeNodeJson。模型从 analysisSummary 节点取，不再用调用方传入的 `model` 参数。

定位 `initAnalysis.service.ts:343-346`，把现有 `generateSummaryService(model, analysisResult, ...)` 调用改为：

```ts
    let summary = ''
    try {
        const summaryConfig = await getValidNodeConfig('analysisSummary', '案件分析结果摘要')
        const apiKey = summaryConfig.modelApiKeys.find(k => k.status === 1)?.apiKey
        const systemPrompt = summaryConfig.prompts.find(p => p.type === 'system' && p.status === 1)?.content
        if (apiKey && systemPrompt) {
            const summaryModel = createChatModel({
                sdkType: summaryConfig.modelSdkType,
                modelName: summaryConfig.modelName,
                apiKey,
                baseUrl: summaryConfig.modelProviderBaseUrl,
                temperature: 0,
                streaming: false,
            })
            summary = await generateSummaryService(summaryModel, analysisResult, { maxChars: 400, systemPrompt })
        } else {
            logger.warn('analysisSummary 节点未配置完整，跳过摘要生成', { analysisId })
        }
    } catch (err) {
        logger.warn('analysisSummary 调用失败（不阻塞主流程）', { analysisId, err })
    }
```

- [ ] **Step 2: import 调整**

```ts
import { getValidNodeConfig } from '../node/node.service'
import { createChatModel } from '../node/chatModelFactory'
// generateSummaryService 已 import，保留
```

注意：`completeAnalysisWithRAG` 的 `model` 入参变成 dead arg（不再使用）。本 task 保留参数签名（避免连带改 saveAnalysisResult.tool 等调用方），后续清理。

- [ ] **Step 3: typecheck + 测试**

```bash
bun run typecheck
npx vitest run tests/server -t 'completeAnalysisWithRAG' --reporter=verbose
```

- [ ] **Step 4: 手工冒烟**

跑一个案件分析模块（如"案件概要"），完成后查 caseAnalyses.summary 是否生成 200-400 字摘要。

- [ ] **Step 5: Commit**

```bash
git add server/services/case/initAnalysis.service.ts
git commit -m "refactor(case): 分析摘要走 analysisSummary 节点"
```

---

## Task 18：consolidator.service.ts 改造 → 复用 caseMemoryExtract

**Files:**
- Modify: `server/services/memory/consolidator.service.ts`

- [ ] **Step 1: 替换 extractMemoriesFromMessages 实现**

定位 `consolidator.service.ts:115-131`，整段替换为：

```ts
import { runMemoryExtractionService } from './memoryExtraction.service'
import type { BaseMessage } from '@langchain/core/messages'

async function extractAndPersist(caseId: number, sessionId: string, messages: Array<{ role: string; content: string }>): Promise<void> {
    // 复用 memoryExtraction 主路径（已用 caseMemoryExtract 节点 + invokeNodeJson）
    await runMemoryExtractionService({ caseId, sessionId, messages: messages as any })
}
```

- [ ] **Step 2: 修改 consolidateSession**

把原 `consolidateSession` 里 `await extractMemoriesFromMessages(messages)` 和 `await persistExtracted(session.caseId, extracted)` 两步合并：

```ts
export async function consolidateSession(sessionId: string): Promise<void> {
    try {
        const session = await prisma.caseSessions.findUnique({
            where: { sessionId },
            select: { caseId: true },
        })
        if (!session?.caseId) return
        const messages = await loadRecentAgentMessages(sessionId, 20)
        if (messages.length === 0) return
        await extractAndPersist(session.caseId, sessionId, messages)
    } catch (e) {
        logger.warn('consolidator run 失败（best-effort，下轮自动重试）', { sessionId, error: e })
    }
}
```

- [ ] **Step 3: 删除不再使用的代码**

删除：
- `extractionSchema` zod 类型（line 64-76）—— 已在 memoryExtraction 内部
- `extractMemoriesFromMessages` 函数（line 115-131）
- `persistExtracted` 函数（line 133-169）—— memoryExtraction 自己 writeMemoryService
- `buildExtractPrompt` 函数（line 193-230）—— 80 行硬编 prompt
- import：`createChatModel` / `getValidNodeConfig` / `writeMemoryService`（如不再用）

- [ ] **Step 4: typecheck + 测试**

```bash
bun run typecheck
npx vitest run tests/server -t 'consolidator' --reporter=verbose
```

- [ ] **Step 5: 手工冒烟**

进入案件对话，等 30s debounce 后 cron 触发 → 看 caseMemories 表是否新增条目，且 source='auto_extract'（memoryExtraction 标记）。

- [ ] **Step 6: Commit**

```bash
git add server/services/memory/consolidator.service.ts
git commit -m "refactor(memory): 冷路径复用 caseMemoryExtract 节点 + memoryExtraction 主路径"
```

---

## Task 19：删除 dead code CASE_COURT_FIELDS_PROMPT_APPENDIX

**Files:**
- Modify: `server/services/case/caseExtraction.service.ts`

- [ ] **Step 1: grep 确认无引用**

```bash
rg -n 'CASE_COURT_FIELDS_PROMPT_APPENDIX' /Users/daixin/work/dev/LexSeek/LexSeek/
```

预期：仅 caseExtraction.service.ts 自身定义行有匹配，无其他引用。

- [ ] **Step 2: 删除常量定义**

删除 `caseExtraction.service.ts:46-52` 整段（`CASE_COURT_FIELDS_PROMPT_APPENDIX` 定义）。

- [ ] **Step 3: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add server/services/case/caseExtraction.service.ts
git commit -m "chore(case): 删除 dead code CASE_COURT_FIELDS_PROMPT_APPENDIX"
```

---

## Task 20：PR 1 全量验证 + 推送

**Files:** 无文件改动

- [ ] **Step 1: 全量 typecheck**

```bash
bun run typecheck
```

预期：通过。

- [ ] **Step 2: 跑相关测试子集（避免全量耗时）**

```bash
bun run test:server
```

预期：全部通过。

- [ ] **Step 3: 手工 dev 冒烟（关键路径）**

启动 dev server `bun dev`，依次验证：
1. 后台 admin/models：选某 chat 模型勾上 supports_thinking → 保存 → 重开看仍勾上
2. 后台 admin/nodes：选该模型 → 出现 thinking_enabled 开关
3. 前端 `/dashboard/cases` 创建一个案件 → 上传材料 → 等 OCR 完成 → 材料卡片显示 100 字摘要
4. 上传一份合同 → 看自动填的甲方/乙方/合同类型
5. 进案件分析跑一个模块 → 完成后看分析卡片有 200-400 字摘要
6. 案件对话发几条 → 等 30s+ → 看 case_memories 表新增

- [ ] **Step 4: 推送 PR 1**

```bash
git push -u origin dev
```

提示：等用户审 PR 后合入主干。

---

# Phase 2 — PR 2: 提示词重构（行为变化大）

## Task 21：dev/testing/seedData INSERT 3 条 documentMain user prompt + UPDATE search_intent_router v2

**Files:**
- Modify: `prisma/seeds/seedData.sql`
- 直接 SQL 修改 dev/testing 库

- [ ] **Step 1: 写 SQL**

```bash
cat > /tmp/pr2-prompts.sql <<'EOF'
-- 新增 3 条 documentMain user prompt
INSERT INTO prompts (name, title, content, variables, version, type, status, node_id) VALUES (
    'documentMain_user_with_files', '文书生成-有文件分支',
    E'请为《{{templateName}}》按字段 schema 生成文书内容。\n\n新增材料 fileIds: {{fileIds}}，请先调用 process_materials(fileIds={{fileIds}}) 处理这些文件，再用 search_case_materials 检索内容回填字段。\n\n{{userExtraText}}\n\n收集到足够信息后，必须通过结构化输出工具返回 values + suggestions，严禁在消息正文自行写 JSON 或代码块；未知字段返回 null，不要编造。',
    '["templateName","fileIds","userExtraText"]'::jsonb, 'v1', 'user', 1,
    (SELECT id FROM nodes WHERE name = 'documentMain')
);

INSERT INTO prompts (name, title, content, variables, version, type, status, node_id) VALUES (
    'documentMain_user_with_case', '文书生成-关联案件分支',
    E'请为《{{templateName}}》按字段 schema 生成文书内容。\n\n本草稿关联案件已完成初分分析（system prompt 中 caseProfile + moduleSummaries 段已附 200-400 字摘要）。请按以下顺序填充模板字段：\n\n1) 优先调用 search_case_analysis(analysisType=...) 获取已分析模块的全文（事实/请求/案由/抗辩/证据等），用其中的精确数据填字段；\n2) 若已分析模块不足以覆盖某些字段，再调 search_case_materials 从原始材料补充；\n3) 严禁向用户重复索要案件已经记录过的信息（当事人、事实、请求等都能从已有分析或案件档案里拿到）。\n\n{{userExtraText}}\n\n收集到足够信息后，必须通过结构化输出工具返回 values + suggestions，严禁在消息正文自行写 JSON 或代码块；未知字段返回 null，不要编造。',
    '["templateName","userExtraText"]'::jsonb, 'v1', 'user', 1,
    (SELECT id FROM nodes WHERE name = 'documentMain')
);

INSERT INTO prompts (name, title, content, variables, version, type, status, node_id) VALUES (
    'documentMain_user_standalone', '文书生成-独立草稿分支',
    E'请为《{{templateName}}》按字段 schema 生成文书内容。\n\n请先调用 search_case_materials 查询本草稿已就绪的材料；若确无任何材料，再向用户询问需要补充的具体内容。\n\n{{userExtraText}}\n\n收集到足够信息后，必须通过结构化输出工具返回 values + suggestions，严禁在消息正文自行写 JSON 或代码块；未知字段返回 null，不要编造。',
    '["templateName","userExtraText"]'::jsonb, 'v1', 'user', 1,
    (SELECT id FROM nodes WHERE name = 'documentMain')
);

-- search_intent_router 升级 v2 (创建新版本，老 v1 status 改 0)
UPDATE prompts SET status = 0 WHERE name = 'search_intent_router_system' AND version = 'v1';

INSERT INTO prompts (name, title, content, variables, version, type, status, node_id) VALUES (
    'search_intent_router_system', '检索意图路由-系统提示词 v2',
    E'你是法律检索意图分类器。根据用户的查询，判断最佳检索策略，以 JSON 格式输出结果。\n\n## 判断优先级（按顺序判断，命中即停）\n\n1. exact（精确查找）— 查询中包含"法律名称 + 条文编号"\n   条文编号支持中文和阿拉伯数字（第264条 = 第二百六十四条）\n   示例："民法典第1000条"、"刑法第264条"、"劳动合同法第46条第2款"、"民法典第一千零七十九条"\n   → 提取 legalName + articleRef（articleRef 统一转为中文数字格式）\n\n2. hybrid（混合检索）— 以专业视角提问，包含专业法律术语或法律名称，但没有条文编号\n   不要求必须出现法律名称，只要查询整体是专业化表达即可\n   专业法律术语举例：格式条款、诉讼时效、违约金、不当得利、善意取得、行政复议、正当防卫、缓刑、数罪并罚\n   示例（含法律名称）："劳动合同法关于经济补偿的规定"、"公司法股东权益保护"、"民法典侵权责任编归责原则"\n   示例（不含法律名称，但有专业术语）："合同解除的法定条件"、"违约金调整规则"、"格式条款的效力"、"正当防卫的构成要件"、"诉讼时效中断的情形"、"行政复议申请条件"\n   → 提取 keywords + rewrittenQuery（如有法律名称也提取 legalName）\n\n3. semantic（语义检索）— 以普通人视角用口语化方式描述法律问题\n   即使提到了"继承"、"犯罪"、"股东"等日常化的法律概念词，只要整体是口语化表达就属于 semantic\n   示例："员工被公司无故辞退后能获得什么赔偿"、"租的房子到期房东不退押金怎么办"、"网上买的东西质量有问题可以退货吗"、"未成年人犯罪会被判刑吗"、"遗产继承的顺序是什么"、"公司股东之间发生矛盾怎么解决"\n   → 提取 keywords + rewrittenQuery\n\n{{typeHint}}',
    '["typeHint"]'::jsonb, 'v2', 'system', 1,
    (SELECT id FROM nodes WHERE name = 'search_intent_router')
);
EOF

docker exec -i postgres-postgres-1 psql -U daixin -d ls_new < /tmp/pr2-prompts.sql
docker exec -i postgres-postgres-1 psql -U daixin -d ls_new_testing < /tmp/pr2-prompts.sql
rm /tmp/pr2-prompts.sql
```

- [ ] **Step 2: seedData.sql 同步**

在 seedData.sql 末尾追加这 4 条 INSERT（用户在 PR 2 上线前手工同步生产）；同时把 search_intent_router_system v1 的 status 由 1 改为 0（删除 v1 INSERT 语句中的 `1` 改 `0`），保留新增的 v2 INSERT（status=1）。

- [ ] **Step 3: 验证**

```bash
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "SELECT id, name, version, status FROM prompts WHERE name LIKE 'documentMain_user%' OR name = 'search_intent_router_system' ORDER BY id;"
```

预期：3 条 documentMain user prompt + search_intent_router_system v1 (status=0) + v2 (status=1)。

- [ ] **Step 4: Commit seedData.sql**

```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(seed): documentMain 新增 3 条 user prompt + search_intent_router v2 加 typeHint"
```

---

## Task 22：PromptRenderContext 扩展 fileIds + userExtraText

**Files:**
- Modify: `server/services/agent-platform/nodeConfig/promptRenderer.ts`

- [ ] **Step 1: 扩展 PromptRenderContext 接口**

定位 `PromptRenderContext` 接口（line 13），追加：

```ts
    /** 文书生成 fileIds（如 [1,2,3] 字符串形式） */
    fileIds?: string
    /** 用户补充说明文本 */
    userExtraText?: string
```

`renderSystemPrompt` 函数内的 variables 收集逻辑追加：

```ts
    if (context.fileIds) variables.fileIds = context.fileIds
    if (context.userExtraText) variables.userExtraText = context.userExtraText
```

- [ ] **Step 2: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add server/services/agent-platform/nodeConfig/promptRenderer.ts
git commit -m "feat(agent-platform): PromptRenderContext 加 fileIds/userExtraText"
```

---

## Task 23：documentMainAgent.ts 改造 buildInitialPromptFromDraft

**Files:**
- Modify: `server/services/workflow/agents/documentMainAgent.ts`

- [ ] **Step 1: 替换 buildInitialPromptFromDraft 函数**

整段替换 `documentMainAgent.ts:47-82`，改为按 draft 状态选 user prompt name：

```ts
function pickInitialPromptName(draft: { sourceRef: unknown; caseId: number | null }): string {
    const sourceRef = (draft.sourceRef as Record<string, unknown> | null) ?? {}
    const fileIds = Array.isArray(sourceRef.fileIds)
        ? (sourceRef.fileIds as unknown[]).map(x => Number(x)).filter(n => Number.isInteger(n) && n > 0)
        : []
    if (fileIds.length > 0) return 'documentMain_user_with_files'
    if (draft.caseId != null) return 'documentMain_user_with_case'
    return 'documentMain_user_standalone'
}

function buildInitialPromptFromDraft(
    draft: { sourceRef: unknown; caseId: number | null },
    templateName: string,
    nodeConfig: NodeConfig,
): string {
    const sourceRef = (draft.sourceRef as Record<string, unknown> | null) ?? {}
    const fileIds = Array.isArray(sourceRef.fileIds)
        ? (sourceRef.fileIds as unknown[]).map(x => Number(x)).filter(n => Number.isInteger(n) && n > 0)
        : []
    const userExtraText = typeof sourceRef.text === 'string' && sourceRef.text.trim()
        ? `用户补充说明：\n${sourceRef.text.trim()}`
        : ''

    const promptName = pickInitialPromptName(draft)
    const template = nodeConfig.prompts.find(p => p.name === promptName && p.type === 'user' && p.status === 1)?.content
    if (!template) {
        throw new Error(`documentMain 节点缺少 ${promptName} prompt 配置`)
    }

    return renderContent(template, {
        templateName,
        fileIds: JSON.stringify(fileIds),
        userExtraText,
    })
}
```

- [ ] **Step 2: import renderContent + NodeConfig 类型**

```ts
import { renderContent } from '~~/server/services/node/prompt.service'
import type { NodeConfig } from '~~/server/services/node/node.service'
```

- [ ] **Step 3: 修改调用方传入 nodeConfig**

定位 `documentMainAgent.ts:286` 附近调用 `buildInitialPromptFromDraft(draft, template.name)`，加第三个参数 `nodeConfig`：

```ts
        const startMessage = message ?? buildInitialPromptFromDraft(draft, template.name, nodeConfig)
```

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```

- [ ] **Step 5: 手工冒烟（dev server）**

跑文书生成 3 个分支：
1. 从案件入口起草（有 caseId）→ 走 with_case 分支
2. 独立草稿不带文件 → 走 standalone 分支
3. 独立草稿带 fileIds → 走 with_files 分支

- [ ] **Step 6: Commit**

```bash
git add server/services/workflow/agents/documentMainAgent.ts
git commit -m "refactor(document): 文书生成首轮指令读 nodeConfig.prompts 替代硬编"
```

---

## Task 24：intentClassifier.service.ts 改造 删 DEFAULT_SYSTEM_PROMPT + typeHint 改占位符

**Files:**
- Modify: `server/services/retrieval/intentClassifier.service.ts`

- [ ] **Step 1: 删除 DEFAULT_SYSTEM_PROMPT 常量**

删除 `intentClassifier.service.ts:56-75` 的 `DEFAULT_SYSTEM_PROMPT` 常量定义（75 行）。

- [ ] **Step 2: 修改 LLM 调用段**

定位 `intentClassifier.service.ts:158-170`，把：

```ts
const systemPromptContent =
    config.prompts.find((p) => p.type === 'system')?.content
    ?? DEFAULT_SYSTEM_PROMPT

// ...
const typeHint = (type === 'case_material' || type === 'case_analysis')
    ? '\n\n注意：这是案件材料/分析检索，不存在精确通道。只能分类为 hybrid 或 semantic。'
    : ''

const messages = [
    new SystemMessage(systemPromptContent + typeHint),
    new HumanMessage(query),
]
```

改为：

```ts
const systemTemplate = config.prompts.find(
    p => p.type === 'system' && p.status === 1,
)?.content
if (!systemTemplate) {
    logger.warn('search_intent_router 节点缺少 system prompt（v2），降级为 semantic', { type })
    return { intent: 'semantic', rewrittenQuery: query }
}

const typeHint = (type === 'case_material' || type === 'case_analysis')
    ? '\n\n注意：这是案件材料/分析检索，不存在精确通道。只能分类为 hybrid 或 semantic。'
    : ''
const systemPromptContent = renderContent(systemTemplate, { typeHint })

const messages = [
    new SystemMessage(systemPromptContent),
    new HumanMessage(query),
]
```

import `renderContent`：

```ts
import { renderContent } from '../node/prompt.service'
```

- [ ] **Step 3: typecheck + 测试**

```bash
bun run typecheck
npx vitest run tests/server -t 'intentClassifier' --reporter=verbose
```

- [ ] **Step 4: 手工冒烟**

打开 `/dashboard/legal/search`，输入：
- "民法典第1000条" → 应走 exact
- "合同解除的法定条件" → 应走 hybrid
- "员工被辞退能拿多少赔偿" → 应走 semantic

进 case_material 检索，输入条文号 → 应被强制改为 hybrid。

- [ ] **Step 5: Commit**

```bash
git add server/services/retrieval/intentClassifier.service.ts
git commit -m "refactor(retrieval): 意图分类删硬编兜底，typeHint 改 DB 占位符变量"
```

---

## Task 25：extract.post.ts 改造 删 SUMMARY_PROMPT_TEMPLATE → material_summarizer 节点

**Files:**
- Modify: `server/api/v1/case/extract.post.ts`

- [ ] **Step 1: 删除 SUMMARY_PROMPT_TEMPLATE 常量**

删除 `extract.post.ts:33-38` 的 `SUMMARY_PROMPT_TEMPLATE` 常量。

- [ ] **Step 2: 改写 generateFileSummary**

定位 `extract.post.ts:222-238`：

```ts
async function generateFileSummary(model: any, file: FileProcessContext): Promise<string> {
    const truncated = file.content!.length > MAX_CONTENT_CHARS_FOR_SUMMARY
        ? file.content!.slice(0, MAX_CONTENT_CHARS_FOR_SUMMARY) + '\n\n[内容过长已截断]'
        : file.content!
    const result = await model.invoke([
        new HumanMessage(
            SUMMARY_PROMPT_TEMPLATE
                .replace('{name}', file.name)
                .replace('{content}', truncated),
        ),
    ])
    // ...
}
```

改为（用 material_summarizer 节点 + createChatModel + generateSummaryService）：

```ts
async function generateFileSummary(file: FileProcessContext): Promise<string> {
    const truncated = file.content!.length > MAX_CONTENT_CHARS_FOR_SUMMARY
        ? file.content!.slice(0, MAX_CONTENT_CHARS_FOR_SUMMARY) + '\n\n[内容过长已截断]'
        : file.content!
    try {
        const config = await getValidNodeConfig('material_summarizer', '材料摘要')
        const apiKey = config.modelApiKeys.find(k => k.status === 1)?.apiKey
        const systemPrompt = config.prompts.find(p => p.type === 'system' && p.status === 1)?.content
        if (!apiKey || !systemPrompt) {
            return `[摘要生成失败：material_summarizer 节点未配置]`
        }
        const summaryModel = createChatModel({
            sdkType: config.modelSdkType,
            modelName: config.modelName,
            apiKey,
            baseUrl: config.modelProviderBaseUrl,
            temperature: 0,
            streaming: false,
        })
        const summary = await generateSummaryService(
            summaryModel,
            `材料名称：${file.name}\n\n材料内容：\n${truncated}`,
            { maxChars: 500, systemPrompt },
        )
        return `【${file.name}摘要】\n${summary.trim()}`
    } catch (err) {
        logger.warn('材料摘要生成失败', { name: file.name, error: err })
        return `[摘要生成失败，原文预览: ${truncated.slice(0, 200)}...]`
    }
}
```

- [ ] **Step 3: 修改 summarizeAndExtract 调用**

定位 `extract.post.ts:202-205`，把 `generateFileSummary(model, file)` 改为 `generateFileSummary(file)`（不再传 model）。

- [ ] **Step 4: import 调整**

```ts
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { generateSummaryService } from '~~/server/services/ai/summaryService'
// createChatModel 已在文件顶部 import，保留
```

- [ ] **Step 5: typecheck + 测试**

```bash
bun run typecheck
npx vitest run tests/server -t 'extract' --reporter=verbose
```

- [ ] **Step 6: 手工冒烟**

上传一份超长材料（> 32K tokens 触发分批模式），看摘要是否仍正常生成。

- [ ] **Step 7: Commit**

```bash
git add server/api/v1/case/extract.post.ts
git commit -m "refactor(extract): 分批摘要复用 material_summarizer 节点"
```

---

## Task 26：PR 2 全量验证 + 推送

- [ ] **Step 1: 全量 typecheck + 单测**

```bash
bun run typecheck
bun run test:server
```

- [ ] **Step 2: 手工冒烟（关键路径）**

1. 文书生成 3 种场景（关联案件 / 独立草稿 / 带文件上传）
2. 法规检索 4 种类型（law / case_material / case_memory / case_analysis）
3. 超长材料触发分批摘要

- [ ] **Step 3: 推送 PR 2**

```bash
git push origin dev
```

提示：等用户审 PR 后合入主干。

---

# 验证总览（验收标准）

实施完成后，以下全部满足才算 done：

- ✅ `bun run typecheck` 全绿
- ✅ `bun run test:server` 全绿
- ✅ 后台 admin/models：modelType=chat 时显示 supports_thinking 复选框；非 chat 隐藏
- ✅ 后台 admin/nodes：选 supports_thinking=true 的模型时显示 thinking_enabled 开关；切换模型自动重置
- ✅ 默认状态（所有模型 supports_thinking=false / 所有节点 thinking_enabled=false）→ thinking 决议结果与改造前完全一致
- ✅ DB 中 prompts 表只有 status=1 的最终版本（4 条 status=0 已删 + search_intent_router v1 已置 0）
- ✅ DB 中 node_groups 仅 id=1/2/3
- ✅ seedData.sql 与 dev/testing 库一致
- ✅ 4 处硬编改造完成（material 100 字摘要 / 合同甲乙方 / 分析摘要 / 记忆冷路径）
- ✅ documentMain 启动指令读 DB / 法规检索 typeHint 占位符
- ✅ dead code `CASE_COURT_FIELDS_PROMPT_APPENDIX` 已删
