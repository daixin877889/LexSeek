# Workflow 中间件管道

LexSeek 使用 LangChain/LangGraph 中间件机制为 Agent 工作流注入横切关注点，通过声明式优先级排序和互斥校验保证中间件执行顺序的正确性。

## 架构概览

```
Agent 工作流启动
    │
    ▼ buildMiddlewareStack(items) → 优先级排序 + 互斥校验
    │
    ▼ beforeAgent 钩子按优先级升序执行
    │
    ├── [10] caseProcessMaterial    ── 材料预处理（OCR、向量化）
    ├── [20] pointConsumption       ── 积分预检（会员 + 余额）
    ├── [30] caseMaterialContext    ── 案件材料上下文注入 ─┐ 互斥
    ├── [30] moduleContext          ── 模块上下文注入     ─┘
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

## 类型定义

```typescript
// server/services/workflow/middleware/types.ts

import type { AgentMiddleware } from 'langchain'

/** 带优先级的中间件描述 */
export interface MiddlewareWithPriority {
    middleware: AgentMiddleware
    priority: number      // 越小越先执行
    name: string          // 用于日志和互斥校验
}

/** 优先级常量（间隔 10，方便插入） */
export const MIDDLEWARE_PRIORITY = {
    PROCESS_MATERIAL: 10,     // 材料预处理
    POINT_CONSUMPTION: 20,    // 积分消耗
    MATERIAL_CONTEXT: 30,     // 案件材料上下文（与 MODULE_CONTEXT 互斥）
    MODULE_CONTEXT: 30,       // 模块上下文（与 MATERIAL_CONTEXT 互斥）
    SUMMARIZATION: 40,        // 摘要压缩
    SAFETY_TRIM: 50,          // 安全截断
    TODO_LIST: 80,            // 待办列表
    RESULT_PERSISTENCE: 90,   // 结果持久化（最后执行）
} as const
```

## 中间件栈构建

```typescript
// server/services/workflow/middleware/types.ts

export function buildMiddlewareStack(items: MiddlewareWithPriority[]): AgentMiddleware[] {
    // 互斥校验
    const hasMaterial = items.some(i => i.name === 'caseMaterialContext')
    const hasModule = items.some(i => i.name === 'moduleContext')
    if (hasMaterial && hasModule) {
        throw new Error('caseMaterialContext 和 moduleContext 不能同时挂载')
    }

    // 按 priority 升序排列
    const sorted = [...items].sort((a, b) => a.priority - b.priority)
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

### 3. caseMaterialContext（优先级 30）

**职责**：将案件材料内容注入到 Agent 消息列表中，支持首次全量注入和后续增量注入。

**钩子**：`beforeAgent`

```typescript
export const caseMaterialContextMiddleware = (userId: number, caseId: number) => {
    return createMiddleware({
        name: 'CaseMaterialContextMiddleware',
        stateSchema: z.object({
            _injectedSourceIds: z.array(z.number()).default([]),  // 持久化到 checkpoint
        }),
        beforeAgent: {
            hook: async (state) => {
                const materials = await getMaterialsByCaseIdService(caseId)
                const prevSourceIds = state._injectedSourceIds ?? []
                const currentSourceIds = materials.map(m => getSourceId(m))

                const isFirstInjection = prevSourceIds.length === 0
                const newSourceIds = currentSourceIds.filter(id => !new Set(prevSourceIds).has(id))

                if (isFirstInjection) {
                    // 首次：按 token 阈值判断 full/summary 模式
                    const context = await getMaterialContextService(materials)
                    // 插入到 SystemMessage 之后
                    state.messages.splice(systemIdx + 1, 0, new HumanMessage({ content: messageText }))
                } else if (newSourceIds.length > 0) {
                    // 增量：仅新增材料，固定 summary 模式
                    // 插入到用户最新消息之前
                }

                return { _injectedSourceIds: currentSourceIds }
            }
        }
    })
}
```

**与 moduleContext 互斥**：两者都提供上下文注入但策略不同，不能同时挂载。

### 4. moduleContext（优先级 30）

**职责**：为模块对话注入四种维度的上下文，使用变更检测实现增量注入。

**钩子**：`beforeAgent`

检测的四种上下文维度：

| 维度 | 检测方式 | 首次行为 | 增量行为 |
|---|---|---|---|
| 案件材料 | sourceId 列表对比 | 全量注入 | 仅新增材料 |
| 长期记忆 | MD5 hash 对比 | 注入 | 变更时重新注入 |
| 其他模块分析结果 | 逐模块 MD5 hash | 注入 | 变更时重新注入 |
| 当前模块分析结果 | MD5 hash 对比 | 注入（作为基线） | 变更时重新注入 |

```typescript
export const moduleContextMiddleware = (caseId: number, moduleName: string) => {
    return createMiddleware({
        name: 'ModuleContextMiddleware',
        stateSchema: z.object({
            _injectedSourceIds: z.array(z.number()).default([]),
            _lastMemoryHash: z.string().nullable().default(null),
            _injectedResultVersions: z.record(z.string(), z.string()).optional().default({}),
            _currentModuleResultHash: z.string().nullable().default(null),
        }),
        beforeAgent: {
            hook: async (state) => {
                const sections: string[] = []

                // 并发加载 4 种上下文
                const [materials, memory, completedResults] = await Promise.all([
                    getMaterialsByCaseIdService(caseId),
                    getCaseMemory(caseId),
                    loadCompletedResultsService(caseId),
                ])

                // 1. 材料增量检测
                // 2. 长期记忆变更检测（MD5 hash）
                // 3. 其他模块分析结果变更检测（逐模块 MD5）
                // 4. 当前模块结果变更检测

                if (sections.length === 0) return

                // 拼接为 HumanMessage，插入最新 HumanMessage 之前
                const contextMessage = new HumanMessage({ content: sections.join('\n\n') })
                state.messages.splice(lastHumanIdx, 0, contextMessage)

                return {
                    _injectedSourceIds: newSourceIds,
                    _lastMemoryHash: newMemoryHash,
                    _injectedResultVersions: newResultVersions,
                    _currentModuleResultHash: newCurrentHash,
                }
            },
        },
    })
}
```

### 5. safetyTrim（优先级 50）

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

### 6. analysisResultPersistence（优先级 90）

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
        middleware: caseMaterialContextMiddleware(userId, caseId),
        priority: MIDDLEWARE_PRIORITY.MATERIAL_CONTEXT,
        name: MIDDLEWARE_NAMES.MATERIAL_CONTEXT,
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
