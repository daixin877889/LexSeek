# 上下文工程全量优化实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复工作流和 Agent 中的 14 个上下文工程问题，涵盖工具截断、提示词渲染、中间件兜底、上下文预算和消息过滤。

**Architecture:** 逐层加固策略 — Layer 1(工具) → Layer 2(提示词) → Layer 3(中间件) → Layer 4(上下文) → Layer 5(基础设施)。Layer 1/2 可并行，Layer 3-5 顺序执行。

**Tech Stack:** TypeScript, LangGraph (langchain), tiktoken (js-tiktoken), Redis, Prisma, Vitest

**Spec:** `docs/superpowers/specs/2026-04-09-context-engineering-optimization-design.md` v1.10

---

## Task 1: toolResultTruncator 切换到 tiktoken 精确截断

**问题:** #6 — `maxTokens * 3` 字符估算中文偏差 2 倍

**Files:**
- Modify: `server/services/workflow/context/toolResultTruncator.ts`
- Test: `tests/server/workflow/toolResultTruncator.test.ts`

- [ ] **Step 1: 编写测试文件**

```typescript
// tests/server/workflow/toolResultTruncator.test.ts
import { describe, it, expect } from 'vitest'
import { truncateToolResults } from '~/server/services/workflow/context/toolResultTruncator'
import { countTokensSync } from '~/server/utils/tokenCounter'

describe('truncateToolResults', () => {
  it('短内容不截断', () => {
    const results = [{ content: '短文本', score: 1, metadata: {} }]
    const truncated = truncateToolResults(results)
    expect(truncated[0].content).toBe('短文本')
  })

  it('中文长内容精确截断到 token 上限', () => {
    const longText = '中华人民共和国民法典第一编总则'.repeat(2000)
    const results = [{ content: longText, score: 1, metadata: {} }]
    const truncated = truncateToolResults(results, { maxTokensPerItem: 1000 })
    const tokens = countTokensSync(truncated[0].content)
    expect(tokens).toBeLessThanOrEqual(1050) // 含截断提示
    expect(truncated[0].content).toContain('[内容过长已截断')
  })

  it('英文长内容精确截断到 token 上限', () => {
    const longText = 'The court held that the defendant was liable for damages. '.repeat(1000)
    const results = [{ content: longText, score: 1, metadata: {} }]
    const truncated = truncateToolResults(results, { maxTokensPerItem: 1000 })
    const tokens = countTokensSync(truncated[0].content)
    expect(tokens).toBeLessThanOrEqual(1050)
  })

  it('保留非 content 字段不变', () => {
    const results = [{ content: '长'.repeat(50000), score: 0.95, metadata: { legal_name: '民法典' } }]
    const truncated = truncateToolResults(results, { maxTokensPerItem: 100 })
    expect(truncated[0].score).toBe(0.95)
    expect(truncated[0].metadata).toEqual({ legal_name: '民法典' })
  })

  it('多条结果各自独立截断', () => {
    const results = [
      { content: '短', score: 1, metadata: {} },
      { content: '长'.repeat(50000), score: 0.5, metadata: {} },
    ]
    const truncated = truncateToolResults(results, { maxTokensPerItem: 100 })
    expect(truncated[0].content).toBe('短')
    expect(truncated[1].content).toContain('[内容过长已截断')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/workflow/toolResultTruncator.test.ts --reporter=verbose`
Expected: FAIL — 当前字符估算逻辑导致截断不精确

- [ ] **Step 3: 改造 toolResultTruncator.ts**

替换 `estimateTokens` + `maxChars` 为 tiktoken 精确计算：

```typescript
// server/services/workflow/context/toolResultTruncator.ts
import { countTokens, countTokensSync } from '~/server/utils/tokenCounter'

const DEFAULT_MAX_TOKENS_PER_ITEM = 8000
const TRUNCATION_HINT = '\n\n[内容过长已截断，请使用更精确的查询条件或指定 sourceId 重新检索]'

// 模块加载时预热 tiktoken 编码器，避免 countTokensSync 首次 fallback 到字符估算
void countTokens('').catch(() => { /* 忽略预热失败 */ })

export interface TruncateOptions {
    maxTokensPerItem?: number
}

/**
 * 将文本精确截断到指定 token 上限。
 * 使用二分查找 + Unicode 码点数组避免 surrogate pair 截断。
 */
function truncateToTokenLimit(content: string, maxTokens: number): string {
    const tokens = countTokensSync(content)
    if (tokens <= maxTokens) return content

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
    return codePoints.slice(0, lo).join('') + TRUNCATION_HINT
}

export function truncateToolResults<T extends { content: string }>(
    results: T[],
    options: TruncateOptions = {},
): T[] {
    const maxTokens = options.maxTokensPerItem ?? DEFAULT_MAX_TOKENS_PER_ITEM
    return results.map(item => {
        const truncatedContent = truncateToTokenLimit(item.content, maxTokens)
        if (truncatedContent === item.content) return item
        return { ...item, content: truncatedContent }
    })
}
```

> **重要**：模块顶部的 `void countTokens('')` 预热调用确保 `countTokensSync` 不会在首次调用时 fallback 到字符估算（见 `server/utils/tokenCounter.ts:29-34`）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/workflow/toolResultTruncator.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/services/workflow/context/toolResultTruncator.ts tests/server/workflow/toolResultTruncator.test.ts
git commit -m "refactor(tools): toolResultTruncator 切换到 tiktoken 精确截断"
```

---

## Task 2: searchLaw 添加 k 上限和结果截断

**问题:** #2 #7 — searchLaw 无截断、k 无上限

**Files:**
- Modify: `server/services/workflow/tools/searchLaw.tool.ts`
- Modify: `server/services/workflow/tools/searchCaseMaterials.tool.ts`

- [ ] **Step 1: 修改 searchLaw.tool.ts**

1. `k` 参数添加 `.max(20)`
2. 返回前调用 `truncateToolResults`

```typescript
// schema 中 k 字段改为
k: z.number().max(20).optional().default(5).describe('返回结果数量，最多 20 条'),

// import 添加
import { truncateToolResults } from '../context/toolResultTruncator'

// createTool 内部，替换 return JSON.stringify(formattedResults) 为
const truncated = truncateToolResults(formattedResults, { maxTokensPerItem: 8000 })
return JSON.stringify(truncated)
```

- [ ] **Step 2: 修改 searchCaseMaterials.tool.ts**

`k` 参数添加 `.max(20)`：

```typescript
k: z.number().max(20).optional().default(5).describe('返回结果数量，默认为 5，最多 20 条'),
```

- [ ] **Step 3: 运行现有测试确认无回归**

Run: `npx vitest run tests/server/workflow --reporter=verbose`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add server/services/workflow/tools/searchLaw.tool.ts server/services/workflow/tools/searchCaseMaterials.tool.ts
git commit -m "fix(tools): searchLaw 添加结果截断，检索工具 k 上限对齐 Rerank MAX_RERANK_DOCS=20"
```

---

## Task 3: promptRenderer 统一渲染模板变量

**问题:** #1 — 模板变量 `{{xxx}}` 字面量进入模型

**Files:**
- Create: `server/services/workflow/utils/promptRenderer.ts`
- Test: `tests/server/workflow/promptRenderer.test.ts`
- Modify: `server/services/workflow/agents/caseMainAgent.ts`
- Modify: `server/services/workflow/agents/moduleAgent.ts`
- Modify: `server/services/workflow/agents/caseAnalysis.ts`
- Modify: `server/services/workflow/agents/subAgentToolFactory.ts`

- [ ] **Step 1: 编写测试**

```typescript
// tests/server/workflow/promptRenderer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderSystemPrompt } from '~/server/services/workflow/utils/promptRenderer'

// mock logger（与项目已有测试保持一致）
const mockLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
;(globalThis as any).logger = mockLogger

describe('renderSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('替换已知模板变量', () => {
    const config = { id: 1, name: 'test', prompts: [{ type: 'system', status: 1, content: '分析案件 {{caseId}} 的 {{moduleName}} 模块' }] }
    const result = renderSystemPrompt(config as any, { caseId: 42, moduleName: '案情概要' })
    expect(result).toBe('分析案件 42 的 案情概要 模块')
  })

  it('无模板变量时原样返回', () => {
    const config = { id: 1, name: 'test', prompts: [{ type: 'system', status: 1, content: '你是法律分析专家' }] }
    const result = renderSystemPrompt(config as any)
    expect(result).toBe('你是法律分析专家')
  })

  it('未替换变量记录 warn 日志', () => {
    const config = { id: 1, name: 'test', prompts: [{ type: 'system', status: 1, content: '{{unknown}} 分析' }] }
    renderSystemPrompt(config as any, {})
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '系统提示词存在未替换的模板变量',
      expect.objectContaining({ unreplacedVars: ['{{unknown}}'] })
    )
  })

  it('无 system prompt 时返回空字符串', () => {
    const config = { id: 1, name: 'test', prompts: [] }
    expect(renderSystemPrompt(config as any)).toBe('')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/workflow/promptRenderer.test.ts --reporter=verbose`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 promptRenderer.ts**

```typescript
// server/services/workflow/utils/promptRenderer.ts
import { renderContent } from '~/server/services/node/prompt.service'
import type { NodeConfig } from '~/server/services/node/node.service'

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
    context: PromptRenderContext = {},
): string {
    const raw = nodeConfig.prompts.find(
        p => p.type === 'system' && p.status === 1,
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

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/workflow/promptRenderer.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: 改造四个 Agent 文件**

在每个文件中：
1. 添加 `import { renderSystemPrompt } from '../utils/promptRenderer'`
2. 替换 `nodeConfig.prompts.find(p => p.type === 'system'...)?.content` 为 `renderSystemPrompt(nodeConfig, { caseId, moduleName })`

改造文件和对应行号（以当前代码为准，实施时需确认）：
- `caseMainAgent.ts` — 搜索 `prompts.find` 替换
- `moduleAgent.ts` — 搜索 `prompts.find` 替换
- `caseAnalysis.ts` — 搜索 `prompts.find` 替换
- `subAgentToolFactory.ts` — 搜索 `prompts.find` 替换

- [ ] **Step 6: 运行全量 workflow 测试**

Run: `npx vitest run tests/server/workflow --reporter=verbose`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add server/services/workflow/utils/promptRenderer.ts tests/server/workflow/promptRenderer.test.ts \
  server/services/workflow/agents/caseMainAgent.ts server/services/workflow/agents/moduleAgent.ts \
  server/services/workflow/agents/caseAnalysis.ts server/services/workflow/agents/subAgentToolFactory.ts
git commit -m "feat(prompt): 统一渲染系统提示词模板变量，未替换变量记录 warn 日志"
```

---

## Task 4: 移除 caseAnalysis.ts 无效 runtime prompt

**问题:** #9 — `prompt` 解构后无下游消费

**Files:**
- Modify: `server/services/workflow/agents/caseAnalysis.ts:24-31`

- [ ] **Step 1: 修改 extractRuntimeConfig**

```typescript
// 原来（第 24-31 行）
function extractRuntimeConfig(config?: LangGraphRunnableConfig) {
    const cfg = config?.configurable as Record<string, unknown> | undefined
    return {
        userId: cfg?.user_id as number | undefined,
        caseId: cfg?.case_id as number | undefined,
        prompt: cfg?.prompt as string | undefined,  // 移除此行
    }
}
```

- [ ] **Step 2: 运行测试**

Run: `npx vitest run tests/server/workflow --reporter=verbose`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add server/services/workflow/agents/caseAnalysis.ts
git commit -m "refactor(agent): 移除 caseAnalysis extractRuntimeConfig 无效的 prompt 字段"
```

---

## Task 5: summarization 阈值动态化

**问题:** #5 — 硬编码 100k 与小窗口模型不匹配

**Files:**
- Modify: `server/services/workflow/agents/caseMainAgent.ts:118-120`
- Modify: `server/services/workflow/agents/moduleAgent.ts:109-111`
- Modify: `server/services/workflow/agents/caseAnalysis.ts:108-110`
- Modify: `server/services/workflow/initAnalysis.executor.ts:149`

- [ ] **Step 1: 在四个文件中替换硬编码阈值**

每个文件搜索 `trigger: [{ tokens: 100000 }]`，替换为：

```typescript
const contextWindow = nodeConfig.modelContextWindow || 128000
const triggerTokens = Math.max(Math.floor(contextWindow * 0.6), 30000)
// ...
summarizationMiddleware({
    model,
    trigger: [{ tokens: triggerTokens }],
})
```

注意：`initAnalysis.executor.ts` 中 nodeConfig 的获取方式可能不同，实施时需确认 `modelContextWindow` 的来源。

- [ ] **Step 2: 运行测试**

Run: `npx vitest run tests/server/workflow --reporter=verbose`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add server/services/workflow/agents/caseMainAgent.ts server/services/workflow/agents/moduleAgent.ts \
  server/services/workflow/agents/caseAnalysis.ts server/services/workflow/initAnalysis.executor.ts
git commit -m "perf(middleware): summarization 阈值动态化，基于 modelContextWindow * 0.6 计算"
```

---

## Task 5.5: checkpoint 膨胀治理 — 增量注入健壮性

**问题:** #4 — 注入的 HumanMessage 持久化到 checkpoint 逐轮膨胀

**关键原则:** 绝不清除历史注入消息（保持 Prompt Caching 命中），仅追加增量变更。膨胀由 summarizationMiddleware + safetyTrimMiddleware 兜底。

**Files:**
- Modify: `server/services/workflow/middleware/caseMaterialContext.middleware.ts`
- Modify: `server/services/workflow/middleware/moduleContext.middleware.ts`

- [ ] **Step 1: 审查 caseMaterialContextMiddleware 增量逻辑**

确认当前实现已满足以下要点：
- 首次注入（`_injectedSourceIds` 为空）：全量注入材料上下文
- 增量注入（`_injectedSourceIds` 非空）：仅注入 `newSourceIds` 对应的新增材料
- 无变更时直接 return，不注入任何消息
- **确认不存在任何"清除历史注入"的代码**（如 `cleanPreviousInjections`、`filter` 掉旧注入消息等）

如果当前实现已满足，则只需增强 sourceId 去重的健壮性：

```typescript
// 确保 sourceId 去重使用 Set 而非 Array.includes（大数据量时性能更好）
const prevSet = new Set(prevSourceIds)
const newSourceIds = currentSourceIds.filter(id => !prevSet.has(id))
```

- [ ] **Step 2: 审查 moduleContextMiddleware 增量逻辑**

确认当前实现已满足以下要点：
- 4 类上下文并行加载 + hash 检测变更
- 只有 hash 变化的 section 才拼入新的注入消息
- 所有 section 都没有变化时直接 return
- 历史注入消息保持原样

如有不符合项，按 spec 4.1（第 298-324 行）改造。

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/server/workflow --reporter=verbose`
Expected: PASS

- [ ] **Step 4: 提交（如有改动）**

```bash
git add server/services/workflow/middleware/caseMaterialContext.middleware.ts \
  server/services/workflow/middleware/moduleContext.middleware.ts
git commit -m "fix(middleware): 增强增量注入健壮性，确保不清除历史注入消息"
```

---

## Task 6: safetyTrimMiddleware 兜底防线

**问题:** #3 #8 — messageCompressor 死代码、V1 缺兜底

**Files:**
- Create: `server/services/workflow/middleware/safetyTrim.middleware.ts`
- Modify: `server/services/workflow/agents/caseMainAgent.ts`
- Modify: `server/services/workflow/agents/moduleAgent.ts`
- Modify: `server/services/workflow/agents/caseAnalysis.ts`
- Modify: `server/services/workflow/initAnalysis.executor.ts`

- [ ] **Step 1: 创建 safetyTrim.middleware.ts**

```typescript
// server/services/workflow/middleware/safetyTrim.middleware.ts
import { createMiddleware } from 'langchain'
import { z } from 'zod'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BaseMessage } from '@langchain/core/messages'
import { compressMessages, safetyTrimMessages, estimateMessagesTokens } from '../context/messageCompressor'

/**
 * 安全截断中间件 — 作为 summarizationMiddleware 的兜底防线。
 * 使用 estimateMessagesTokens（同步字符估算）做快速预判，
 * 实际截断由 compressMessages/safetyTrimMessages 执行。
 *
 * 注意：
 * 1. compressMessages 不抛异常（消息过少、middle 为空、摘要失败时静默返回原消息）
 *    → 降级触发条件必须使用"压缩后是否仍超预算"而非 try-catch
 * 2. 使用 splice 原地修改 state.messages，对齐项目现有中间件写法
 */
export function safetyTrimMiddleware(options: { model: BaseChatModel; maxTokens: number }) {
    return createMiddleware({
        name: 'safetyTrimMiddleware',
        stateSchema: z.object({}),
        beforeAgent: {
            hook: async (state: { messages: BaseMessage[] }) => {
                const estimated = estimateMessagesTokens(state.messages)
                if (estimated <= options.maxTokens) return

                // 防线一：LLM 摘要压缩（不抛异常，需额外判断结果是否仍超预算）
                let replacement: BaseMessage[] | null = null
                try {
                    replacement = await compressMessages(
                        state.messages,
                        options.maxTokens,
                        options.model,
                    )
                } catch (error) {
                    // compressMessages 内部已捕获异常，此处是防御性编程
                    logger.warn('compressMessages 抛异常（意外路径），降级到 safetyTrim', { error })
                    replacement = null
                }

                // 防线二：如压缩失败或压缩后仍超预算，使用 trimMessages 强制截断
                const stillOverBudget = !replacement
                    || estimateMessagesTokens(replacement) > options.maxTokens
                if (stillOverBudget) {
                    replacement = await safetyTrimMessages(
                        replacement ?? state.messages,
                        options.maxTokens,
                    )
                }

                // 使用 splice 原地替换，与项目现有中间件修改方式一致
                state.messages.splice(0, state.messages.length, ...replacement)
            },
        },
    })
}
```

- [ ] **Step 2: 集成到四个 Agent 文件**

在每个文件的 middleware 数组中，在 `summarizationMiddleware` 之后添加 `safetyTrimMiddleware`：

```typescript
import { safetyTrimMiddleware } from '../middleware/safetyTrim.middleware'

middleware: [
    // ...existing middleware...
    summarizationMiddleware({ model, trigger: [{ tokens: triggerTokens }] }),
    safetyTrimMiddleware({ model, maxTokens: Math.floor(contextWindow * 0.8) }),
]
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/server/workflow --reporter=verbose`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add server/services/workflow/middleware/safetyTrim.middleware.ts \
  server/services/workflow/agents/caseMainAgent.ts server/services/workflow/agents/moduleAgent.ts \
  server/services/workflow/agents/caseAnalysis.ts server/services/workflow/initAnalysis.executor.ts
git commit -m "feat(middleware): 新增 safetyTrimMiddleware 作为 summarization 兜底防线"
```

---

## Task 7: 中间件顺序保障

**问题:** #12 — 中间件顺序为隐性约定

**Files:**
- Create: `server/services/workflow/middleware/types.ts`
- Modify: `server/services/workflow/middleware/index.ts`（导出新类型）

- [ ] **Step 1: 创建 middleware/types.ts**

按设计文档 4.4（第 423-473 行）创建，包含 `MiddlewareWithPriority`、`MIDDLEWARE_PRIORITY`、`MIDDLEWARE_NAMES`、`buildMiddlewareStack()`。

**类型来源说明**：`AgentMiddleware` 类型从 `langchain` 包导入，这是 `createMiddleware()` 的返回类型。导入示例：

```typescript
import type { AgentMiddleware } from 'langchain'
// 如果 langchain 未直接导出，使用 ReturnType 推导：
// type AgentMiddleware = ReturnType<typeof createMiddleware>
```

实施时先尝试 `import type { AgentMiddleware } from 'langchain'`，若类型不存在则改用 `ReturnType<typeof createMiddleware>`。

- [ ] **Step 2: 更新 middleware/index.ts 导出**

```typescript
export * from './types'
```

- [ ] **Step 3: 改造 initAnalysis.executor.ts 使用 buildMiddlewareStack**

将 `initAnalysis.executor.ts` 中每个模块 Agent 的 middleware 数组改为使用 `buildMiddlewareStack()`：

```typescript
import { buildMiddlewareStack, MIDDLEWARE_PRIORITY, MIDDLEWARE_NAMES } from '../middleware'

const middleware = buildMiddlewareStack([
    { name: MIDDLEWARE_NAMES.POINT_CONSUMPTION, priority: MIDDLEWARE_PRIORITY.POINT_CONSUMPTION, middleware: pointConsumptionMiddleware(...) },
    { name: MIDDLEWARE_NAMES.MATERIAL_CONTEXT, priority: MIDDLEWARE_PRIORITY.MATERIAL_CONTEXT, middleware: caseMaterialContextMiddleware(...) },
    { name: MIDDLEWARE_NAMES.SUMMARIZATION, priority: MIDDLEWARE_PRIORITY.SUMMARIZATION, middleware: summarizationMiddleware(...) },
    { name: MIDDLEWARE_NAMES.SAFETY_TRIM, priority: MIDDLEWARE_PRIORITY.SAFETY_TRIM, middleware: safetyTrimMiddleware(...) },
])
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/server/workflow --reporter=verbose`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/services/workflow/middleware/types.ts server/services/workflow/middleware/index.ts \
  server/services/workflow/initAnalysis.executor.ts
git commit -m "feat(middleware): 新增中间件优先级排序和互斥校验机制"
```

---

## Task 8: moduleContextBuilder 添加 token 预算

**问题:** #10 — 全量注入无 token 预算限制

**Files:**
- Modify: `server/services/workflow/context/moduleContextBuilder.ts`

- [ ] **Step 1: 添加 allocateBudget 和 truncateSection**

按设计文档 5.1（第 486-598 行），在 `moduleContextBuilder.ts` 中：
1. 添加 `import { countTokensSync } from '~/server/utils/tokenCounter'`
2. 添加 `ContextBudget` 接口和 `allocateBudget()` 函数
3. 添加 `truncateSection()` 函数
4. 改造 `buildModuleContext()` 加入 `contextWindow` 参数和预算分配逻辑

- [ ] **Step 2: 更新调用方传入 contextWindow**

`buildModuleContext` 的调用点（经 grep 确认只有一处业务调用）：

- `server/services/workflow/caseAnalysisV2.workflow.ts:310` — 需添加 `contextWindow: nodeConfig.modelContextWindow || 128000`

当前 `ModuleContextParams` 只有 `caseId` 和 `agentName`，需扩展：

```typescript
// moduleContextBuilder.ts — 扩展接口
interface ModuleContextParams {
    caseId: number
    agentName: string
    contextWindow?: number  // 新增，默认 128000
}

// 调用方示例
const context = await buildModuleContext({
    caseId,
    agentName,
    contextWindow: nodeConfig.modelContextWindow || 128000,
})
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/server/workflow --reporter=verbose`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add server/services/workflow/context/moduleContextBuilder.ts \
  server/services/workflow/caseAnalysisV2.workflow.ts
git commit -m "perf(context): moduleContextBuilder 添加 token 预算分配机制"
```

---

## Task 9: 子代理注入精简材料上下文

**问题:** #11 — 子代理无材料上下文

**Files:**
- Modify: `server/services/workflow/agents/subAgentToolFactory.ts`
- Modify: `server/services/workflow/agents/threadState.ts`
- Modify: `app/components/ai/composables/useMessageParser.ts`

- [ ] **Step 1: 在 subAgentToolFactory.ts 中添加 buildBriefContext**

首先在文件顶部添加 import（如果尚未存在）：

```typescript
import { HumanMessage } from '@langchain/core/messages'
```

然后添加 `buildBriefContext` 函数：

```typescript
// subAgentToolFactory.ts - 文件顶部
const MATERIAL_TYPE_LABELS: Record<number, string> = {
    1: '文本',
    2: '文档',
    3: '图片',
    4: '音频',
}

async function buildBriefContext(caseId: number): Promise<string> {
    const caseInfo = await prisma.cases.findUnique({
        where: { id: caseId },
        select: {
            title: true,
            plaintiff: true,   // Json? 字段
            defendant: true,   // Json? 字段
            summary: true,
        },
    })

    if (!caseInfo) return ''

    const materials = await prisma.caseMaterials.findMany({
        where: { caseId, deletedAt: null },
        select: { name: true, type: true },
    })

    // plaintiff/defendant 是 Json 字段，需要序列化为可读文本
    const formatParty = (party: any): string => {
        if (!party) return ''
        if (typeof party === 'string') return party
        if (Array.isArray(party)) return party.map((p: any) => p.name || p).join('、')
        return party.name || JSON.stringify(party)
    }

    const parts = [
        '## 案件概要',
        `- 标题：${caseInfo.title || '未命名'}`,
        caseInfo.plaintiff ? `- 原告：${formatParty(caseInfo.plaintiff)}` : null,
        caseInfo.defendant ? `- 被告：${formatParty(caseInfo.defendant)}` : null,
        caseInfo.summary ? `- 概述：${caseInfo.summary}` : null,
        materials.length > 0
            ? `\n## 材料列表\n${materials.map(m => `- ${m.name} (${MATERIAL_TYPE_LABELS[m.type] || '未知'})`).join('\n')}`
            : null,
    ]

    return parts.filter(Boolean).join('\n')
}
```

> **注意**：
> - `cases` 表的 `plaintiff` 和 `defendant` 是 `Json?` 类型（见 `prisma/models/case.prisma:46,48`），不能直接字符串拼接
> - `caseMaterials.type` 是 `Int` 类型（1-文本, 2-文档, 3-图片, 4-音频），需映射为可读文本
> - 实施时需先 grep 确认 `HumanMessage` 是否已 import，未 import 则添加

- [ ] **Step 2: 改造子代理 invoke 逻辑**

按设计文档 5.2（第 654-683 行），将 briefContext 作为 HumanMessage + `injectedBy: 'SubAgentContext'` 注入到 initialMessages 中。systemPrompt 保持纯静态。

首次调用注入后 checkpoint 持久化，后续调用通过读取 checkpoint 历史跳过重复注入：

```typescript
import { getCheckpointer } from '../checkpointer'

// 工具函数内部，在创建 agent 之前
const checkpointer = await getCheckpointer()
const subThreadId = `${context.sessionId}_sub_${safeName}`

// 从 checkpointer 读取历史，判断是否已注入过 SubAgentContext
const checkpointTuple = await checkpointer.getTuple({
    configurable: { thread_id: subThreadId },
})
const existingMessages = (checkpointTuple?.checkpoint?.channel_values as any)?.messages ?? []
const hasContext = Array.isArray(existingMessages) && existingMessages.some(
    (m: any) => m.response_metadata?.injectedBy === 'SubAgentContext'
)

const briefContext = await buildBriefContext(context.caseId)

const initialMessages = (!hasContext && briefContext)
    ? [
        new HumanMessage({
            content: briefContext,
            response_metadata: { injectedBy: 'SubAgentContext', injectedAt: new Date().toISOString() },
        }),
        new HumanMessage(question),
    ]
    : [new HumanMessage(question)]

// systemPrompt 保持纯静态（命中 Prompt Caching）
const agent = createAgent({
    systemPrompt,  // 不拼接 briefContext
    // ...其他参数
})

const result = await agent.invoke(
    { messages: initialMessages },
    { configurable: { thread_id: subThreadId } },
)
```

- [ ] **Step 3: loadSubAgentThreads 添加过滤**

在 `threadState.ts` 的 `loadSubAgentThreads` 中，将：
```typescript
messages: subRawMessages.map(messageToFlatDict),
```
改为：
```typescript
const filteredMessages = subRawMessages
  .map(messageToFlatDict)
  .filter(msg => {
    if (msg.type === 'system') return false
    // messageToFlatDict 返回 Record<string, unknown>，需断言访问嵌套字段
    const meta = msg.response_metadata as { injectedBy?: string } | undefined
    if (meta?.injectedBy) return false
    return true
  })
// ...
messages: filteredMessages,
```

- [ ] **Step 4: getThreadValuesService 新增 SubAgentContext 前缀过滤**

在 `threadState.ts` 的过滤条件中添加：
```typescript
|| injector?.startsWith('SubAgentContext')
```

- [ ] **Step 5: useMessageParser.ts 新增 SubAgentContext 前缀过滤**

在前端过滤条件中添加：
```typescript
|| injector?.startsWith('SubAgentContext')
```

- [ ] **Step 6: 运行测试**

Run: `npx vitest run tests/server/workflow --reporter=verbose`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add server/services/workflow/agents/subAgentToolFactory.ts \
  server/services/workflow/agents/threadState.ts \
  app/components/ai/composables/useMessageParser.ts
git commit -m "feat(agent): 子代理注入精简材料上下文，补全三层消息过滤"
```

---

## Task 10: storage.ts 迁移到 Redis

**问题:** #13 — 进程内 Map 不支持多实例

**Files:**
- Modify: `server/services/workflow/state/storage.ts`
- Modify: `server/services/workflow/middleware/pointConsumption.middleware.ts`

- [ ] **Step 1: 改造 storage.ts**

按设计文档 6.1（第 750-779 行），将 `Map` 替换为 Redis 实现。函数签名从同步改为 async。

只实现 `getSessionState` 和 `updateSessionState` 两个函数（当前有调用方的）。`deleteSessionState` 暂不实现（当前无调用方，YAGNI）。

- [ ] **Step 2: pointConsumption.middleware.ts 添加 await**

三处 `updateSessionState` 调用（约 207、242、258 行）添加 `await`。

- [ ] **Step 3: moduleAgent.ts 确认兼容**

`getState: async () => getSessionState(sessionId)` 已是 async 包装，无需修改。

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/server/workflow --reporter=verbose`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/services/workflow/state/storage.ts \
  server/services/workflow/middleware/pointConsumption.middleware.ts
git commit -m "refactor(storage): session state 从进程内 Map 迁移到 Redis"
```

---

## Task 11: Worker 过滤逻辑完善

**问题:** #14 — updates 事件不过滤、session null 静默降级、SubAgentContext 未覆盖

**当前代码现状**（`agentWorker.ts`）：
- 已有 `isSystemMessage`（第 477 行）、`isInjectedMessage`（第 491 行）、`isInternalMessage`（第 512 行）三个过滤函数
- `isInjectedMessage` 目前硬编码检测 `ModuleContext` 和 `CaseMaterial` 前缀，需新增 `SubAgentContext`
- `stripSystemMessages` 使用 `isInternalMessage`，处理 `values` 和 `messages` 事件，**缺少 `updates` 事件处理**
- 已有 `isInternalLLMEvent` 函数（意图分类器 tags 过滤，commit a876625）

**Files:**
- Modify: `server/services/agent/agentWorker.ts`

- [ ] **Step 1: 扩展 isInjectedMessage 支持 SubAgentContext**

在 `isInjectedMessage` 函数中（第 491-509 行）将硬编码的前缀列表扩展：

```typescript
// 原来
if (injector.startsWith('ModuleContext') || injector.startsWith('CaseMaterial')) return true

// 改为（直接和嵌套两处都要改）
if (injector.startsWith('ModuleContext')
    || injector.startsWith('CaseMaterial')
    || injector.startsWith('SubAgentContext')) return true
```

- [ ] **Step 2: stripSystemMessages 新增 updates 事件处理**

> **关键约束**：LangGraph 的 `updates` 事件数据结构是 `Record<nodeName, NodeOutput>`（按节点聚合的增量更新，见 `@langchain/langgraph/dist/pregel/types.d.ts` 第 68-95 行），**不是** `{ messages: [...] }`。需遍历每个 node 输出单独处理。

在 `stripSystemMessages` 函数中（第 536 行）新增 `updates` 事件分支：

```typescript
function stripSystemMessages(event: string, data: unknown): unknown | null {
    if (!data || typeof data !== 'object') return data

    // values 事件：data 形如 { messages: [...] }
    if (event === 'values') {
        const d = data as Record<string, unknown>
        if (Array.isArray(d.messages)) {
            return { ...d, messages: d.messages.filter(m => !isInternalMessage(m)) }
        }
        return data
    }

    // updates 事件：data 形如 { nodeName: { messages: [...], ... }, ... }
    if (event === 'updates') {
        const d = data as Record<string, unknown>
        const result: Record<string, unknown> = {}
        for (const [nodeName, nodeOutput] of Object.entries(d)) {
            if (nodeOutput && typeof nodeOutput === 'object') {
                const no = nodeOutput as Record<string, unknown>
                if (Array.isArray(no.messages)) {
                    result[nodeName] = {
                        ...no,
                        messages: no.messages.filter(m => !isInternalMessage(m)),
                    }
                    continue
                }
            }
            result[nodeName] = nodeOutput
        }
        return result
    }

    // messages 事件：保持原有逻辑（isInternalLLMEvent + isInternalMessage 过滤）
    // ...existing messages event handling...
}
```

- [ ] **Step 3: session null 检查**

按设计文档 6.2.3（第 867-881 行），在 session 类型路由前添加 null 检查抛错。

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/server/agent --reporter=verbose`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/services/agent/agentWorker.ts
git commit -m "fix(worker): isInjectedMessage 新增 SubAgentContext 前缀，stripSystemMessages 覆盖 updates 事件，session null 抛错"
```

---

## Task 12: V2 路径兜底和收尾

**问题:** V2 路径与 V1 安全性对等

**Files:**
- Modify: `server/services/workflow/caseAnalysisV2.workflow.ts`
- Modify: `server/services/workflow/context/messageCompressor.ts`（清理死代码标注）

- [ ] **Step 1: V2 路径 callModel 节点添加 safetyTrimMessages**

在 `caseAnalysisV2.workflow.ts` 的 `callModel` 节点中，模型调用前添加兜底截断。

V2 路径使用 `StateGraph` 的 `addNode` 定义节点，节点函数直接操作 state 对象。state 更新通过返回新的 state 字段实现（LangGraph reducer 处理合并）。因此消息截断后需通过 `RemoveMessage` + 新消息的方式更新，或在传入模型前临时截断（不写回 state）：

```typescript
import { safetyTrimMessages, estimateMessagesTokens } from '../context/messageCompressor'

// callModel 节点中，调用模型前
const contextWindow = nodeConfig.modelContextWindow || 128000
const maxTokens = Math.floor(contextWindow * 0.8)
const estimated = estimateMessagesTokens(state.messages)

let messagesToSend = state.messages
if (estimated > maxTokens) {
    // 临时截断用于模型调用，不写回 state（避免 checkpoint 丢失完整历史）
    messagesToSend = await safetyTrimMessages(state.messages, maxTokens)
    logger.warn('V2 路径消息临时截断', { estimated, maxTokens, before: state.messages.length, after: messagesToSend.length })
}

const response = await model.invoke(messagesToSend)
```

- [ ] **Step 2: V2 路径 summarization 阈值动态化**

搜索 V2 路径中 `100000` 阈值，替换为 `Math.max(Math.floor(contextWindow * 0.6), 30000)`

- [ ] **Step 3: V2 路径 buildModuleContext 传入 contextWindow**

确认 `buildModuleContext` 调用已传入 `contextWindow` 参数（Task 8 可能已处理）。

- [ ] **Step 4: messageCompressor.ts 添加 getContextBudget 注释**

在 `getContextBudget` 函数上方添加注释标注为 V2 路径专用：
```typescript
/** V2 路径专用 — 返回消息压缩的 budget 和 compressThreshold */
```

- [ ] **Step 5: 运行全量测试**

Run: `npx vitest run tests/server --reporter=verbose`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add server/services/workflow/caseAnalysisV2.workflow.ts \
  server/services/workflow/context/messageCompressor.ts
git commit -m "perf(workflow): V2 路径补充 safetyTrim 兜底和动态阈值"
```

---

## Task 13: 全量回归测试和类型检查

- [ ] **Step 1: 运行全量测试**

Run: `npx vitest run --reporter=verbose`
Expected: PASS

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增类型错误

- [ ] **Step 3: 使用 simplify 技能优化代码**

对本次改动涉及的所有文件执行 simplify 审查。

- [ ] **Step 4: 最终提交（如有优化）**

显式列出本次 simplify 涉及的文件（不使用 `git add -A` 避免误提交）：

```bash
git status  # 先查看有哪些改动
git add <显式列出的文件路径>
git commit -m "refactor(workflow): simplify — 上下文工程优化代码整理"
```

---

## 依赖关系

```
Task 1 (toolResultTruncator) ──┐
                                ├── Task 2 (searchLaw/CaseMaterials) ── 依赖 Task 1
Task 3 (promptRenderer) ───────┤
Task 4 (caseAnalysis prompt) ──┤
                                ├── Task 5 (summarization 阈值) ────── 修改相同 Agent 文件
                                ├── Task 5.5 (膨胀治理) ────────────── 独立（审查+小改造）
                                ├── Task 6 (safetyTrimMiddleware) ──── 依赖 Task 5
                                ├── Task 7 (中间件顺序) ──────────── 依赖 Task 6
                                ├── Task 8 (moduleContextBuilder) ──── 依赖 Task 1
                                ├── Task 9 (子代理上下文) ─────────── 依赖 Task 3
                                ├── Task 10 (storage Redis) ────────── 独立
                                ├── Task 11 (Worker 过滤) ──────────── 独立
                                └── Task 12 (V2 兜底) ──────────────── 依赖 Task 5/6/8
Task 13 (回归测试) ───────────── 依赖所有 Task
```

**可并行执行的 Task 组：**
- Group A: Task 1 → Task 2
- Group B: Task 3 + Task 4 → Task 5 → Task 5.5 → Task 6 → Task 7
- Group C: Task 10 + Task 11（独立）
- Group D: Task 8（依赖 Task 1）
- Group E: Task 9（依赖 Task 3）
- Final: Task 12 → Task 13
