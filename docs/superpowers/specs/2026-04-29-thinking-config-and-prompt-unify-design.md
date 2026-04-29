# 思考模式配置 + 节点/提示词统一纳管 — 设计文档

> 日期：2026-04-29
> 状态：待审核 → 待出 implementation plan
> 受影响：DB schema / agent-platform / 后台 admin UI / 多个业务调用点

## 1. 背景与目标

### 1.1 背景

LexSeek 已有「节点管理」（`nodes` + `prompts` 表）作为 AI 业务点的统一登记 + 配置入口，运营在后台改提示词、切模型不需要发版。但实际盘点发现：

- **少数高用户感知的 AI 调用点完全绕过节点管理**：例如材料 100 字摘要硬编 Anthropic Haiku + `process.env.ANTHROPIC_API_KEY`
- **部分调用点借用其它节点的模型而提示词独立硬编**：例如合同甲乙方识别借用 `contractReviewMain` 模型，提示词写在代码常量
- **法规检索意图分类有代码兜底 prompt（75 行）**，DB 配置失误时静默生效，运营无法察觉
- **案件记忆抽取冷路径**借用 `search_intent_router` 节点 + 硬编 80 行 prompt
- **思考模式（thinking）**目前仅由前端 `AiPromptInput` 开关控制；运营无法在节点层为「无前端开关的场景」（OCR、合同审查、文书等）配默认思考策略
- **思考能力**只在 anthropic / gemini SDK 实现，DeepSeek SDK + OpenAI SDK 兼容协议（豆包、阿里通义、DeepSeek 官方）的厂商差异未对接

### 1.2 目标

1. **新增 `models.supports_thinking` + `nodes.thinking_enabled` 两个字段**，把思考模式从「仅前端临时开关」升级为「模型层硬门禁 + 节点层默认值 + 前端临时开关」三方决议
2. **chatModelFactory 实现各厂商思考协议兼容**（Anthropic / Gemini / DeepSeek SDK / OpenAI SDK 兼容端点 4 路分发）
3. **新建 3 个节点替代 3 处硬编调用**（`materialAutoSummary` / `contractPartyDetect` / `analysisSummary`）
4. **统一案件记忆抽取冷路径走 `caseMemoryExtract` 节点**，删 80 行硬编 prompt
5. **删除法规检索意图分类的 75 行兜底 prompt**，DB 没配时通过最外层 catch 降级 semantic（已有兜底链路）
6. **`documentMain` 节点新增 3 条 user prompt** 替代 `buildInitialPromptFromDraft` 硬编业务编排
7. **顺便清理**：4 条 status=0 旧版 prompt + 87 个 e2e 测试遗留 node_groups + 1 段 dead code

## 2. 数据库 schema 改动

### 2.1 字段新增

`prisma/models/model.prisma` — `models` 表：

```prisma
/// 模型是否支持思考切换（true = 节点可配 thinkingEnabled，UI 才显示开关）
supportsThinking  Boolean  @default(false) @map("supports_thinking")
```

`prisma/models/node.prisma` — `nodes` 表：

```prisma
/// 节点是否启用思考模式（仅当关联模型 supportsThinking=true 时生效）
thinkingEnabled  Boolean  @default(false) @map("thinking_enabled")
```

### 2.2 迁移机制

- **schema 变更**：走 `bun run prisma:migrate --name add_thinking_fields`，自动生成 migration.sql 仅含 `ALTER TABLE` 加列
- **数据变更（新增节点 / prompts、删旧 prompts、更新 search_intent_router、清理测试遗留 group_id）**：**不进 migration.sql**
- **dev / testing 库**：由实施者用 SQL 直接改（INSERT/DELETE/UPDATE）
- **生产**：用户对照 seedData.sql 的最终态手工同步
- **seedData.sql 是最终事实快照**，开发者重置 dev 库时跟得上

### 2.3 默认值

- 17 个现有 models 全部 `supports_thinking = false`（默认值生效）
- 23 个现有 nodes 全部 `thinking_enabled = false`（默认值生效）

## 3. 思考模式三方决议规则

### 3.1 决议链路

```
前端 AiPromptInput (default true) → API body → ctx.thinking
                                                     │
                                                     ▼
nodeConfig (DB)                          resolveThinking(...)──▶ chatModelFactory
├ thinkingEnabled                                    │
└ modelSupportsThinking                              │
                                                     ▼
                                           applyThinkingParams(sdkType, modelName, baseUrl, thinking)
                                                     │
                                                     ├─ anthropic SDK：原生 thinking 字段
                                                     ├─ gemini SDK：原生 thinkingConfig 字段
                                                     ├─ deepseek SDK：modelKwargs 透传
                                                     └─ openai SDK：按 baseUrl host 嗅探厂商协议
```

### 3.2 resolveThinking 实现

新文件 `server/services/node/thinkingResolver.ts`：

```ts
/**
 * 决议某次 LLM 调用最终是否启用思考模式。
 *
 * 优先级：
 * 1. 模型层硬门禁：modelSupportsThinking=false → 强制 false
 * 2. 前端用户显式：ctxThinking !== undefined → 用 ctxThinking
 * 3. 节点配置默认：fallback nodeThinkingEnabled
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
```

### 3.3 决议表

| supports_thinking | ctx.thinking | thinking_enabled | 最终结果 |
|---|---|---|---|
| false | * | * | **false（硬门禁）** |
| true | true | * | **true** |
| true | false | * | **false** |
| true | undefined | true | **true** |
| true | undefined | false | **false** |

## 4. chatModelFactory 协议分发

### 4.1 设计原则

- 数据库只保留一个字段 `models.supports_thinking`
- 协议差异完全下沉到 `chatModelFactory`，按 `sdkType` 分四档；其中 `sdkType=openai` 内部按 `baseUrl host` 嗅探具体厂商
- 调用方 (`runtime.ts` 等) 只传一个 `thinking: boolean` 给 chatModelFactory，无需关心协议细节

### 4.2 厂商协议汇总

| 厂商 | SDK | 字段 | 值 | 实现路径 |
|---|---|---|---|---|
| Anthropic | @langchain/anthropic | `thinking: ThinkingConfigParam` | `enabled` / `disabled` / `adaptive` | SDK 原生 |
| Gemini | @langchain/google-genai | `thinkingConfig` 对象 | `thinkingBudget`/`thinkingLevel`/`includeThoughts` | SDK 原生 |
| DeepSeek 官方 | @langchain/deepseek | `thinking: {type: 'enabled'/'disabled'}` | 嵌套对象 | modelKwargs 透传 |
| 火山豆包 | @langchain/openai | `thinking: {type: 'enabled'/'disabled'}` | 嵌套对象 | modelKwargs 透传 |
| 阿里通义 | @langchain/openai | `enable_thinking: true/false` | 布尔值 | modelKwargs 透传 |
| OpenAI o-系列 | @langchain/openai | `reasoning_effort` | `'low'/'medium'/'high'` | langchain 原生（仅 isReasoningModel） |

### 4.3 实现伪代码

```ts
function applyThinkingParams(sdkType, modelName, baseUrl, thinking) {
  if (thinking === undefined) return {}

  // 1. Anthropic SDK：原生 thinking
  if (sdkType === 'anthropic') {
    return thinking
      ? { thinking: { type: 'enabled', budget_tokens: 10_000 } }
      : { thinking: { type: 'disabled' } }
  }

  // 2. Gemini SDK：原生 thinkingConfig
  if (sdkType === 'gemini') {
    return thinking
      ? { thinkingConfig: { thinkingBudget: 10_000, includeThoughts: true } }
      : {}
  }

  // 3. DeepSeek SDK：modelKwargs 透传
  if (sdkType === 'deepseek') {
    return {
      modelKwargs: {
        thinking: { type: thinking ? 'enabled' : 'disabled' },
      },
    }
  }

  // 4. OpenAI SDK：按 baseUrl host 嗅探
  if (sdkType === 'openai') {
    const url = baseUrl ?? ''

    // 4a. 阿里百炼 / dashscope
    if (url.includes('dashscope.aliyuncs.com')) {
      return { modelKwargs: { enable_thinking: thinking } }
    }
    // 4b. 火山引擎方舟（豆包）
    if (url.includes('volces.com') || url.includes('volcengine')) {
      return { modelKwargs: { thinking: { type: thinking ? 'enabled' : 'disabled' } } }
    }
    // 4c. DeepSeek 官方走 OpenAI 兼容
    if (url.includes('deepseek.com')) {
      return { modelKwargs: { thinking: { type: thinking ? 'enabled' : 'disabled' } } }
    }
    // 4d. 真 OpenAI o-系列 / gpt-5
    if (/^o\d/.test(modelName) || /^gpt-5(?!-chat)/.test(modelName)) {
      return { reasoningEffort: thinking ? 'medium' : undefined }
    }
    // 4e. 其它未知端点：不处理
    return {}
  }

  return {}
}
```

### 4.4 已知边界

- **4e 分支**：自托管代理 / 企业 baseUrl 不带 vendor 关键字时，运营开了 supports_thinking 但实际请求不带 thinking 参数。这种情况留给运营在使用时自己发现并报告
- **OpenAI o-系列**：当前项目无 o-系列模型；4d 分支保留兜底，未来引入再实测

## 5. NodeConfig 类型扩展

`server/services/node/node.service.ts` 的 `NodeConfig` 接口新增两个字段：

```ts
interface NodeConfig {
  // ... 已有字段
  thinkingEnabled: boolean         // 来自 nodes.thinking_enabled
  modelSupportsThinking: boolean   // 来自 models.supports_thinking
}
```

`getNodeConfigService` / `getNodeConfigByIdService` / `getNodeConfigsByTypes` 三个构造点同步填这两个字段。

## 6. 调用点改造

### 6.1 thinking 决议改造（共 7 处）

| 文件 | 当前 | 改造后 |
|---|---|---|
| `agent-platform/factory/runtime.ts:119` | `thinking: ctx.thinking ?? false` | `thinking: resolveThinking(nodeConfig.modelSupportsThinking, ctx.thinking, nodeConfig.thinkingEnabled)` |
| `agents/case-analysis/runAnalysisSubAgent.ts:96` | `thinking,` | 同上模式 |
| `services/workflow/agents/moduleAgent.ts:89` | `thinking: options.thinking` | 同上 |
| `services/workflow/agents/assistantAgent.ts:84` | `thinking,` | 同上 |
| `services/agent-platform/subAgent/subAgentToolFactory.ts:122` | （无 thinking 字段，子代理继承父）| 接受父 ctx.thinking 走 resolveThinking |
| `agents/case-module/agent.config.ts:57` | `thinking: ctx.thinking` | 同上 |
| `services/retrieval/intentClassifier.service.ts:154` | `thinking: false`（硬关）| **保持不变**（后台分类，不需思考） |

### 6.2 硬编 prompt 删除 / 改造

| 文件 | 改动 |
|---|---|
| `services/material/material.service.ts:495-501` | 删硬编 anthropic Haiku + `process.env.ANTHROPIC_API_KEY`，改走 `materialAutoSummary` 节点 + `invokeNodeJson` |
| `agents/contract/docx/partyDetector.ts:41-95` | 删 `LLM_PROMPT` + 节点借用，改走 `contractPartyDetect` 节点 + `invokeNodeJson` |
| `services/case/initAnalysis.service.ts:343-346` | 删硬编 systemPrompt 直传，改走 `analysisSummary` 节点 |
| `services/memory/consolidator.service.ts:118-131,193-230` | 删硬编 `buildExtractPrompt`，统一走 `caseMemoryExtract` 节点 + `invokeNodeJson` |
| `services/retrieval/intentClassifier.service.ts:27-75,158-170` | 删 `DEFAULT_SYSTEM_PROMPT` 75 行兜底；`typeHint` 改占位符变量 |
| `services/workflow/agents/documentMainAgent.ts:47-82` | 删 `buildInitialPromptFromDraft`，改读 `nodeConfig.prompts` 3 条 user prompt + 按分支挑一条 + 模板变量渲染 |
| `api/v1/case/extract.post.ts:33,222-238` | 删 `SUMMARY_PROMPT_TEMPLATE`，`generateFileSummary` 改走 `material_summarizer` 节点 |
| `services/case/caseExtraction.service.ts:46-52` | 删 dead code `CASE_COURT_FIELDS_PROMPT_APPENDIX`（已确认无引用） |

## 7. 节点最终清单（共 26 个）

新增 3 个节点：

| id | name | title | type | priority | modelId | groupId | tools | outputSchema | thinkingEnabled |
|---|---|---|---|---|---|---|---|---|---|
| 24 | `materialAutoSummary` | 材料自动摘要 | extraction | 110 | 1 | NULL | `[]` | null | false |
| 25 | `contractPartyDetect` | 合同甲乙方与类型识别 | extraction | 41 | 1 | NULL | `[]` | 见下方 | false |
| 26 | `analysisSummary` | 案件分析结果摘要 | extraction | 105 | 1 | NULL | `[]` | null | false |

### 7.1 contractPartyDetect 的 outputSchema

```json
{
  "type": "object",
  "required": ["partyA", "partyB", "contractType"],
  "properties": {
    "partyA": { "type": ["string", "null"], "description": "甲方完整名称；无法识别返回 null" },
    "partyB": { "type": ["string", "null"], "description": "乙方完整名称；无法识别返回 null" },
    "contractType": {
      "type": ["string", "null"],
      "description": "合同类型，必须从枚举中选一个，无法识别返回 null",
      "enum": ["买卖合同","租赁合同","劳动合同","劳务合同","服务合同","承揽合同","建设工程合同","技术合同","委托合同","行纪合同","居间合同","保管合同","仓储合同","运输合同","赠与合同","借款合同","保证合同","抵押合同","质押合同","定金合同","保险合同","合伙合同","股权转让合同","其他", null]
    }
  }
}
```

合同类型枚举从 `#shared/types/contract` 的 `CONTRACT_TYPE_OPTIONS` 复制。

## 8. Prompts 最终清单（共 29 条 status=1）

### 8.1 删除 4 条 status=0 旧版本

- id=6 `caseMain_system` v1
- id=14 `caseMain_system` v2
- id=15 `caseMain_system` v3
- id=20 `documentMain_system` v2

### 8.2 修改 1 条 — `search_intent_router_system` v1 → v2

加 `{{typeHint}}` 占位符。完整内容见原代码 `intentClassifier.service.ts:56-75` 的 `DEFAULT_SYSTEM_PROMPT`，末尾追加 `{{typeHint}}` 行。

调用方按检索类型注入：
- `type='law'` 或 `'case_memory'` → 空字符串
- `type='case_material'` 或 `'case_analysis'` → `"\n\n注意：这是案件材料/分析检索，不存在精确通道。只能分类为 hybrid 或 semantic。"`

### 8.3 新增 6 条

#### Prompt 1 — `materialAutoSummary_system`（节点 24，type=system，version=v1）

```
你是法律材料摘要助手。请阅读下方案件材料正文，输出一段简明摘要。

输出要求：
- 严格不超过 100 字
- 保留关键事实、时间、数字、当事人姓名等核心信息
- 不加"摘要："、"总结："等开场白，也不加结尾总结语
- 输出纯文本，不使用 Markdown 格式或编号
- 直接输出摘要正文
```

变量：无（输入正文走 user message）。

#### Prompt 2 — `contractPartyDetect_system`（节点 25，type=system，version=v1）

```
你是法律合同识别助手。从用户提供的合同前 1500 字中识别甲方、乙方、合同类型，以严格 JSON 格式输出。

字段说明：
- partyA：合同中甲方的完整名称（公司全称或个人姓名），识别不出填 null
- partyB：合同中乙方的完整名称，识别不出填 null
- contractType：合同类型，必须从下方候选清单中选一个，识别不出填 null

候选合同类型：
{{contractTypeOptions}}

输出要求：
- 严格 JSON，三个字段都必须存在
- 无法识别填 null，禁止编造
- 只输出 JSON，不要任何解释、注释或 Markdown 代码块
```

变量：`{{contractTypeOptions}}` — 调用方从 `CONTRACT_TYPE_OPTIONS` 拼成顿号分隔字符串注入。

#### Prompt 3 — `analysisSummary_system`（节点 26，type=system，version=v1）

```
你是法律案件分析摘要助手。请阅读下方某个案件分析模块的完整分析报告，输出一段专业摘要。

输出要求：
- 字数控制在 200-400 字之间
- 保留：关键事实、关键结论、关键法律依据
- 省略：方法论说明、思考过程、过渡性语句
- 不加"摘要："、"本报告"等开场白，也不加结尾总结语
- 用中文专业表达，符合法律行业用语
- 输出纯文本，不使用 Markdown 格式或编号
- 直接输出摘要正文
```

变量：无。

#### Prompt 4 — `documentMain_user_with_files`（节点 17，type=user，version=v1）

```
请为《{{templateName}}》按字段 schema 生成文书内容。

新增材料 fileIds: {{fileIds}}，请先调用 process_materials(fileIds={{fileIds}}) 处理这些文件，再用 search_case_materials 检索内容回填字段。

{{userExtraText}}

收集到足够信息后，必须通过结构化输出工具返回 values + suggestions，严禁在消息正文自行写 JSON 或代码块；未知字段返回 null，不要编造。
```

变量：`{{templateName}}`、`{{fileIds}}`、`{{userExtraText}}`。

#### Prompt 5 — `documentMain_user_with_case`（节点 17，type=user，version=v1）

```
请为《{{templateName}}》按字段 schema 生成文书内容。

本草稿关联案件已完成初分分析（system prompt 中 caseProfile + moduleSummaries 段已附 200-400 字摘要）。请按以下顺序填充模板字段：

1) 优先调用 search_case_analysis(analysisType=...) 获取已分析模块的全文（事实/请求/案由/抗辩/证据等），用其中的精确数据填字段；
2) 若已分析模块不足以覆盖某些字段，再调 search_case_materials 从原始材料补充；
3) 严禁向用户重复索要案件已经记录过的信息（当事人、事实、请求等都能从已有分析或案件档案里拿到）。

{{userExtraText}}

收集到足够信息后，必须通过结构化输出工具返回 values + suggestions，严禁在消息正文自行写 JSON 或代码块；未知字段返回 null，不要编造。
```

变量：`{{templateName}}`、`{{userExtraText}}`。

#### Prompt 6 — `documentMain_user_standalone`（节点 17，type=user，version=v1）

```
请为《{{templateName}}》按字段 schema 生成文书内容。

请先调用 search_case_materials 查询本草稿已就绪的材料；若确无任何材料，再向用户询问需要补充的具体内容。

{{userExtraText}}

收集到足够信息后，必须通过结构化输出工具返回 values + suggestions，严禁在消息正文自行写 JSON 或代码块；未知字段返回 null，不要编造。
```

变量：`{{templateName}}`、`{{userExtraText}}`。

## 9. UI 改动

### 9.1 ModelFormDialog（`app/components/admin/models/ModelFormDialog.vue`）

在 `sdkType` 下方加：

```vue
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

`modelType` 切换为非 chat 时，自动 `form.supportsThinking = false`。

### 9.2 NodeFormDialog（`app/components/admin/nodes/NodeFormDialog.vue`）

在"关联模型"下方加：

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

```ts
const selectedModelSupportsThinking = computed(() => {
  const m = models.value.find(x => String(x.id) === form.value.modelId)
  return m?.supportsThinking === true
})

watch(() => form.value.modelId, () => {
  if (!selectedModelSupportsThinking.value) {
    form.value.thinkingEnabled = false
  }
})
```

### 9.3 后端 API 字段补充

| 接口 | 改动 |
|---|---|
| `GET /api/v1/admin/models` 返回 | 加 `supportsThinking: boolean` |
| `POST /api/v1/admin/models` body | 加 `supportsThinking?: boolean`（zod，默认 false） |
| `PATCH /api/v1/admin/models/:id` body | 同上 |
| `GET /api/v1/admin/nodes` 返回 | 加 `thinkingEnabled` + `model.supportsThinking`（嵌套）|
| `POST /api/v1/admin/nodes` body | 加 `thinkingEnabled?: boolean`（默认 false） |
| `PATCH /api/v1/admin/nodes/:id` body | 同上 |

## 10. 顺便清理项

- 删除 4 条 status=0 旧版本 prompt（id=6/14/15/20）
- 删除 87 个 e2e 测试遗留 `node_groups`（dev/testing/seedData 同步），保留生产 3 个：`id=1` 工作流节点、`id=2` 分析模块、`id=3` 文书模块
- 删除 dead code `services/case/caseExtraction.service.ts:46-52` 的 `CASE_COURT_FIELDS_PROMPT_APPENDIX`

## 11. 实施分 3 个 PR

### PR 1 — Schema + UI 基础（不影响业务）

**改动**：
- prisma schema 加字段（自动生成 migration.sql）
- seedData.sql 给现有 17 个 models / 23 个 nodes 加默认值字段
- dev/testing 库自动应用迁移（默认值生效，无需手工 UPDATE）
- `NodeConfig` 接口扩字段 + 3 处构造逻辑
- `chatModelFactory.ts` thinking 协议分发（4 路）
- 新增 `thinkingResolver.ts` helper
- 7 处调用点改造为 `resolveThinking(...)`
- ModelFormDialog + NodeFormDialog UI 改动
- admin models / nodes API 字段读写补全

**验证**：所有现有节点 `thinking_enabled=false`、所有模型 `supports_thinking=false` → 决议结果与改造前完全一致。`bun run typecheck` + 现有单测全绿。

### PR 2 — 删硬编 + 新节点（一对一替换）

**改动**：
- 新建节点 24/25/26 + 新增 6 条 prompts（dev/testing/seedData 同步）
- 删 4 条 status=0 旧 prompts（dev/testing/seedData 同步）
- 清理 87 个 e2e 残留 node_groups（dev/testing/seedData 同步）
- `material.service.ts:495` → `materialAutoSummary` 节点
- `partyDetector.ts:41-95` → `contractPartyDetect` 节点
- `initAnalysis.service.ts:343` → `analysisSummary` 节点
- `consolidator.service.ts:118-131,193-230` → `caseMemoryExtract` 节点
- 删 dead code `CASE_COURT_FIELDS_PROMPT_APPENDIX`

**验证**：4 个改造点行为与改造前一致；相关单测全绿；手工冒烟 4 个场景。

### PR 3 — 提示词重构（行为变化大）

**改动**：
- `documentMain` 节点新增 3 条 user prompt
- `search_intent_router` system prompt v1 → v2（加 `{{typeHint}}`）
- `documentMainAgent.ts:47-82` 删 `buildInitialPromptFromDraft`，改读 nodeConfig.prompts user 3 条
- `intentClassifier.service.ts:27-75,158-170` 删 `DEFAULT_SYSTEM_PROMPT` + typeHint 改占位符
- `extract.post.ts:33,222-238` 删 `SUMMARY_PROMPT_TEMPLATE`，复用 `material_summarizer`

**验证**：
- 文书生成 3 种场景（关联案件 / 独立草稿 / 带文件上传）回归
- 法规检索 4 种类型（law / case_material / case_memory / case_analysis）意图分类回归
- 超长材料提取触发分批摘要并最终提取成功

## 12. 风险与边界

### 12.1 已知风险

- **OpenAI SDK host 嗅探脆**：自托管代理 / 企业 baseUrl 不带 vendor 关键字时，supports_thinking 开了但实际请求不带 thinking 参数。运营使用时自查
- **生产数据回填**：用户手工对照 seedData.sql 同步生产 DB；存在遗漏风险。建议 PR 2 / PR 3 上线前用户先在生产 DB 上做 dry-run 数据脚本
- **PR 3 行为变化**：documentMain 启动指令、intentClassifier 失去代码兜底，影响面较大，需充分回归

### 12.2 不在本次范围内

- 节点级 `thinking_budget` / `thinking_level` / `thinking_mode='adaptive'` 等高级配置（当前仅 boolean 开关）
- OpenAI o-系列模型的 `reasoning_effort` 高级粒度配置（项目当前无此模型）
- 嵌入 / 重排模型纳入 `nodes` 表（保留在 `models` 表 + 后台模型管理足够）

## 13. 验收标准

- ✅ 所有 6 处纳管改造完成，对应硬编 prompt / 模型从代码中删除
- ✅ 后台模型管理 / 节点管理 UI 能配置思考开关，联动行为正确
- ✅ 默认状态（supports_thinking=false / thinking_enabled=false）下行为与改造前完全一致
- ✅ 运营在后台开启某模型 supports_thinking 后，节点编辑页才显示 thinking_enabled 开关
- ✅ 前端 AiPromptInput 用户切换 thinking 优先级最高
- ✅ DB 中 prompts 表只保留 status=1 的最终版本（4 条 status=0 已删）
- ✅ DB 中 node_groups 仅保留 id=1/2/3 三个生产分组
- ✅ seedData.sql 与 dev/testing 库一致
- ✅ `bun run typecheck` 全绿；vitest 单测全绿；3 个 PR 各自手工回归通过
