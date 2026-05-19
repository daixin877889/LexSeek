# Workflow 中间件管道

LexSeek 使用 LangChain/LangGraph 中间件机制为 Agent 工作流注入横切关注点，通过声明式优先级排序保证中间件执行顺序的正确性。

## 架构概览

```
Agent 工作流启动
    │
    ▼ buildMiddlewareStack(items) → 按 priority 升序排序
    │
    ▼ beforeAgent 钩子按优先级升序执行
    │
    ├── [10] caseProcessMaterial    ── 材料预处理（OCR、向量化）
    ├── [20] pointConsumption       ── 积分预检（会员 + 余额）
    ├── [30] caseContextSync        ── 案件上下文同步注入
    ├── [50] safetyTrim             ── 消息安全截断
    │
    ▼ Agent 执行（LLM 调用）
    │
    ▼ afterModel 钩子（每次模型调用后执行）
    │
    ├── [20] pointConsumption       ── 实时积分扣减
    │
    ▼ afterAgent 钩子按优先级升序执行
    │
    └── [90] analysisResultPersistence ── 分析结果持久化
```

> `caseContextSyncMiddleware` 于 2026-05-05 统一接管案件上下文管线，取代了原先各自为政的 `caseMaterialContext` / `moduleContext`（前者已于 2026-04-30 删除）。

## 类型定义

`MIDDLEWARE_PRIORITY` / `MIDDLEWARE_NAMES` / `buildMiddlewareStack` 的实体定义在 `server/services/agent-platform/middleware/types.ts`；`server/services/workflow/middleware/index.ts` 仅做 re-export 保持兼容。

```typescript
// server/services/agent-platform/middleware/types.ts

import type { AgentMiddleware } from 'langchain'

/** 带优先级的中间件描述 */
export interface MiddlewareWithPriority {
    middleware: AgentMiddleware
    priority: number      // 越小越先执行
    name: string          // 用于日志
}

/** 优先级常量（间隔 10，方便插入；数值越小越先执行） */
export const MIDDLEWARE_PRIORITY = {
    MESSAGE_INTEGRITY: 1,     // 消息完整性兜底（必须最最前）
    SCOPE_GUARD: 5,           // Agent 安全：scope 校验
    TOOL_CALL_LIMIT: 7,       // Agent 安全：工具调用次数熔断
    PROCESS_MATERIAL: 10,     // 材料预处理
    POINT_CONSUMPTION: 20,    // 积分消耗
    MODULE_CONTEXT: 30,       // 案件上下文注入
    SUMMARIZATION: 40,        // 摘要压缩
    SAFETY_TRIM: 50,          // 安全截断
    SKILLS_DISCOVERY: 60,     // Skills 发现和加载
    USER_INJECTION: 70,       // 用户每轮注入
    TODO_LIST: 80,            // 待办列表
    RESULT_PERSISTENCE: 90,   // 结果持久化（最后执行）
    AUDIT: 100,               // Agent 安全：审计归档（必须最后）
} as const

/** 中间件名称常量，统一命名避免硬编码 */
export const MIDDLEWARE_NAMES = {
    MESSAGE_INTEGRITY: 'messageIntegrity',
    SCOPE_GUARD: 'scopeGuard',
    TOOL_CALL_LIMIT: 'toolCallLimit',
    PROCESS_MATERIAL: 'caseProcessMaterial',
    POINT_CONSUMPTION: 'pointConsumption',
    MODULE_CONTEXT: 'caseContext',          // 案件上下文同步中间件
    SUMMARIZATION: 'summarization',
    SAFETY_TRIM: 'safetyTrim',
    SKILLS_DISCOVERY: 'skillsDiscovery',
    USER_INJECTION: 'userInjection',
    TODO_LIST: 'todoList',
    RESULT_PERSISTENCE: 'analysisResultPersistence',
    REVIEW_RESULT_PERSISTENCE: 'reviewResultPersistence',  // 合同审查结果持久化
    AUDIT: 'audit',
} as const
```

> 旧的 `MATERIAL_CONTEXT` 常量已随 `caseMaterialContext` 中间件一并移除；案件上下文统一走 `MODULE_CONTEXT: 30`，且 `MIDDLEWARE_NAMES.MODULE_CONTEXT` 的值为 `'caseContext'`。

## 中间件栈构建

`buildMiddlewareStack` 只做 priority 升序排序并打一条 debug 日志，不做任何互斥校验：

```typescript
// server/services/agent-platform/middleware/types.ts

export function buildMiddlewareStack(items: MiddlewareWithPriority[]): AgentMiddleware[] {
    // 按 priority 升序排列（相同优先级保持注册顺序）
    const sorted = [...items].sort((a, b) => a.priority - b.priority)

    logger.debug('中间件执行顺序', {
        order: sorted.map(i => `${i.name}(${i.priority})`),
    })

    return sorted.map(i => i.middleware)
}
```

## 中间件详解

### 1. caseProcessMaterial（优先级 10）

**职责**：在 Agent 启动前确保案件材料已完成预处理（OCR 转换、文本提取、向量嵌入）。

**钩子**：`beforeAgent`

```typescript
// server/services/workflow/middleware/caseProcessMaterial.middleware.ts

export const caseProcessMaterialMiddleware = (userId: number, caseId: number) => {
    return createMiddleware({
        name: 'CaseProcessMaterialMiddleware',
        beforeAgent: {
            hook: async (_state) => {
                const result = await ensureMaterialsReadyService(caseId, userId)
                logger.info('材料预处理完成', {
                    totalMaterials: result.totalMaterials,
                    alreadyEmbedded: result.alreadyEmbedded,
                    newlyProcessed: result.newlyProcessed,
                    failedCount: result.failed.length,
                })
            }
        }
    })
}
```

**设计要点**：
- 异常只记录日志，不阻断 Agent 启动
- 幂等设计：已处理过的材料自动跳过

### 2. pointConsumption（优先级 20）

**职责**：会员身份检查、积分余额预检、每次模型调用后实时扣减积分。

**钩子**：`beforeAgent` + `afterModel`

```typescript
export const pointConsumptionMiddleware = (userId: number, itemKey: string, sessionId?: string) => {
    return createMiddleware({
        name: 'PointConsumptionMiddleware',
        stateSchema: z.object({
            _totalTokensConsumed: z.number().default(0),
            _totalPointsConsumed: z.number().default(0),
            _pendingDeductQuantity: z.number().default(0),
            _resumingFromAfterModel: z.boolean().default(false),
        }),

        beforeAgent: {
            hook: async (state) => {
                // 1. 如果是从 afterModel interrupt 恢复，跳过预检
                if (state._resumingFromAfterModel) return { _resumingFromAfterModel: false }

                // 2. 检查会员状态 → interrupt 如果非会员
                // 3. 检查积分最小单元 → interrupt 如果不足
            },
        },

        afterModel: {
            hook: async (state) => {
                // 1. 处理上次失败的待补扣
                // 2. 从 AIMessage.usage_metadata 获取 token 用量
                // 3. 按 1000 tokens/积分 计算扣减量
                // 4. 调用 consumePointsService 扣减
                // 5. 积分不足 → interrupt（充值后 resume 继续）
            },
        },
    })
}
```

**核心机制**：
- 使用 LangGraph `interrupt()` 暂停工作流，等待用户操作后 `resume` 继续
- `_pendingDeductQuantity`：扣减失败时记录待补扣量，下轮补扣
- `_resumingFromAfterModel`：从 afterModel interrupt 恢复时跳过 beforeAgent 预检
- Token 估算：优先使用 `usage_metadata.total_tokens`，缺失时按字符数保底估算

### 3. caseContextSync（优先级 30）

**职责**：统一三个 Agent（小索 / 模块对话 / 文书生成）的「案件相关上下文」管线。每轮 Agent 启动时实时拉取案件 4 段上下文，拼成单一 `HumanMessage` 原地插入到本轮 user message 之前。

**钩子**：`beforeAgent`

**实现位置**：`server/agents/_shared/case-context/caseContextSync.middleware.ts`

> `caseContextSyncMiddleware` 于 2026-05-05 取代了原先的 `caseContextMiddleware`，并合并掉了 2026-04-30 删除的 `caseMaterialContextMiddleware`——三个 Agent 不再走 SystemMessage 拼装，统一改为 HumanMessage 注入 + 双轨 metadata + splice 模式。

```typescript
// server/agents/_shared/case-context/caseContextSync.middleware.ts

export const caseContextSyncMiddleware = (options: CaseContextSyncOptions) =>
    createMiddleware({
        name: 'CaseContextSyncMiddleware',
        beforeAgent: {
            hook: async (state) => {
                const messages = state.messages ?? []
                const lastHumanIdx = messages.findLastIndex(/* 末尾 HumanMessage */)
                const userQuery = /* 取末尾 HumanMessage 文本 */

                const lines: string[] = []

                // 案件 4 段：caseProfile + moduleSummaries + materialList + memoryRecall
                if (options.caseId !== null) {
                    const segs = await buildContextSegments({
                        caseId: options.caseId,
                        agentName: options.agentName,
                        userQuery,
                    })
                    if (segs.caseProfile) lines.push(segs.caseProfile)
                    if (segs.moduleSummaries) lines.push(segs.moduleSummaries)
                    if (segs.dynamicContext) lines.push(segs.dynamicContext)
                }

                // 文书 Agent 额外 2 段：当前已填字段 + 模板待填占位符
                if (options.draftLoader) { /* ... 拉草稿 draft.values + placeholders */ }

                if (lines.length === 0) return {}

                // 拼成单一 HumanMessage，双轨打 injectedBy metadata
                const contextMsg = new HumanMessage({
                    content: lines.join('\n\n'),
                    response_metadata: { injectedBy: 'CaseContextSyncMiddleware' },
                    additional_kwargs: { injectedBy: 'CaseContextSyncMiddleware' },
                })

                // splice 原地插入：插到末尾 HumanMessage 之前
                const insertIdx = lastHumanIdx >= 0 ? lastHumanIdx : messages.length
                messages.splice(insertIdx, 0, contextMsg)

                // 显式 return {} 触发 LangGraph state merge 路径
                return {}
            },
        },
    })
```

**设计要点**：
- **每轮实时拉取**：`beforeAgent` 每轮调用 `buildContextSegments` 实时拉案件 4 段；文书 Agent 还会通过 `draftLoader` 额外拉草稿当前字段 + 模板占位符 2 段。
- **splice 原地插入**：构造单一 `HumanMessage` 原地 splice 到本轮 user message 之前，不依赖 `add_messages` reducer 的重排能力。
- **双轨 metadata**：同时打 `response_metadata` 与 `additional_kwargs`，兜底 SDK 序列化丢字段。
- **显式 `return {}`**：触发 LangGraph state merge 路径；`return undefined` 会让框架走早退分支跳过 state merge。
- **容错**：`draftLoader` 整体抛错跳过文书段；`draftValuesJSON` 抛错仅置空 `currentValues`，仍展示 placeholders。

### 4. safetyTrim（优先级 50）

**职责**：确保消息列表不超过模型上下文窗口预算，作为最后一道防线。

**钩子**：`beforeAgent`

```typescript
export function safetyTrimMiddleware(options: {
    model: BaseChatModel,
    maxTokens: number,  // 通常为 contextWindow * 0.8
}) {
    return createMiddleware({
        name: 'safetyTrimMiddleware',
        beforeAgent: {
            hook: async (state: { messages: BaseMessage[] }) => {
                const estimated = estimateMessagesTokens(state.messages)
                if (estimated <= options.maxTokens) return

                // 防线一：LLM 摘要压缩（保留 system + 最近 N 轮，中间用摘要替代）
                let replacement = await compressMessages(state.messages, options.maxTokens, options.model)

                // 防线二：压缩后仍超预算 → 强制截断
                if (estimateMessagesTokens(replacement) > options.maxTokens) {
                    replacement = await safetyTrimMessages(replacement, options.maxTokens)
                }

                // 原地替换
                state.messages.splice(0, state.messages.length, ...replacement)
            },
        },
    })
}
```

**两道防线**：
1. LLM 摘要压缩（`compressMessages`）：智能保留重要上下文
2. 强制截断（`safetyTrimMessages`）：降级兜底

### 5. analysisResultPersistence（优先级 90）

**职责**：在 Agent 前创建分析记录（IN_PROGRESS），Agent 后提取结果并更新为 COMPLETED。

**钩子**：`beforeAgent` + `afterAgent`

```typescript
export const analysisResultPersistenceMiddleware = (options: {
    agentName: string,    // 对应 nodes 表 name 字段
    caseId: number,
    sessionId: string,
}) => {
    return createMiddleware({
        name: 'AnalysisResultPersistenceMiddleware',
        stateSchema: z.object({ _analysisRecordId: z.number().optional() }),

        beforeAgent: {
            hook: async (_state) => {
                // 1. 查找同 (sessionId, nodeId) 的 FAILED/IN_PROGRESS 记录，复用
                // 2. 无可复用记录 → 创建新版本
                return { _analysisRecordId: record.id }
            },
        },

        afterAgent: {
            hook: async (state) => {
                // 1. 提取最后一条 AIMessage 的文本内容
                // 2. 事务：deactivateVersionsDao → updateAnalysisDao（COMPLETED + isActive）
            },
        },
    })
}
```

**设计要点**：
- 版本管理：每次分析创建新版本，完成时将旧版本标记为 `isActive = false`
- 故障复用：FAILED/IN_PROGRESS 记录不重复创建，直接复用
- 放在 `afterAgent` 而非 `afterModel`，确保所有中间件处理完毕后才持久化

## 与 LangGraph 的集成

### createMiddleware API

所有中间件使用 LangChain 的 `createMiddleware()` 工厂函数创建：

```typescript
createMiddleware({
    name: string,                          // 中间件名称
    stateSchema?: z.ZodObject,             // 中间件私有状态（_ 前缀，持久化到 checkpoint）
    beforeAgent?: { hook: (state) => ... },  // Agent 启动前执行
    afterModel?: { hook: (state) => ... },   // 每次模型调用后执行
    afterAgent?: { hook: (state) => ... },   // Agent 完成后执行
})
```

### State 持久化

中间件通过 `stateSchema` 定义的字段自动持久化到 LangGraph checkpoint：
- `_injectedSourceIds`：已注入的材料 ID（用于增量检测）
- `_totalTokensConsumed`：累计消耗的 token 数
- `_analysisRecordId`：分析记录 ID（beforeAgent → afterAgent 传递）

### interrupt / resume

积分中间件使用 LangGraph 的 `interrupt()` 暂停工作流：

```typescript
import { interrupt } from '@langchain/langgraph'

interrupt({
    type: InterruptType.INSUFFICIENT_POINTS,
    message: '积分不足，请充值后继续',
    data: { availablePoints, requiredPoints, reason },
})
// resume 后代码从此处继续执行
```

前端收到 interrupt 事件后展示充值/会员购买引导，用户操作完成后调用 resume API 恢复工作流。

## 使用示例

```typescript
// 构建中间件栈
const middlewareStack = buildMiddlewareStack([
    {
        middleware: caseProcessMaterialMiddleware(userId, caseId),
        priority: MIDDLEWARE_PRIORITY.PROCESS_MATERIAL,
        name: MIDDLEWARE_NAMES.PROCESS_MATERIAL,
    },
    {
        middleware: pointConsumptionMiddleware(userId, 'case_analysis', sessionId),
        priority: MIDDLEWARE_PRIORITY.POINT_CONSUMPTION,
        name: MIDDLEWARE_NAMES.POINT_CONSUMPTION,
    },
    {
        middleware: caseContextSyncMiddleware({ caseId, agentName }),
        priority: MIDDLEWARE_PRIORITY.MODULE_CONTEXT,
        name: MIDDLEWARE_NAMES.MODULE_CONTEXT,
    },
    {
        middleware: safetyTrimMiddleware({ model, maxTokens: contextWindow * 0.8 }),
        priority: MIDDLEWARE_PRIORITY.SAFETY_TRIM,
        name: MIDDLEWARE_NAMES.SAFETY_TRIM,
    },
    {
        middleware: analysisResultPersistenceMiddleware({ agentName, caseId, sessionId }),
        priority: MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE,
        name: MIDDLEWARE_NAMES.RESULT_PERSISTENCE,
    },
])

// 传入 createAgent
const agent = createAgent({ middleware: middlewareStack, ... })
```

## 相关文档

- [tech-docs/patterns/service-dao.md](./service-dao.md) - Service + DAO 分层模式（中间件调用的服务层）
- [tech-docs/patterns/sse-event-bridge.md](./sse-event-bridge.md) - SSE 事件管道（中间件 interrupt 如何通知前端）
