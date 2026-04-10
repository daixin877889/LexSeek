# 上下文工程全量优化实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复工作流和 Agent 中的 14 个上下文工程问题，涵盖工具截断、提示词渲染、中间件兜底、上下文预算和消息过滤。

**Architecture:** 逐层加固策略 — Layer 1(工具) → Layer 2(提示词) → Layer 3(中间件) → Layer 4(上下文) → Layer 5(基础设施)。Layer 1/2 可并行，Layer 3-5 顺序执行。

**Tech Stack:** TypeScript, LangGraph (langchain), tiktoken (js-tiktoken), Redis, Prisma, Vitest

**Spec:** `docs/superpowers/specs/2026-04-09-context-engineering-optimization-design.md` v1.7

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
import { countTokensSync } from '~/server/utils/tokenCounter'

const DEFAULT_MAX_TOKENS_PER_ITEM = 8000
const TRUNCATION_HINT = '\n\n[内容过长已截断，请使用更精确的查询条件或指定 sourceId 重新检索]'

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

按设计文档 3.1 创建 `server/services/workflow/utils/promptRenderer.ts`，内容参照 spec 第 184-223 行。

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
 */
export function safetyTrimMiddleware(options: { model: BaseChatModel; maxTokens: number }) {
    return createMiddleware({
        name: 'safetyTrimMiddleware',
        stateSchema: z.object({}),
        beforeAgent: {
            hook: async (state: { messages: BaseMessage[] }) => {
                const estimated = estimateMessagesTokens(state.messages)
                if (estimated <= options.maxTokens) return

                // 防线一：LLM 摘要压缩
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

搜索所有 `buildModuleContext(` 调用点，补充 `contextWindow` 参数。

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
git add server/services/workflow/context/moduleContextBuilder.ts
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

按设计文档 5.2（第 607-644 行）添加函数。

- [ ] **Step 2: 改造子代理 invoke 逻辑**

按设计文档 5.2（第 654-683 行），将 briefContext 作为 HumanMessage + `injectedBy: 'SubAgentContext'` 注入到 initialMessages 中。systemPrompt 保持纯静态。

首次调用注入后 checkpoint 持久化，后续调用通过检查 checkpoint 历史跳过重复注入：

```typescript
// 检查 checkpoint 是否已有 SubAgentContext 注入
const existingMessages = checkpointState?.messages ?? []
const hasContext = existingMessages.some(
    (m: any) => m.response_metadata?.injectedBy === 'SubAgentContext'
)

const initialMessages = (!hasContext && briefContext)
    ? [
        new HumanMessage({
            content: briefContext,
            response_metadata: { injectedBy: 'SubAgentContext', injectedAt: new Date().toISOString() },
        }),
        new HumanMessage(question),
    ]
    : [new HumanMessage(question)]
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
    if (msg.response_metadata?.injectedBy) return false
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

**问题:** #14 — updates 事件不过滤、session null 静默降级

**Files:**
- Modify: `server/services/agent/agentWorker.ts`

- [ ] **Step 1: 新增 isFilterableMessage 函数**

按设计文档 6.2.1（第 800-822 行），在 `agentWorker.ts` 中新增 `isFilterableMessage`，同时检测 system 消息和 `injectedBy` 注入消息。

- [ ] **Step 2: 扩展 stripSystemMessages 函数**

按设计文档 6.2.2（第 830-863 行）：
1. 将内部 `isSystemMessage` 替换为 `isFilterableMessage`
2. 新增 `updates` 事件处理（与 `values` 相同逻辑）
3. 保持函数名 `stripSystemMessages` 不变

- [ ] **Step 3: session null 检查**

按设计文档 6.2.3（第 867-881 行），在 session 类型路由前添加 null 检查抛错。

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/server/agent --reporter=verbose`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/services/agent/agentWorker.ts
git commit -m "fix(worker): 完善消息过滤（覆盖 updates 事件和注入消息），session null 抛错"
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

```bash
git add -A
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
