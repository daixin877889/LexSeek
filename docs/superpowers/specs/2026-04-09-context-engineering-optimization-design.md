# 工作流与 Agent 上下文工程全量优化设计

**版本**: 1.5
**日期**: 2026-04-10
**状态**: 审查通过

---

## 一、概述

### 1.1 背景

对 LexSeek 项目中工作流和 Agent 的上下文工程进行全面审查后，发现 14 个问题横跨工具层、提示词层、中间件层、上下文层和基础设施层。本设计采用"逐层加固"策略，从底层向上修复，每层的改动独立可测试。

### 1.2 问题全景

| 编号 | 优先级 | 层级 | 问题 | 影响 |
|------|--------|------|------|------|
| 1 | P0 | 提示词层 | 模板变量从未渲染，`{{xxx}}` 字面量进入模型 | 提示词功能失效 |
| 2 | P0 | 工具层 | `searchLaw` 无任何结果截断 | 上下文溢出 |
| 3 | P0 | 中间件层 | `messageCompressor.ts` 核心函数为死代码 | 防线失效 |
| 4 | P1 | 中间件层 | 注入的 HumanMessage 持久化到 checkpoint 逐轮膨胀 | 上下文浪费 |
| 5 | P1 | 中间件层 | `summarizationMiddleware` 阈值硬编码 100k | 小窗口模型溢出 |
| 6 | P1 | 工具层 | token 估算精度不足（`maxTokens * 3`） | 截断不足 |
| 7 | P1 | 工具层 | 检索工具 `k` 参数无上限 | 上下文溢出 |
| 8 | P1 | 中间件层 | V1 路径缺少 token 兜底防线 | 溢出无兜底 |
| 9 | P2 | 提示词层 | `caseAnalysis.ts` runtime prompt 从未生效 | 无效代码 |
| 10 | P2 | 上下文层 | `moduleContextBuilder` 全量注入无 token 预算 | 上下文溢出 |
| 11 | P2 | 上下文层 | 子代理无材料上下文 | 分析质量下降 |
| 12 | P2 | 中间件层 | 中间件顺序为隐性约定 | 维护风险 |
| 13 | P2 | 基础设施 | `storage.ts` 进程内存储不支持多实例 | 多实例部署失效 |
| 14 | P2 | 基础设施 | Worker 过滤逻辑不完整 | 信息泄露风险 |

### 1.3 实施策略

```
Layer 1: 工具层    → #2 #6 #7 searchLaw 截断、k 上限、统一 tokenCounter
Layer 2: 提示词层  → #1 #9 renderContent 集成、无效参数移除
Layer 3: 中间件层  → #3 #4 #5 #8 #12 checkpoint 膨胀治理、动态阈值、V1 兜底、顺序保障
Layer 4: 上下文层  → #10 #11 moduleContextBuilder token 预算、子代理上下文
Layer 5: 基础设施  → #13 #14 storage Redis 化、Worker 过滤完善
```

### 1.4 设计约束

- **所有代理**（主代理、模块代理、子代理）的动态上下文注入统一使用 HumanMessage + `response_metadata.injectedBy` 标记方案（LangGraph 不允许多个 SystemMessage，且保持 systemPrompt 纯静态以命中 Prompt Caching）
- 前端通过 `useMessageParser.ts` 按 `injectedBy` 前缀过滤，服务端 `stripSystemMessages` 过滤 system 消息
- 两条工作流路径（V1 initAnalysis / V2 caseAnalysisV2）均为正式功能，需同等级优化
- `server/utils/tokenCounter.ts`（tiktoken cl100k_base）已实现，可直接复用
- 数据库时区 Asia/Shanghai，Prisma 连接使用 TimeZone=UTC
- **中间件 hook 格式**：项目使用 `createMiddleware` API，所有 hook 须用 `{ hook: async (state) => {...} }` 对象包装，不支持直接赋值 async 函数

---

## 二、Layer 1：工具层加固

### 2.0 检索架构现状

两个检索工具的底层已接入统一检索路由器（`retrievalRouterService`），链路为：

```
workflow tool → 服务层(searchLaw / searchMaterialsService)
  → retrievalRouterService
    → LLM 意图分类 → 精确/混合/语义通道
    → Rerank（MAX_RERANK_DOCS = 20）
    → 后处理过滤
    → results.slice(0, request.k)
```

路由器层已提供两层条数保护：
- Rerank 阶段上限 20 条（`MAX_RERANK_DOCS`）
- 最终 `slice(0, k)` 确保返回条数 <= k

但以下问题仍然存在，需要在 workflow tool 层修复：
- **k 参数无 schema 级上限**：模型可传入 `k=50`，虽然 Rerank 层隐式限制了 20，但不应依赖内部实现细节
- **searchLaw 无单条结果截断**：路由器控制条数但不控制单条内容大小，法律条文可能很长
- **toolResultTruncator 字符估算不精确**：`estimateTokens` + `maxTokens * 3` 中文偏差 2 倍

### 2.1 `searchLaw` 添加结果截断

**文件**：`server/services/workflow/tools/searchLaw.tool.ts`

**现状**：直接 `JSON.stringify(formattedResults)` 返回，无单条截断。路由器层已保证条数 <= k，但单条法律条文内容可能很长。

**改造**：

1. `k` 参数添加 schema 级上限（与 Rerank `MAX_RERANK_DOCS = 20` 对齐）：

```typescript
// 原来
k: z.number().optional().default(5).describe('返回结果数量')

// 改为
k: z.number().max(20).optional().default(5).describe('返回结果数量，最多 20 条')
```

2. 返回前调用 `truncateToolResults`：

```typescript
import { truncateToolResults } from '../context/toolResultTruncator'

// 在 return 前
const truncated = truncateToolResults(formattedResults, { maxTokensPerItem: 8000 })
return JSON.stringify(truncated)
```

### 2.2 `searchCaseMaterials` 添加 k 上限

**文件**：`server/services/workflow/tools/searchCaseMaterials.tool.ts`

**现状**：已集成 `truncateToolResults` 做单条截断，但 `k` 参数无 schema 级上限。

```typescript
// 原来
k: z.number().optional().default(5).describe('返回结果数量，默认为 5')

// 改为
k: z.number().max(20).optional().default(5).describe('返回结果数量，默认为 5，最多 20 条')
```

### 2.3 `toolResultTruncator.ts` 切换到 tiktoken

**文件**：`server/services/workflow/context/toolResultTruncator.ts`

**现状**：`maxChars = maxTokens * 3`（中文偏差 2 倍）。

**改造**：使用 `countTokensSync` 精确计算，二分查找截断点：

```typescript
import { countTokensSync } from '~/server/utils/tokenCounter'

/**
 * 将文本精确截断到指定 token 上限。
 * 使用二分查找定位截断点，确保不会在 surrogate pair 中间截断。
 */
function truncateToTokenLimit(content: string, maxTokens: number): string {
  const tokens = countTokensSync(content)
  if (tokens <= maxTokens) return content

  // 转为 Unicode 码点数组，避免在 surrogate pair 中间截断（如 emoji、罕见汉字）
  const codePoints = Array.from(content)
  let lo = 0, hi = codePoints.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (countTokensSync(codePoints.slice(0, mid).join('')) <= maxTokens) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return codePoints.slice(0, lo).join('') + '\n\n[内容过长已截断，请使用更精确的查询条件或指定 sourceId 重新检索]'
}
```

替换原有的 `maxChars` 逻辑，`truncateToolResults` 函数签名不变，调用方无需修改。

**性能评估**：`countTokensSync` 使用 `cl100k_base` 编码，对单条工具结果（< 100KB）延迟在毫秒级。二分查找最多约 17 次调用（`log2(100000)`），总延迟 < 50ms，可接受。

> **注意**：使用 `Array.from(content)` 将字符串转为 Unicode 码点数组，避免 `String.prototype.slice` 在 surrogate pair 中间截断导致乱码。

---

## 三、Layer 2：提示词层修复

### 3.1 Agent 创建时统一渲染模板变量

**新增文件**：`server/services/workflow/utils/promptRenderer.ts`

```typescript
import { renderContent } from '~/server/services/node/prompt.service'

interface PromptRenderContext {
  caseId?: number
  moduleName?: string
  caseType?: string
}

/**
 * 从 nodeConfig 提取系统提示词并渲染模板变量。
 * 未替换的 {{xxx}} 会记录 warn 日志。
 */
export function renderSystemPrompt(
  nodeConfig: NodeConfig,
  context: PromptRenderContext = {}
): string {
  const raw = nodeConfig.prompts.find(
    p => p.type === 'system' && p.status === 1
  )?.content || ''

  const variables: Record<string, string> = {}
  if (context.caseId != null) variables.caseId = String(context.caseId)
  if (context.moduleName) variables.moduleName = context.moduleName
  if (context.caseType) variables.caseType = context.caseType

  const rendered = renderContent(raw, variables)

  // 检测未替换的模板变量
  const unreplaced = rendered.match(/\{\{(\w+)\}\}/g)
  if (unreplaced) {
    logger.warn('系统提示词存在未替换的模板变量', {
      nodeId: nodeConfig.id,
      nodeName: nodeConfig.name,
      unreplacedVars: unreplaced,
    })
  }

  return rendered
}
```

**改造范围**：

| 文件 | 原来 | 改为 |
|------|------|------|
| `caseMainAgent.ts` | `mainConfig.prompts.find(...)?.content` | `renderSystemPrompt(mainConfig, { caseId })` |
| `moduleAgent.ts` | `nodeConfig.prompts.find(...)?.content` | `renderSystemPrompt(nodeConfig, { caseId, moduleName })` |
| `caseAnalysis.ts` | `nodeConfig.prompts.find(...)?.content` | `renderSystemPrompt(nodeConfig, { caseId, moduleName })` |
| `subAgentToolFactory.ts` | `nodeConfig.prompts.find(...)?.content` | `renderSystemPrompt(nodeConfig, { caseId })` |

### 3.2 移除 `caseAnalysis.ts` 无效 runtime prompt

**文件**：`server/services/workflow/agents/caseAnalysis.ts`

```typescript
// 原来
const { userId, caseId, prompt } = extractRuntimeConfig(config)

// 改为（移除 prompt）
const { userId, caseId } = extractRuntimeConfig(config)
```

同时清理 `extractRuntimeConfig` 中对 `prompt` 字段的解构。

---

## 四、Layer 3：中间件层改造

### 4.1 checkpoint 上下文膨胀治理

**文件**：`caseMaterialContextMiddleware.ts`、`moduleContextMiddleware.ts`

**问题**：`splice` 注入的 HumanMessage 被 PostgresSaver 持久化，历史注入内容随对话轮次累积。

**方案**：保持历史注入消息不动（命中模型供应商 Prompt Caching），仅在上下文发生变更时追加增量消息。

> **关键约束**：模型供应商（OpenAI、Anthropic、DeepSeek 等）对消息前缀匹配做 Prompt Caching。如果每轮清除并重新注入上下文，即使内容相同，消息 ID 变化也会导致缓存失效，token 成本大幅上升。因此**绝不清除历史注入消息**，而是通过增量检测只追加变更部分。

**改造策略**：

1. **历史注入消息保持原样**（命中缓存）
2. **增量检测逻辑不变**：通过 `_injectedSourceIds`、hash 等 state 字段检测上下文变更
3. **只追加变更部分**：只有新增材料、记忆变化、分析结果更新时才注入新的 HumanMessage
4. **膨胀治理交由 summarizationMiddleware + safetyTrimMiddleware 兜底**：当累积的注入消息导致总 token 逼近窗口时，由 4.2/4.3 的压缩和截断机制处理

**改造 `caseMaterialContextMiddleware`**（主要是确保增量逻辑的正确性）：

```typescript
beforeAgent: {
  hook: async (state) => {
    const prevSourceIds = state._injectedSourceIds ?? []
    const currentSourceIds = getCurrentSourceIds(caseId)
    const newSourceIds = currentSourceIds.filter(id => !prevSourceIds.includes(id))

    if (newSourceIds.length === 0) return  // 无变更，不注入，历史消息原样保留

    // 仅注入新增材料的上下文
    const newMaterials = materials.filter(m => newSourceIds.includes(getSourceId(m)))
    const context = await getMaterialContextService(newMaterials)
    if (context.mode === 'empty') return

    const messageText = buildIncrementalMaterialMessage(context)
    const insertIdx = Math.max(0, state.messages.length - 1)
    state.messages.splice(insertIdx, 0, new HumanMessage({
      content: messageText,
      response_metadata: { injectedBy: 'CaseMaterialContextMiddleware', injectedAt: new Date().toISOString() },
    }))

    return { _injectedSourceIds: currentSourceIds }
  },
},
```

**改造 `moduleContextMiddleware`**（当前逻辑已基本正确，确认要点）：

```typescript
beforeAgent: {
  hook: async (state) => {
    // 并行加载 4 类上下文并用 hash 检测变更
    // 只有 hash 变化的 section 才会拼入新的注入消息
    // 所有 section 都没有变化时直接 return，不注入任何消息
    // 历史注入消息保持原样，命中 Prompt Caching

    const sections: string[] = []

    // 1. 材料变更检测（sourceId 增量）
    // 2. 记忆变更检测（MD5 hash 对比）
    // 3. 其他模块结果变更检测（per-module hash 对比）
    // 4. 当前模块结果变更检测（MD5 hash 对比）

    if (sections.length === 0) return  // 无变更

    // 追加增量消息到最新 HumanMessage 之前
    const contextMessage = new HumanMessage({
      content: sections.join('\n\n'),
      response_metadata: { injectedBy: `ModuleContextMiddleware:${moduleName}`, injectedAt: new Date().toISOString() },
    })
    // ...insert logic...
  },
},
```

**效果**：
- 历史注入消息不动 → 命中 Prompt Caching → 降低 token 成本
- 增量检测确保只追加变更 → 减缓膨胀速度
- 膨胀最终由 summarizationMiddleware（4.2）+ safetyTrimMiddleware（4.3）兜底处理

**与当前实现的差异**：当前 `caseMaterialContextMiddleware` 的首次注入和增量注入逻辑已基本正确。主要改造点在于确保增量检测的健壮性（如 sourceId 去重、hash 稳定性），以及移除任何"清除历史注入"的逻辑（如果有的话）。

### 4.2 summarization 阈值动态化

**影响文件**：`caseMainAgent.ts`、`moduleAgent.ts`、`caseAnalysis.ts`、`initAnalysis.executor.ts`

```typescript
// 原来
summarizationMiddleware({ model, trigger: [{ tokens: 100000 }] })

// 改为
// 注意：modelContextWindow 为可选字段，DB 中未配置时降级到 128000
// （当前主流模型多为 128K 窗口，此为保守默认值）
// 建议后续在节点管理界面增加 contextWindow 必填校验
const contextWindow = nodeConfig.modelContextWindow || 128000
const triggerTokens = Math.max(Math.floor(contextWindow * 0.6), 30000) // 下限 30k 防止频繁触发
summarizationMiddleware({ model, trigger: [{ tokens: triggerTokens }] })
```

### 4.3 V1 路径补充 token 兜底防线

**新增**：`server/services/workflow/middleware/safetyTrim.middleware.ts`

```typescript
import { compressMessages, safetyTrimMessages, estimateMessagesTokens } from '../context/messageCompressor'

/**
 * 安全截断中间件 — 作为 summarizationMiddleware 的兜底防线。
 * 当 summarization 未能充分压缩时，强制截断消息到预算内。
 *
 * 使用 estimateMessagesTokens（字符估算）做快速预判，
 * 实际截断由 compressMessages/safetyTrimMessages 执行。
 * 这是有意的两层策略：快速预判 + 精确截断，避免每轮都调用 tiktoken。
 */
export function safetyTrimMiddleware(options: { model: BaseChatModel; maxTokens: number }) {
  return createMiddleware({
    name: 'safetyTrimMiddleware',
    stateSchema: z.object({}),
    beforeAgent: {
      hook: async (state: { messages: BaseMessage[] }) => {
        // estimateMessagesTokens 是同步函数（返回 number），用于快速预判
        const estimated = estimateMessagesTokens(state.messages)
        if (estimated <= options.maxTokens) return

        // 防线一：LLM 摘要压缩
        // 注意：compressMessages 的签名为 (messages, budget, model)
        try {
          const compressed = await compressMessages(
            state.messages,
            options.maxTokens,
            options.model,
          )
          state.messages = compressed
          return
        } catch (error) {
          logger.warn('compressMessages 失败，降级到 safetyTrim', { error })
        }

        // 防线二：trimMessages 截断
        state.messages = await safetyTrimMessages(state.messages, options.maxTokens)
      },
    },
  })
}
```

**集成到 V1 路径**（`initAnalysis.executor.ts`）：

```typescript
middleware: [
  pointConsumptionMiddleware(...),
  caseMaterialContextMiddleware(...),
  summarizationMiddleware({ model, trigger: [{ tokens: triggerTokens }] }),
  safetyTrimMiddleware({ model, maxTokens: Math.floor(contextWindow * 0.8) }),
]
```

**同时集成到 V2 路径**的所有 Agent，确保双路径安全性对等。

**V2 路径改造细节**（`caseAnalysisV2.workflow.ts`）：

V2 路径每个模块节点内联了 `callModel ↔ tools` 的 ReAct 循环。改造点：

1. **`callModel` 节点中**：在调用模型前，添加 `safetyTrimMessages` 兜底检查
2. **`buildModuleContext()` 调用时**：传入 `contextWindow` 参数（来自 `nodeConfig.modelContextWindow`），启用 token 预算分配
3. **`summarization` 逻辑**：将固定 100k 阈值改为 `Math.max(contextWindow * 0.6, 30000)`

由于 V2 路径不使用中间件系统，`safetyTrimMiddleware` 不直接集成，而是在 `callModel` 节点的 `beforeModel` 位置内联调用 `safetyTrimMessages`。

### 4.4 中间件顺序保障

**新增**：`server/services/workflow/middleware/types.ts`（扩展已有 types 或新建）

```typescript
export interface MiddlewareWithPriority {
  middleware: AgentMiddleware
  priority: number  // 越小越先执行
  name: string
}

// 优先级规范
export const MIDDLEWARE_PRIORITY = {
  PROCESS_MATERIAL: 10,      // 材料预处理，最先执行
  POINT_CONSUMPTION: 20,     // 积分预检
  MATERIAL_CONTEXT: 30,      // 材料上下文注入
  MODULE_CONTEXT: 30,        // 模块上下文注入（与材料互斥）
  SUMMARIZATION: 40,         // 摘要压缩
  SAFETY_TRIM: 50,           // 兜底截断
  TODO_LIST: 80,             // 任务清单
  RESULT_PERSISTENCE: 90,    // 结果持久化，末位
} as const

// 中间件名称常量（统一命名，避免字符串硬编码不一致）
export const MIDDLEWARE_NAMES = {
  PROCESS_MATERIAL: 'caseProcessMaterial',
  POINT_CONSUMPTION: 'pointConsumption',
  MATERIAL_CONTEXT: 'caseMaterialContext',
  MODULE_CONTEXT: 'moduleContext',
  SUMMARIZATION: 'summarization',
  SAFETY_TRIM: 'safetyTrim',
  TODO_LIST: 'todoList',
  RESULT_PERSISTENCE: 'analysisResultPersistence',
} as const

/**
 * 按优先级排序中间件栈。
 * 验证互斥约束（MATERIAL_CONTEXT 和 MODULE_CONTEXT 不同时挂载）。
 */
export function buildMiddlewareStack(items: MiddlewareWithPriority[]): AgentMiddleware[] {
  // 互斥校验（使用常量，不硬编码字符串）
  const hasMaterial = items.some(i => i.name === MIDDLEWARE_NAMES.MATERIAL_CONTEXT)
  const hasModule = items.some(i => i.name === MIDDLEWARE_NAMES.MODULE_CONTEXT)
  if (hasMaterial && hasModule) {
    throw new Error('caseMaterialContextMiddleware 和 moduleContextMiddleware 不能同时挂载')
  }

  const sorted = [...items].sort((a, b) => a.priority - b.priority)
  logger.debug('中间件执行顺序', {
    order: sorted.map(i => `${i.name}(${i.priority})`),
  })
  return sorted.map(i => i.middleware)
}
```

---

## 五、Layer 4：上下文层改造

### 5.1 `moduleContextBuilder` 添加 token 预算

**文件**：`server/services/workflow/context/moduleContextBuilder.ts`

**新增 token 预算分配机制**：

```typescript
import { countTokensSync } from '~/server/utils/tokenCounter'

interface ContextBudget {
  totalBudget: number
  caseInfoBudget: number  // 10%
  materialBudget: number  // 40%
  resultsBudget: number   // 35%
  memoryBudget: number    // 15%
}

function allocateBudget(contextWindow: number): ContextBudget {
  const totalBudget = Math.floor(contextWindow * 0.3)
  return {
    totalBudget,
    caseInfoBudget: Math.floor(totalBudget * 0.1),
    materialBudget: Math.floor(totalBudget * 0.4),
    resultsBudget: Math.floor(totalBudget * 0.35),
    memoryBudget: Math.floor(totalBudget * 0.15),
  }
}
```

**各 section 截断策略**：

| Section | 预算 | 超出处理 |
|---------|------|----------|
| 案件基本信息 | 10% | 通常很小（< 1000 tokens），不截断 |
| 材料上下文 | 40% | 切换到 summary 模式；再超则按 sourceId 优先级截断 |
| 已完成分析结果 | 35% | 按模块优先级保留；超出的模块只保留标题 + 前 200 字摘要 |
| 长期记忆 | 15% | 截断为最新 N 条记忆 |

**灵活分配**：高优先级 section 实际使用少于预算时，剩余空间分配给后续 section。

```typescript
export async function buildModuleContext(params: {
  caseId: number
  sessionId: string
  agentName: string
  contextWindow: number
}): Promise<string> {
  const budget = allocateBudget(params.contextWindow)
  const sections: string[] = []
  let remaining = budget.totalBudget

  // 并行加载四类上下文
  const [caseInfo, materials, results, memory] = await Promise.all([
    buildCaseInfoSection(params.caseId),
    buildMaterialSection(params.caseId),
    buildCompletedResultsSection(params.caseId, params.agentName),
    getCaseMemory(params.caseId),
  ])

  // 按优先级分配预算
  // 1. 案件信息（最高优先级）
  if (caseInfo) {
    const tokens = countTokensSync(caseInfo)
    sections.push(caseInfo)
    remaining -= tokens
  }

  // 2. 材料上下文
  if (materials && remaining > 0) {
    const materialBudget = Math.min(remaining, budget.materialBudget)
    const truncated = truncateSection(materials, materialBudget)
    sections.push(truncated.text)
    remaining -= truncated.tokens
  }

  // 3. 已完成分析结果
  if (results && remaining > 0) {
    const resultsBudget = Math.min(remaining, budget.resultsBudget)
    const truncated = truncateSection(results, resultsBudget)
    sections.push(truncated.text)
    remaining -= truncated.tokens
  }

  // 4. 长期记忆
  if (memory && remaining > 0) {
    const truncated = truncateSection(memory, remaining)
    sections.push(truncated.text)
  }

  return sections.filter(Boolean).join('\n\n')
}

/**
 * 将文本截断到指定 token 预算内。
 */
function truncateSection(
  text: string,
  maxTokens: number
): { text: string; tokens: number } {
  const tokens = countTokensSync(text)
  if (tokens <= maxTokens) return { text, tokens }

  // 按段落截断，保留完整段落
  const paragraphs = text.split('\n\n')
  let accumulated = ''
  let accTokens = 0

  for (const para of paragraphs) {
    const paraTokens = countTokensSync(para)
    if (accTokens + paraTokens > maxTokens) break
    accumulated += (accumulated ? '\n\n' : '') + para
    accTokens += paraTokens
  }

  return {
    text: accumulated + '\n\n[上下文已截断，仅保留前部分内容]',
    tokens: accTokens,
  }
}
```

### 5.2 子代理注入精简材料上下文

**文件**：`server/services/workflow/agents/subAgentToolFactory.ts`

**新增**：`buildBriefContext` 函数，为子代理提供轻量级案件概要：

```typescript
/**
 * 构建精简版案件上下文（约 500-1000 tokens）。
 * 只包含结构化摘要信息，不含材料正文。
 */
async function buildBriefContext(caseId: number): Promise<string> {
  const caseInfo = await prisma.cases.findUnique({
    where: { id: caseId },
    select: {
      title: true,
      caseType: true,
      plaintiff: true,
      defendant: true,
      summary: true,
    },
  })

  if (!caseInfo) return ''

  const materials = await prisma.caseMaterials.findMany({
    where: { caseId, deletedAt: null },
    select: { name: true, type: true },
  })

  const parts = [
    '## 案件概要',
    `- 标题：${caseInfo.title || '未命名'}`,
    caseInfo.caseType ? `- 案件类型：${caseInfo.caseType}` : null,
    caseInfo.plaintiff ? `- 原告：${caseInfo.plaintiff}` : null,
    caseInfo.defendant ? `- 被告：${caseInfo.defendant}` : null,
    caseInfo.summary ? `- 概述：${caseInfo.summary}` : null,
    materials.length > 0
      ? `\n## 材料列表\n${materials.map(m => `- ${m.name} (${m.type})`).join('\n')}`
      : null,
  ]

  return parts.filter(Boolean).join('\n')
}
```

**改造子代理创建逻辑**：

子代理的上下文注入采用**与主代理一致的 HumanMessage + `injectedBy` 标记方案**。原因：
- systemPrompt 拼接方式在上下文变化时（如用户中途新增材料）会导致整个前缀缓存失效
- HumanMessage 方案保持 systemPrompt 纯静态（命中 Prompt Caching），动态上下文追加到消息流中
- 与主代理/模块代理方案统一，降低维护成本

```typescript
// subAgentToolFactory.ts - 工具函数内部

const briefContext = await buildBriefContext(context.caseId)

// systemPrompt 保持纯静态（命中 Prompt Caching）
const agent = createAgent({
  systemPrompt,  // 不拼接 briefContext
  // ...rest
})

// 在 invoke 前，将 briefContext 作为带标记的 HumanMessage 注入到 initialMessages 中
const initialMessages = briefContext
  ? [
      new HumanMessage({
        content: briefContext,
        response_metadata: {
          injectedBy: 'SubAgentContext',
          injectedAt: new Date().toISOString(),
        },
      }),
      new HumanMessage(question),  // 主代理传入的问题
    ]
  : [new HumanMessage(question)]

const result = await agent.invoke(
  { messages: initialMessages },
  { configurable: { thread_id: `${context.sessionId}_sub_${safeName}` } },
)
```

> **注意**：子代理共享 `thread_id`，首次调用注入 briefContext 后会被 checkpoint 持久化。后续调用时 briefContext 已在历史消息中，无需重复注入。可通过检查 checkpoint 历史是否已有 `injectedBy: 'SubAgentContext'` 的消息来判断是否跳过注入。

**服务端和前端三重过滤**：

1. **服务端 `agentWorker.ts`**：`isFilterableMessage`（6.2 改造后）过滤 `response_metadata.injectedBy` 存在的消息 ✓
2. **服务端 `threadState.ts`**：
   - `getThreadValuesService` 已过滤 `injectedBy` 以 `ModuleContext`/`CaseMaterial` 开头的消息，需**新增 `SubAgentContext` 前缀**
   - **`loadSubAgentThreads` 当前完全无过滤**（子代理线程消息直接 `map(messageToFlatDict)` 原样返回）✗ — 需修复
3. **前端 `useMessageParser.ts`**：需**新增 `SubAgentContext` 前缀**到过滤列表

**`loadSubAgentThreads` 改造**（修复缺失的过滤逻辑）：

```typescript
// threadState.ts - loadSubAgentThreads
// 当前：subRawMessages.map(messageToFlatDict) — 无过滤
// 改为：先映射再过滤
const filteredMessages = subRawMessages
  .map(messageToFlatDict)
  .filter(msg => {
    if (msg.type === 'system') return false
    if (msg.response_metadata?.injectedBy) return false
    return true
  })

subAgentThreads.push({
  toolCallId: toolCall.id as string,
  agentName: safeName,
  threadId: subThreadId,
  messages: filteredMessages,
})
```

**`getThreadValuesService` 改造**（新增 SubAgentContext 前缀）：

```typescript
// threadState.ts - getThreadValuesService
// 当前只过滤 ModuleContext 和 CaseMaterial 前缀
// 改为同时过滤 SubAgentContext
if (injector?.startsWith('ModuleContext')
  || injector?.startsWith('CaseMaterial')
  || injector?.startsWith('SubAgentContext')
) {
  return false
}
```

**`useMessageParser.ts` 改造**（前端新增 SubAgentContext 前缀）：

```typescript
// app/components/ai/composables/useMessageParser.ts
if (injector?.startsWith('ModuleContext')
  || injector?.startsWith('CaseMaterial')
  || injector?.startsWith('SubAgentContext')  // 新增
) {
  return false
}
```

---

## 六、Layer 5：基础设施层改造

### 6.1 `storage.ts` 迁移到 Redis

**文件**：`server/services/workflow/state/storage.ts`

```typescript
const STORAGE_PREFIX = 'session_state:'
const STORAGE_TTL = 3600 * 2  // 2 小时过期

export async function getSessionState(
  sessionId: string
): Promise<Record<string, any> | null> {
  const redis = getRedisClient()
  const raw = await redis.get(`${STORAGE_PREFIX}${sessionId}`)
  return raw ? JSON.parse(raw) : null
}

export async function updateSessionState(
  sessionId: string,
  updates: Record<string, any>
): Promise<void> {
  const redis = getRedisClient()
  const key = `${STORAGE_PREFIX}${sessionId}`
  const current = await getSessionState(sessionId)
  const merged = { ...current, ...updates }
  await redis.set(key, JSON.stringify(merged), 'EX', STORAGE_TTL)
}

export async function deleteSessionState(
  sessionId: string
): Promise<void> {
  const redis = getRedisClient()
  await redis.del(`${STORAGE_PREFIX}${sessionId}`)
}
```

**接口签名变更**：`getSessionState` 和 `updateSessionState` 从同步改为 `async`。调用方影响分析：

| 调用方 | 文件 | 当前调用方式 | 是否需要修改 |
|--------|------|-------------|-------------|
| `moduleAgent.ts:82` | `getState: async () => getSessionState(sessionId)` | 已包裹在 async，兼容 | 否 |
| `pointConsumption.middleware.ts:207` | `updateSessionState(sessionId, newState)` | 需添加 `await` | 是 |
| `pointConsumption.middleware.ts:242` | `updateSessionState(sessionId, newState)` | 需添加 `await` | 是 |
| `pointConsumption.middleware.ts:258` | `updateSessionState(sessionId, newState)` | 需添加 `await` | 是 |

移除原有的 `Map<string, Record<string, any>>`。

### 6.2 Worker 过滤逻辑完善

**文件**：`server/services/agent/agentWorker.ts`

#### 6.2.1 扩展消息过滤范围

```typescript
/**
 * 判断消息是否应被过滤（system 消息 + 注入的 HumanMessage）。
 * 双保险：前端 useMessageParser 也会过滤注入消息。
 */
function isFilterableMessage(msg: unknown): boolean {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as Record<string, unknown>

  // system 消息
  if (m.type === 'system') return true
  if (
    m.data
    && typeof m.data === 'object'
    && (m.data as Record<string, unknown>).type === 'system'
  ) return true

  // 注入的 HumanMessage
  const metadata = (m as any).response_metadata
    || (m as any).data?.response_metadata
  if (metadata?.injectedBy) return true

  return false
}
```

#### 6.2.2 `updates` 事件也过滤

```typescript
function stripFilterableMessages(
  event: string,
  data: unknown
): unknown | null {
  if (!data || typeof data !== 'object') return data

  // values 和 updates 事件：过滤 messages 数组
  if (event === 'values' || event === 'updates') {
    const d = data as Record<string, unknown>
    if (Array.isArray(d.messages)) {
      return {
        ...d,
        messages: d.messages.filter(m => !isFilterableMessage(m)),
      }
    }
    return data
  }

  // messages 事件
  if (event === 'messages') {
    if (Array.isArray(data)) {
      const filtered = (data as unknown[]).filter(
        m => !isFilterableMessage(m)
      )
      return filtered.length > 0 ? filtered : null
    }
    if (isFilterableMessage(data)) return null
    return data
  }

  return data
}
```

#### 6.2.3 session 为 null 时报错

```typescript
// 原来
if (session?.type === 2) { ... }
else if (session?.type === 3) { ... }
else { ... runCaseChat }

// 改为
if (!session) {
  throw new Error(`Session not found for run ${run.id}, sessionId: ${input.sessionId}`)
}
if (session.type === 2) { ... }
else if (session.type === 3) { ... }
else { ... runCaseChat }
```

### 6.3 死代码处理

#### `messageCompressor.ts`

- `compressMessages`：保留，集成到 `safetyTrimMiddleware`（4.3）作为第一道防线
- `safetyTrimMessages`：保留，作为第二道防线
- `trimByEstimation`：保留，作为最终兜底
- `getContextBudget`：保留但标记为 V2 路径专用。`getContextBudget` 返回 `{budget, compressThreshold}`（用于消息压缩判断），与 Layer 4 的 `allocateBudget`（用于上下文 section 分配）语义不同，两者各自服务于不同场景，不构成重复。V2 路径中 `caseAnalysisV2.workflow.ts` 继续使用 `getContextBudget`，V1 路径和 `moduleContextBuilder` 使用 `allocateBudget`。

#### `caseAnalysis.ts`

- 移除 `extractRuntimeConfig` 中的 `prompt` 字段（3.2）

---

## 七、测试策略

### 7.1 工具层测试

```typescript
// toolResultTruncator.test.ts
describe('truncateToTokenLimit', () => {
  it('中文文本精确截断到 token 上限', async () => {
    const text = '法律条文内容'.repeat(5000) // 约 10000 tokens
    const result = truncateToTokenLimit(text, 8000)
    expect(countTokensSync(result)).toBeLessThanOrEqual(8100) // 含截断提示
  })

  it('英文文本精确截断到 token 上限', async () => {
    const text = 'Legal content '.repeat(5000)
    const result = truncateToTokenLimit(text, 8000)
    expect(countTokensSync(result)).toBeLessThanOrEqual(8100)
  })

  it('短文本不截断', () => {
    const text = '短文本'
    expect(truncateToTokenLimit(text, 8000)).toBe(text)
  })
})

// searchLaw.tool.test.ts
describe('searchLaw k 参数验证', () => {
  it('k > 10 被拒绝', () => {
    expect(() => schema.parse({ query: 'test', k: 15 })).toThrow()
  })
})
```

### 7.2 提示词层测试

```typescript
// promptRenderer.test.ts
describe('renderSystemPrompt', () => {
  it('替换已知变量', () => {
    const config = { prompts: [{ type: 'system', status: 1, content: '案件 {{caseId}} 分析' }] }
    expect(renderSystemPrompt(config, { caseId: 123 })).toBe('案件 123 分析')
  })

  it('未替换变量记录 warn 日志', () => {
    const config = { prompts: [{ type: 'system', status: 1, content: '{{unknown}} 分析' }] }
    renderSystemPrompt(config, {})
    expect(logger.warn).toHaveBeenCalledWith(
      '系统提示词存在未替换的模板变量',
      expect.objectContaining({ unreplacedVars: ['{{unknown}}'] })
    )
  })
})
```

### 7.3 中间件层测试

```typescript
// cleanPreviousInjections.test.ts
describe('cleanPreviousInjections', () => {
  it('清除指定前缀的注入消息，保留其他消息', () => {
    const messages = [
      new SystemMessage('prompt'),
      new HumanMessage({ content: 'context', response_metadata: { injectedBy: 'CaseMaterialContext:xxx' } }),
      new HumanMessage('用户消息'),
      new AIMessage('AI 回复'),
    ]
    const cleaned = cleanPreviousInjections(messages, 'CaseMaterialContext')
    expect(cleaned).toHaveLength(3) // system + human + ai
  })
})

// safetyTrimMiddleware.test.ts
describe('safetyTrimMiddleware', () => {
  it('消息在预算内时不截断', async () => { ... })
  it('超出预算时触发压缩', async () => { ... })
})
```

### 7.4 基础设施层测试

```typescript
// storage.test.ts
describe('Redis session storage', () => {
  it('读写状态', async () => {
    await updateSessionState('session-1', { key: 'value' })
    const state = await getSessionState('session-1')
    expect(state).toEqual({ key: 'value' })
  })

  it('合并更新', async () => {
    await updateSessionState('session-1', { a: 1 })
    await updateSessionState('session-1', { b: 2 })
    expect(await getSessionState('session-1')).toEqual({ a: 1, b: 2 })
  })

  it('TTL 过期后返回 null', async () => { ... })
})
```

---

## 八、实施顺序

| 阶段 | Layer | 涉及文件 | 依赖 |
|------|-------|----------|------|
| 1 | 工具层 | `searchLaw.tool.ts`, `searchCaseMaterials.tool.ts`, `toolResultTruncator.ts` | 无 |
| 2 | 提示词层 | 新增 `promptRenderer.ts`, `caseMainAgent.ts`, `moduleAgent.ts`, `caseAnalysis.ts`, `subAgentToolFactory.ts` | 无 |
| 3 | 中间件层 | 新增 `middleware/utils.ts`, `safetyTrim.middleware.ts`, `middleware/types.ts`, 改造 4 个中间件和 4 个 Agent | 依赖 Layer 1（tokenCounter） |
| 4 | 上下文层 | `moduleContextBuilder.ts`, `subAgentToolFactory.ts` | 依赖 Layer 1（tokenCounter） |
| 5 | 基础设施 | `storage.ts`, `agentWorker.ts`, `messageCompressor.ts` | 依赖 Redis |

Layer 1 和 Layer 2 可并行实施。Layer 3-5 顺序执行。

---

## 九、风险与回滚

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| tiktoken 二分查找性能 | 工具调用延迟增加 | 设置 100ms 超时，降级到字符估算 |
| 增量注入消息累积 | 长对话中注入消息逐渐膨胀 | summarizationMiddleware（4.2）+ safetyTrimMiddleware（4.3）兜底压缩，历史注入消息在摘要时被合并 |
| 子代理上下文泄露 | 子代理注入的上下文可能暴露到前端 | 服务端 + 前端双重过滤（system prompt 过滤 + injectedBy 过滤） |
| Redis 连接故障 | storage 不可用 | 添加内存 Map fallback（降级模式） |
| summarization 动态阈值过低 | 频繁触发摘要影响响应速度 | 设置下限 `Math.max(triggerTokens, 30000)` |
