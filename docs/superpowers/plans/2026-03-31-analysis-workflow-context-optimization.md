# 分析工作流上下文优化 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 caseAnalysisV2 工作流的上下文管理——为每个分析模块注入丰富的案件上下文，并在模块内部实现三道防线防止超出模型上下文限制。

**Architecture:** 两层防御——模块间完全隔离（每个模块独立从 DB 构建上下文，不依赖外层 state.messages）+ 模块内三道防线（预防控制 → 动态摘要 → trimMessages 兜底）。所有压缩仅影响 LLM 输入，不修改 state，前端始终看到原始消息。

**Tech Stack:** LangGraph StateGraph + @langchain/core/messages (trimMessages, RemoveMessage) + PostgresStore + Prisma

**Spec:** `docs/superpowers/specs/2026-03-31-analysis-workflow-context-optimization-design.md`

**踩坑参考:** `docs/init-analysis-workflow-report.md`（坑1-14）

---

**注意**：DB 中模型的 `context_window` 值由用户自行维护，不在本计划范围内。

---

### Task 1: NodeConfig 新增 modelContextWindow 字段

**Files:**
- Modify: `server/services/node/node.service.ts:62-99` (NodeConfig 接口)
- Modify: `server/services/node/node.service.ts:397-427` (getNodeConfigService 映射)
- Modify: `server/services/node/node.service.ts:586-616` (getNodeConfigsByTypes 映射)

- [ ] **Step 1: 在 NodeConfig 接口添加字段**

在 `server/services/node/node.service.ts` 第 98 行（`outputSchema` 之后）添加：

```typescript
/** 模型上下文窗口大小（tokens） */
modelContextWindow?: number
```

- [ ] **Step 2: 在 getNodeConfigService 映射中补充读取**

在 `server/services/node/node.service.ts` 第 427 行（`outputSchema` 映射之后）添加：

```typescript
modelContextWindow: nodeConfig.model.contextWindow ?? undefined,
```

- [ ] **Step 3: 在 getNodeConfigsByTypes 映射中补充读取**

在 `server/services/node/node.service.ts` 第 615 行（`outputSchema` 映射之后）添加：

```typescript
modelContextWindow: node.model!.contextWindow ?? undefined,
```

- [ ] **Step 4: 类型检查**

Run: `npx nuxi typecheck`
Expected: PASS（无新增类型错误）

- [ ] **Step 5: 提交**

```bash
git add server/services/node/node.service.ts
git commit -m "feat(node): NodeConfig 新增 modelContextWindow 字段"
```

---

### Task 2: 工具返回结果截断 (toolResultTruncator)

**Files:**
- Create: `server/services/workflow/context/toolResultTruncator.ts`
- Modify: `server/services/workflow/tools/searchCaseMaterials.tool.ts`

- [ ] **Step 1: 创建 toolResultTruncator.ts**

Create `server/services/workflow/context/toolResultTruncator.ts`:

```typescript
/**
 * 工具返回结果截断
 *
 * 在序列化之前限制每条结果的内容长度，避免破坏 JSON 格式
 * 用于防止单次工具返回超长内容导致上下文膨胀
 */

import { estimateTokens } from '../../material/materialPipeline.service'

/** 单条结果内容的默认最大 token 数 */
const DEFAULT_MAX_TOKENS_PER_ITEM = 8000

/** 截断提示信息 */
const TRUNCATION_HINT = '\n\n[内容过长已截断，请使用更精确的查询条件或指定 sourceId 重新检索]'

export interface TruncateOptions {
    /** 单条结果内容的最大 token 数，默认 8000 */
    maxTokensPerItem?: number
}

/**
 * 截断工具返回结果列表中每条内容
 *
 * 在序列化前对每条结果的 content 字段做长度控制
 * 不截断 JSON 字符串本身，确保格式完整
 */
export function truncateToolResults<T extends { content: string }>(
    results: T[],
    options: TruncateOptions = {},
): T[] {
    const maxTokens = options.maxTokensPerItem ?? DEFAULT_MAX_TOKENS_PER_ITEM

    return results.map(item => {
        const tokens = estimateTokens(item.content)
        if (tokens <= maxTokens) return item

        // 按 token 估算截断位置（中文 ~2 char/token，英文 ~4 char/token，取中间值 3）
        const maxChars = maxTokens * 3
        const truncatedContent = item.content.slice(0, maxChars) + TRUNCATION_HINT

        return { ...item, content: truncatedContent }
    })
}
```

- [ ] **Step 2: 修改 searchCaseMaterials.tool.ts 应用截断**

在 `server/services/workflow/tools/searchCaseMaterials.tool.ts` 中：

1. 添加导入（第 12 行后）：
```typescript
import { truncateToolResults } from '../context/toolResultTruncator'
```

2. 将第 55 行 `return JSON.stringify(results)` 替换为：
```typescript
const truncated = truncateToolResults(results)
return JSON.stringify(truncated)
```

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add server/services/workflow/context/toolResultTruncator.ts server/services/workflow/tools/searchCaseMaterials.tool.ts
git commit -m "feat(workflow): 新增工具返回结果截断机制"
```

---

### Task 3: 模块上下文构建器 (moduleContextBuilder)

**Files:**
- Create: `server/services/workflow/context/moduleContextBuilder.ts`

**依赖的现有模块（不修改）：**
- `server/services/case/case.service.ts` → `getCaseByIdService`
- `server/services/material/material.service.ts` → `getMaterialsByCaseIdService`
- `server/services/material/materialPipeline.service.ts` → `getMaterialContextService`, `buildMaterialContextMessage`
- `server/services/case/initAnalysis.service.ts` → `loadCompletedResultsService`
- `server/services/workflow/checkpointer.ts` → `getStore`
- `shared/types/initAnalysis.ts` → `INIT_ANALYSIS_MODULES`

- [ ] **Step 1: 创建 moduleContextBuilder.ts**

Create `server/services/workflow/context/moduleContextBuilder.ts`:

```typescript
/**
 * 模块上下文构建器
 *
 * 为每个分析模块独立从 DB 构建完整上下文
 * 包括：案件基本信息、材料上下文、已完成的分析结果、案件长期记忆
 *
 * 每类上下文独立 try-catch，失败降级为空并 log warning
 * 不中断模块执行
 */

import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import { getCaseByIdService } from '../../case/case.service'
import { getMaterialsByCaseIdService } from '../../material/material.service'
import { getMaterialContextService, buildMaterialContextMessage } from '../../material/materialPipeline.service'
import { loadCompletedResultsService } from '../../case/initAnalysis.service'
import { getStore } from '../checkpointer'

interface ModuleContextParams {
    caseId: number
    agentName: string
}

/**
 * 从 DB 构建模块上下文
 *
 * 返回结构化的上下文文本，合并到 system prompt 中
 * 空 section 自动省略
 */
export async function buildModuleContext(params: ModuleContextParams): Promise<string> {
    const { caseId, agentName } = params
    const sections: string[] = []

    // 1. 案件基本信息
    const caseInfoSection = await buildCaseInfoSection(caseId)
    if (caseInfoSection) sections.push(caseInfoSection)

    // 2. 案件材料上下文
    const materialSection = await buildMaterialSection(caseId)
    if (materialSection) sections.push(materialSection)

    // 3. 已完成的分析结果（排除当前模块）
    const resultsSection = await buildCompletedResultsSection(caseId, agentName)
    if (resultsSection) sections.push(resultsSection)

    // 4. 案件长期记忆
    const memorySection = await buildMemorySection(caseId)
    if (memorySection) sections.push(memorySection)

    return sections.join('\n\n')
}

/** 案件基本信息 */
async function buildCaseInfoSection(caseId: number): Promise<string | null> {
    try {
        const caseRecord = await getCaseByIdService(caseId)
        if (!caseRecord) return null

        const lines: string[] = ['## 案件基本信息']

        if (caseRecord.title) lines.push(`- 标题：${caseRecord.title}`)
        if (caseRecord.caseType?.name) lines.push(`- 案件类型：${caseRecord.caseType.name}`)

        const plaintiff = caseRecord.plaintiff as string[] | null
        if (plaintiff?.length) lines.push(`- 原告：${plaintiff.join('、')}`)

        const defendant = caseRecord.defendant as string[] | null
        if (defendant?.length) lines.push(`- 被告：${defendant.join('、')}`)

        if (caseRecord.summary) lines.push(`- 案件概述：${caseRecord.summary}`)

        // extractedInfo 中的扩展信息
        const extracted = caseRecord.extractedInfo as Record<string, unknown> | null
        if (extracted) {
            for (const [key, value] of Object.entries(extracted)) {
                if (['title', 'plaintiff', 'defendant', 'summary', 'caseType'].includes(key)) continue
                if (value && typeof value === 'string') {
                    lines.push(`- ${key}：${value}`)
                }
            }
        }

        return lines.length > 1 ? lines.join('\n') : null
    } catch (error) {
        logger.warn('构建案件基本信息失败，降级为空', { caseId, error })
        return null
    }
}

/** 案件材料上下文 */
async function buildMaterialSection(caseId: number): Promise<string | null> {
    try {
        const materials = await getMaterialsByCaseIdService(caseId)
        if (!materials.length) return null

        const context = await getMaterialContextService(materials)
        if (context.mode === 'empty') return null

        return '## 案件材料\n' + buildMaterialContextMessage(context)
    } catch (error) {
        logger.warn('构建材料上下文失败，降级为空', { caseId, error })
        return null
    }
}

/** 已完成的分析结果（排除当前模块） */
async function buildCompletedResultsSection(caseId: number, excludeModule: string): Promise<string | null> {
    try {
        const results = await loadCompletedResultsService(caseId)
        // 排除当前模块的旧结果（不可变方式）
        const entries = Object.entries(results).filter(([key]) => key !== excludeModule)
        if (!entries.length) return null

        const lines: string[] = ['## 已完成的分析结果']
        for (const [moduleName, resultText] of entries) {
            const moduleInfo = INIT_ANALYSIS_MODULES.find(m => m.name === moduleName)
            const title = moduleInfo?.title ?? moduleName
            lines.push(`### ${title}（${moduleName}）`)
            lines.push(resultText)
        }

        return lines.join('\n')
    } catch (error) {
        logger.warn('构建已完成分析结果失败，降级为空', { caseId, error })
        return null
    }
}

/**
 * 获取案件长期记忆
 *
 * 从 PostgresStore 读取案件的 basic_info 记忆
 * namespace: ['cases', '<caseId>'], key: 'basic_info'
 * 与 caseExtraction.service.ts 中 saveCaseInfoService 对应
 */
export async function getCaseMemory(caseId: number): Promise<string | null> {
    const store = await getStore()
    const item = await store.get(['cases', String(caseId)], 'basic_info')
    if (!item?.value?.text) return null
    return item.value.text as string
}

/** 案件长期记忆 */
async function buildMemorySection(caseId: number): Promise<string | null> {
    try {
        const memoryText = await getCaseMemory(caseId)
        if (!memoryText) return null

        return '## 案件记忆\n' + memoryText
    } catch (error) {
        logger.warn('构建案件记忆失败，降级为空', { caseId, error })
        return null
    }
}
```

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add server/services/workflow/context/moduleContextBuilder.ts
git commit -m "feat(workflow): 新增模块上下文构建器"
```

---

### Task 4: 消息压缩器 (messageCompressor)

**Files:**
- Create: `server/services/workflow/context/messageCompressor.ts`

- [ ] **Step 1: 创建 messageCompressor.ts**

Create `server/services/workflow/context/messageCompressor.ts`:

```typescript
/**
 * 消息压缩器
 *
 * 为 innerGraph 的 callModel 节点提供上下文压缩能力
 * 所有压缩仅影响传给 LLM 的输入，不修改 state 中的消息
 *
 * 三道防线：
 * 1. 预防控制（由 toolResultTruncator 和 materialPipeline 负责）
 * 2. 动态摘要（本模块 compressMessages）
 * 3. trimMessages 兜底（本模块 safetyTrimMessages）
 */

import { trimMessages } from '@langchain/core/messages'
import { HumanMessage, type BaseMessage, isAIMessage } from '@langchain/core/messages'
import { estimateTokens } from '../../material/materialPipeline.service'

/** 默认上下文预算 100K tokens */
const DEFAULT_CONTEXT_BUDGET = 100000

/** 压缩触发阈值为预算的 60% */
const COMPRESS_RATIO = 0.6

/** 保留最近 N 轮消息不压缩（1 轮 = AI + tool_call + tool_response） */
const KEEP_RECENT_ROUNDS = 3

/**
 * 估算消息列表的总 token 数
 *
 * 用于粗判是否需要压缩（快速，基于字符估算）
 */
export function estimateMessagesTokens(messages: BaseMessage[]): number {
    return messages.reduce((sum, m) => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        return sum + estimateTokens(content) + 10 // +10 for message overhead
    }, 0)
}

/**
 * 根据模型配置获取上下文预算
 */
export function getContextBudget(contextWindow?: number): {
    budget: number
    compressThreshold: number
} {
    const windowSize = contextWindow ?? DEFAULT_CONTEXT_BUDGET
    const budget = Math.floor(windowSize * 0.8) // 预留 20% 给输出
    const compressThreshold = Math.floor(budget * COMPRESS_RATIO)
    return { budget, compressThreshold }
}

/**
 * 压缩消息列表
 *
 * 保留 system message + 最近 N 轮消息
 * 将中间的工具调用轮次用 LLM 生成结构化摘要替代
 * 仅返回压缩后的副本，不修改原始消息
 *
 * @param messages 完整消息列表
 * @param budget 上下文 token 预算
 * @param model 用于生成摘要的模型实例（复用当前模块模型）
 */
export async function compressMessages(
    messages: BaseMessage[],
    budget: number,
    model: any,
): Promise<BaseMessage[]> {
    if (messages.length <= KEEP_RECENT_ROUNDS * 3 + 2) {
        // 消息太少，不需要压缩
        return messages
    }

    // 分离：system message, 中间消息, 最近 N 轮
    const systemMessage = messages[0] // system prompt 始终在第一位
    const recentCount = KEEP_RECENT_ROUNDS * 3 // 每轮约 3 条消息
    const recentMessages = messages.slice(-recentCount)
    const middleMessages = messages.slice(1, -recentCount)

    if (middleMessages.length === 0) {
        return messages
    }

    // 用模型生成中间消息的摘要
    try {
        const summaryPrompt = buildSummaryPrompt(middleMessages)
        const summaryResponse = await model.invoke([
            { role: 'system', content: '你是一个信息压缩助手。请将以下工具调用和对话内容压缩为结构化摘要，保留所有关键发现和数据点。' },
            new HumanMessage(summaryPrompt),
        ])

        const summaryContent = typeof summaryResponse.content === 'string'
            ? summaryResponse.content
            : JSON.stringify(summaryResponse.content)

        const summaryMessage = new HumanMessage(
            `[以下是之前工具调用和分析过程的摘要]\n${summaryContent}`,
        )

        return [systemMessage, summaryMessage, ...recentMessages]
    } catch (error) {
        logger.warn('消息摘要压缩失败，回退到 trimMessages', { error })
        // 摘要失败，直接返回原始消息，让 safetyTrimMessages 兜底
        return messages
    }
}

/**
 * trimMessages 安全网
 *
 * 确保消息列表不超过模型上下文预算
 * 使用模型 tokenizer 精确计数
 */
export async function safetyTrimMessages(
    messages: BaseMessage[],
    budget: number,
    model: any,
): Promise<BaseMessage[]> {
    try {
        return trimMessages(messages, {
            strategy: 'last',
            maxTokens: budget,
            startOn: 'human',
            endOn: ['human', 'tool'],
            tokenCounter: model,
        })
    } catch (error) {
        // trimMessages 失败（如模型不支持 tokenCounter），回退到字符估算裁剪
        logger.warn('trimMessages 失败，使用字符估算裁剪', { error })
        return trimByEstimation(messages, budget)
    }
}

/** 基于字符估算的裁剪（最后兜底，始终保留 system message） */
function trimByEstimation(messages: BaseMessage[], budget: number): BaseMessage[] {
    if (messages.length === 0) return messages

    // 始终保留 system message（第一条）
    const systemMsg = messages[0]
    const systemContent = typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content)
    let totalTokens = estimateTokens(systemContent) + 10
    const result: BaseMessage[] = [systemMsg]

    // 从后往前保留其余消息，确保最近的消息优先
    const rest: BaseMessage[] = []
    for (let i = messages.length - 1; i >= 1; i--) {
        const msg = messages[i]
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        const tokens = estimateTokens(content) + 10
        if (totalTokens + tokens > budget && rest.length > 0) break
        rest.unshift(msg)
        totalTokens += tokens
    }

    return [...result, ...rest]
}

/** 构建摘要提示词 */
function buildSummaryPrompt(messages: BaseMessage[]): string {
    const lines: string[] = ['请将以下对话内容压缩为结构化摘要：\n']

    for (const msg of messages) {
        const type = msg.getType?.() ?? 'unknown'
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)

        if (type === 'ai' && isAIMessage(msg) && msg.tool_calls?.length) {
            lines.push(`[AI 调用工具] ${msg.tool_calls.map(tc => tc.name).join(', ')}`)
        } else if (type === 'tool') {
            // 截断过长的工具返回
            const truncated = content.length > 2000 ? content.slice(0, 2000) + '...(截断)' : content
            lines.push(`[工具返回] ${truncated}`)
        } else if (type === 'ai') {
            lines.push(`[AI 回复] ${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`)
        } else {
            lines.push(`[${type}] ${content.slice(0, 300)}${content.length > 300 ? '...' : ''}`)
        }
    }

    lines.push('\n请输出结构化摘要，格式：\n[工具调用摘要] 查询了XXX，发现：（1）...（2）...')
    return lines.join('\n')
}
```

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add server/services/workflow/context/messageCompressor.ts
git commit -m "feat(workflow): 新增消息压缩器（动态摘要 + trimMessages 兜底）"
```

---

### Task 5: 改造 caseAnalysisV2.workflow.ts

这是核心改造，将前面 Task 1-4 的成果集成到工作流中。

**Files:**
- Modify: `server/services/workflow/caseAnalysisV2.workflow.ts`

**改造点：**
1. 在 `createAnalysisNode` 中调用 `buildModuleContext` 构建富上下文
2. 将上下文合并到 system prompt
3. 改造 `callModel` 加入压缩逻辑
4. 降低 `recursionLimit` 到 50

**已确认**：`caseAnalysisV2.workflow.ts` 不使用 `caseMaterialContextMiddleware`（该中间件仅用于其他工作流如 caseAnalysis.ts 和 initAnalysis.executor.ts），因此不存在材料上下文重复注入的问题。

- [ ] **Step 1: 添加导入**

在 `server/services/workflow/caseAnalysisV2.workflow.ts` 文件顶部导入区域（约第 8-9 行）添加：

```typescript
import { buildModuleContext } from './context/moduleContextBuilder'
import { estimateMessagesTokens, getContextBudget, compressMessages, safetyTrimMessages } from './context/messageCompressor'
```

- [ ] **Step 2: 改造 initialMessages 构建**

在 `createAnalysisNode` 函数内部，将第 292-295 行：

```typescript
const initialMessages = [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    new HumanMessage(state.prompt ?? `现在请开始任务：${moduleTitle}`),
]
```

替换为：

```typescript
// 构建模块上下文（案件信息 + 材料 + 已完成分析结果 + 记忆）
const moduleContext = await buildModuleContext({
    caseId: state.caseId,
    agentName,
})

// 合并到 system prompt（被 Worker stripSystemMessages 自动过滤，不到达前端）
const enrichedSystemPrompt = [systemPrompt, moduleContext].filter(Boolean).join('\n\n')

const initialMessages = [
    ...(enrichedSystemPrompt ? [{ role: 'system' as const, content: enrichedSystemPrompt }] : []),
    new HumanMessage(`现在请开始"${moduleTitle}"分析。`),
]
```

- [ ] **Step 3: 改造 callModel 加入压缩逻辑**

将第 266-269 行的 `callModel`：

```typescript
const callModel = async (innerState: typeof InnerState.State) => {
    const response = await modelWithTools.invoke(innerState.messages)
    return { messages: [response] }
}
```

替换为：

```typescript
const { budget: contextBudget, compressThreshold } = getContextBudget(nodeConfig.modelContextWindow)

const callModel = async (innerState: typeof InnerState.State) => {
    let messagesToSend = innerState.messages

    // 防线2：动态摘要压缩
    const roughEstimate = estimateMessagesTokens(innerState.messages)
    if (roughEstimate > compressThreshold) {
        logger.info('触发消息压缩', { agentName, roughEstimate, compressThreshold })
        messagesToSend = await compressMessages(innerState.messages, contextBudget, model)
    }

    // 防线3：trimMessages 兜底
    messagesToSend = await safetyTrimMessages(messagesToSend, contextBudget, model)

    const response = await modelWithTools.invoke(messagesToSend)
    return { messages: [response] }  // state 保留完整历史
}
```

- [ ] **Step 4: 降低 recursionLimit**

将第 299 行的 `{ recursionLimit: 1000 }` 修改为 `{ recursionLimit: 50 }`。

- [ ] **Step 5: 类型检查**

Run: `npx nuxi typecheck`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add server/services/workflow/caseAnalysisV2.workflow.ts
git commit -m "feat(workflow): 集成模块上下文构建和消息压缩到分析工作流"
```

---

### Task 6: 端到端验证

**无代码修改，纯验证步骤。**

- [ ] **Step 1: 启动开发服务器**

Run: `bun dev`

- [ ] **Step 2: 测试正常分析流程**

1. 打开浏览器，选择一个有材料的案件
2. 选择 2-3 个分析模块，点击开始分析
3. 验证：
   - 模块按顺序执行
   - 前端消息列表显示完整的工具调用过程
   - **不显示** system prompt 或 moduleContext 内容
   - 后续模块的分析质量有明显提升（引用了案件信息和前序模块结果）

- [ ] **Step 3: 测试刷新恢复**

1. 分析进行中刷新页面
2. 验证：
   - 模块状态正确恢复
   - 消息列表显示原始完整消息（非压缩摘要）
   - 可以继续分析

- [ ] **Step 4: 检查 SSE 数据安全**

1. 打开 DevTools → Network → 查看 SSE 流
2. 验证：
   - SSE 数据中**不包含** system prompt 内容
   - SSE 数据中**不包含** moduleContext（案件基本信息等）
   - 只有 HumanMessage 和 AI 回复/工具调用可见

- [ ] **Step 5: 测试积分中断恢复**

1. 设置用户积分为 0
2. 开始分析，验证积分不足弹窗出现
3. 充值积分后点击继续
4. 验证分析正常继续完成

- [ ] **Step 6: 提交验证通过标记**

```bash
git commit --allow-empty -m "test(workflow): 端到端验证通过——上下文注入、压缩、安全过滤、积分中断"
```
