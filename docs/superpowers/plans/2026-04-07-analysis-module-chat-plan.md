# 分析模块对话 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为案件分析 detail 视图中的每个模块提供独立的多轮对话能力，通过 AI 迭代优化分析结果，每次生成新版本。

**Architecture:** 复用现有 chat.post.ts SSE 端点和 Redis 事件桥，新建轻量级 moduleAgent（createAgent ReAct 模式），通过 caseSessions.type=3 区分模块对话。前端用 useModuleChatManager 管理多模块并发，悬浮窗参考小索对话框。

**Tech Stack:** LangGraph createAgent, @langchain/vue useStream, FetchStreamTransport, Redis Pub/Sub, PostgresSaver, Prisma, Vue 3 Composition API, shadcn-vue

**设计文档:** `docs/superpowers/specs/2026-04-07-analysis-module-chat-design.md`

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `server/services/workflow/tools/saveAnalysisResult.tool.ts` | save_analysis_result 工具（保存+激活分析结果版本） |
| `server/services/workflow/middleware/moduleContext.middleware.ts` | 每轮对话前增量注入动态上下文 |
| `server/services/workflow/agents/moduleAgent.ts` | 轻量级模块对话 Agent |
| `server/api/v1/case/analysis/module-session.post.ts` | 创建/获取模块对话 session |
| `server/api/v1/case/analysis/module-sessions.get.ts` | 查询活跃模块 session 列表 |
| `app/composables/useModuleChatManager.ts` | 多模块对话实例管理 |
| `app/components/case/AnalysisModuleChat.vue` | 模块对话悬浮窗 |
| `app/components/case/AnalysisModuleChatBar.vue` | 最小化状态条 |
| `tests/server/workflow/tools/saveAnalysisResult.test.ts` | 工具单元测试 |
| `tests/server/workflow/middleware/moduleContext.test.ts` | 中间件单元测试 |
| `tests/server/api/moduleSession.test.ts` | API 集成测试 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `shared/types/agentRun.ts` | 新增 AgentCustomEvent 类型 |
| `shared/types/case.ts` | CreateSessionInput 添加 type/metadata 字段 |
| `server/services/workflow/tools/types.ts` | ToolContext 添加 runId 字段 |
| `server/services/case/case.dao.ts` | createSessionDao 支持 type/metadata |
| `server/services/case/analysis.service.ts` | 新增 saveAndActivateAnalysisService |
| `server/services/agent/agentEventBridge.ts` | 新增 publishCustomEvent 函数 |
| `server/services/agent/agentWorker.ts` | 添加 session type=3 分支 |
| `server/api/v1/case/analysis/chat.post.ts` | SSE 转发支持 custom_event |
| `app/composables/useCaseChat.ts` | 扩展 CaseChatOptions 支持 onCustomEvent |
| `app/components/caseDetail/CaseDetailAnalysis.vue` | 转发 regenerate 事件 |
| `app/pages/dashboard/cases/[id].vue` | 集成 moduleChatManager |

---

## Task 1: 类型扩展（AgentCustomEvent + CreateSessionInput + ToolContext）

**Files:**
- Modify: `shared/types/agentRun.ts`
- Modify: `shared/types/case.ts`
- Modify: `server/services/workflow/tools/types.ts`

- [ ] **Step 1: 在 agentRun.ts 中新增 AgentCustomEvent 类型**

在 `shared/types/agentRun.ts` 的 `AgentStatusEvent` 定义之后、`AgentEvent` 定义之前，添加：

```typescript
export interface AgentCustomEvent {
    type: 'custom_event'
    runId: string
    sessionId: string
    name: string
    data: unknown
}

export type AgentEvent = AgentStreamEvent | AgentStatusEvent | AgentCustomEvent
```

注意：替换原有的 `export type AgentEvent = AgentStreamEvent | AgentStatusEvent`

- [ ] **Step 2: 在 case.ts 中扩展 CreateSessionInput**

在 `shared/types/case.ts` 的 `CreateSessionInput` 接口中添加：

```typescript
export interface CreateSessionInput {
    sessionId: string
    caseId: number
    status?: number
    type?: number
    metadata?: Record<string, unknown>
}
```

同时在 `shared/types/case.ts` 中新增 SessionType 枚举（避免魔术数字散布）：

```typescript
export enum SessionType {
    NORMAL = 1,
    INIT_ANALYSIS = 2,
    MODULE_CHAT = 3,
}
```

- [ ] **Step 3: 在 tools/types.ts 中扩展 ToolContext**

在 `server/services/workflow/tools/types.ts` 的 `ToolContext` 接口中添加 `runId`：

```typescript
export interface ToolContext {
    userId: number
    caseId: number
    sessionId: string
    runId?: string
}
```

使用可选字段，避免破坏现有工具的兼容性。

- [ ] **Step 4: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增类型错误

- [ ] **Step 5: Commit**

```bash
git add shared/types/agentRun.ts shared/types/case.ts server/services/workflow/tools/types.ts
git commit -m "feat(types): 新增 AgentCustomEvent 类型，扩展 CreateSessionInput 和 ToolContext"
```

---

## Task 2: DAO 层扩展（createSessionDao 支持 type/metadata）

**Files:**
- Modify: `server/services/case/case.dao.ts`
- Test: `tests/server/api/moduleSession.test.ts`（后续 Task 会用到）

- [ ] **Step 1: 修改 createSessionDao 支持新字段**

在 `server/services/case/case.dao.ts` 的 `createSessionDao` 函数中，修改 `create` 调用：

```typescript
export const createSessionDao = async (
    data: CreateSessionInput,
    tx?: Prisma.TransactionClient,
): Promise<caseSessions> => {
    const client = tx || prisma
    return await client.caseSessions.create({
        data: {
            sessionId: data.sessionId,
            caseId: data.caseId,
            status: data.status ?? SessionStatus.IN_PROGRESS,
            type: data.type ?? 1,
            metadata: data.metadata ?? undefined,
        },
    })
}
```

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add server/services/case/case.dao.ts
git commit -m "feat(dao): createSessionDao 支持 type 和 metadata 字段"
```

---

## Task 3: saveAndActivateAnalysisService

**Files:**
- Modify: `server/services/case/analysis.service.ts`
- Test: `tests/server/workflow/tools/saveAnalysisResult.test.ts`（后续 Task）

- [ ] **Step 1: 在 analysis.service.ts 中新增事务封装函数**

在 `saveAnalysisResultService` 之后添加：

```typescript
export const saveAndActivateAnalysisService = async (
    data: SaveAnalysisInput,
): Promise<caseAnalyses> => {
    return await prisma.$transaction(async (tx) => {
        // 获取下一个版本号
        const version = await getNextVersionDao(data.caseId, data.nodeId, tx)

        // 创建新版本记录
        const analysis = await createAnalysisDao(
            {
                caseId: data.caseId,
                sessionId: data.sessionId,
                nodeId: data.nodeId,
                analysisType: data.analysisType,
                analysisResult: data.analysisResult,
                originalResult: data.originalResult ?? null,
                version,
                status: AnalysisStatus.COMPLETED,
                isActive: false,
                pointDeducted: false,
            },
            tx,
        )

        // 在同一事务内激活新版本
        await activateVersionDao(analysis.id, data.caseId, data.nodeId, tx)

        return analysis
    })
}
```

需要确认 `getNextVersionDao` 是否支持 `tx` 参数，如不支持则在事务内直接查询。

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add server/services/case/analysis.service.ts
git commit -m "feat(analysis): 新增 saveAndActivateAnalysisService 事务封装"
```

---

## Task 4: publishCustomEvent 函数

**Files:**
- Modify: `server/services/agent/agentEventBridge.ts`

- [ ] **Step 1: 新增 publishCustomEvent 函数**

在 `agentEventBridge.ts` 中 `publishAgentEvent` 函数之后添加：

```typescript
export async function publishCustomEvent(event: AgentCustomEvent): Promise<void> {
    if (!isRedisReady()) {
        enqueuePending(event as unknown as AgentStreamEvent)
        return
    }

    const redis = getRedisClient()
    const payload = JSON.stringify(event)

    try {
        await Promise.all([
            redis.publish(`run:${event.runId}`, payload),
            redis.xadd(
                `run_events:${event.runId}`,
                'MAXLEN',
                '~',
                '2000',
                '*',
                'payload',
                payload,
            ),
        ])
    }
    catch (err) {
        logger.error('Failed to publish custom event', { error: err, event })
        enqueuePending(event as unknown as AgentStreamEvent)
    }
}
```

添加 import：`import type { AgentCustomEvent } from '#shared/types/agentRun'`

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add server/services/agent/agentEventBridge.ts
git commit -m "feat(eventBridge): 新增 publishCustomEvent 独立函数"
```

---

## Task 5: chat.post.ts SSE 转发支持 custom_event

**Files:**
- Modify: `server/api/v1/case/analysis/chat.post.ts`

- [ ] **Step 1: 在 replay 和实时转发中增加 custom_event 分支**

在 `chat.post.ts` 的 **replay（补发历史事件）** 循环中，修改 SSE 格式化逻辑：

```typescript
// 补发缺失事件
for (const evt of missed) {
    let sseData: string
    if (evt.type === 'stream_event') {
        sseData = `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`
    }
    else if (evt.type === 'custom_event') {
        sseData = `event: custom\ndata: ${JSON.stringify(evt.data)}\n\n`
    }
    else {
        sseData = `event: status\ndata: ${JSON.stringify(evt)}\n\n`
    }
    controller.enqueue(encoder.encode(sseData))
}
```

在 **实时转发** 循环中，增加 `custom_event` 分支：

```typescript
for await (const evt of createEventSubscription(runId, abortController.signal)) {
    if (evt.type === 'status_change' && TERMINAL_STATUSES.includes(evt.status)) {
        controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify(evt)}\n\n`))
        break
    }
    if (evt.type === 'stream_event') {
        controller.enqueue(encoder.encode(
            `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`,
        ))
    }
    if (evt.type === 'custom_event') {
        controller.enqueue(encoder.encode(
            `event: custom\ndata: ${JSON.stringify(evt.data)}\n\n`,
        ))
    }
}
```

**关键**：SSE event 名必须是 `custom`（不是具体事件名），`useStream` 的 `matchEventType` 按此规则匹配。

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add server/api/v1/case/analysis/chat.post.ts
git commit -m "feat(chat): SSE 转发支持 custom_event 类型（replay + 实时）"
```

---

## Task 6: save_analysis_result 工具

**Files:**
- Create: `server/services/workflow/tools/saveAnalysisResult.tool.ts`
- Test: `tests/server/workflow/tools/saveAnalysisResult.test.ts`

- [ ] **Step 1: 编写工具测试**

创建 `tests/server/workflow/tools/saveAnalysisResult.test.ts`：

```typescript
import { describe, expect, it, vi } from 'vitest'

// 测试工具的核心逻辑：保存+激活+发布事件
describe('save_analysis_result tool', () => {
    it('should save analysis result and activate version', async () => {
        // 验证调用 saveAndActivateAnalysisService 的参数
        // 验证调用 publishCustomEvent 的参数格式
        // 验证返回 { success: true, version: number }
    })

    it('should return error when save fails', async () => {
        // 验证异常处理返回 { success: false, error: string }
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/workflow/tools/saveAnalysisResult.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: 实现工具**

创建 `server/services/workflow/tools/saveAnalysisResult.tool.ts`：

```typescript
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ToolContext, ToolDefinition, ToolModule } from './types'
import { saveAndActivateAnalysisService } from '../../case/analysis.service'
import { publishCustomEvent } from '../../agent/agentEventBridge'

const schema = z.object({
    analysisResult: z.string().describe('分析结果内容，Markdown 格式'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'save_analysis_result',
    description: '保存分析结果。当你生成或更新了该模块的分析结果时，必须调用此工具保存。',
    schema,
}

interface ModuleToolContext extends ToolContext {
    moduleName: string
    nodeId: number
    runId: string
}

export function createTool(context: ModuleToolContext) {
    return tool(
        async (input) => {
            try {
                const analysis = await saveAndActivateAnalysisService({
                    caseId: context.caseId,
                    sessionId: context.sessionId,
                    nodeId: context.nodeId,
                    analysisType: context.moduleName,
                    analysisResult: input.analysisResult,
                })

                await publishCustomEvent({
                    type: 'custom_event',
                    runId: context.runId,
                    sessionId: context.sessionId,
                    name: 'analysis_result_saved',
                    data: {
                        version: analysis.version,
                        moduleName: context.moduleName,
                        analysisId: analysis.id,
                    },
                })

                return JSON.stringify({
                    success: true,
                    version: analysis.version,
                    message: `分析结果已保存为第${analysis.version}版`,
                })
            }
            catch (error: any) {
                logger.error('save_analysis_result failed', { error })
                return JSON.stringify({
                    success: false,
                    error: error.message || '保存分析结果失败',
                })
            }
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema: toolDefinition.schema,
        },
    )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/workflow/tools/saveAnalysisResult.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/workflow/tools/saveAnalysisResult.tool.ts tests/server/workflow/tools/saveAnalysisResult.test.ts
git commit -m "feat(tools): 新增 save_analysis_result 工具（保存+激活+事件通知）"
```

---

## Task 7: moduleContextMiddleware

**Files:**
- Create: `server/services/workflow/middleware/moduleContext.middleware.ts`
- Modify: `server/services/workflow/middleware/index.ts`（导出）
- Test: `tests/server/workflow/middleware/moduleContext.test.ts`

- [ ] **Step 1: 编写中间件测试**

创建 `tests/server/workflow/middleware/moduleContext.test.ts`，测试：
- 首轮注入全量上下文
- 后续轮次无变更时跳过
- 有新增材料时仅注入增量
- 其他模块版本变化时注入变化部分

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/workflow/middleware/moduleContext.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: 实现中间件**

创建 `server/services/workflow/middleware/moduleContext.middleware.ts`：

```typescript
import { createMiddleware } from 'langchain'
import { SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { getMaterialsByCaseIdService } from '../../material/material.service'
import { getMaterialContextService } from '../../material/materialContext.service'
import { loadCompletedResultsService } from '../../case/initAnalysis.service'
import { getCaseMemory } from '../context/moduleContextBuilder'

export const moduleContextMiddleware = (
    caseId: number,
    moduleName: string,
) => {
    return createMiddleware({
        name: 'ModuleContextMiddleware',
        stateSchema: z.object({
            _injectedSourceIds: z.array(z.number()).default([]),
            _lastMemoryHash: z.string().nullable().default(null),
            _injectedResultVersions: z.record(z.string(), z.string()).default({}),
            _currentModuleVersion: z.number().nullable().default(null),
        }),
        beforeAgent: {
            hook: async (state) => {
                try {
                    const sections: string[] = []
                    let newSourceIds = state._injectedSourceIds || []
                    let newMemoryHash = state._lastMemoryHash || null
                    let newResultVersions = { ...(state._injectedResultVersions || {}) }
                    let newCurrentVersion = state._currentModuleVersion || null

                    // 并发加载 4 种上下文的当前状态
                    const [materials, memory, completedResults] = await Promise.all([
                        getMaterialsByCaseIdService(caseId).catch(() => []),
                        getCaseMemory(caseId).catch(() => null),
                        loadCompletedResultsService(caseId).catch(() => ({})),
                    ])

                    // 1. 材料增量检测
                    const currentSourceIds = materials.map(m => m.id)
                    const newMaterialIds = currentSourceIds.filter(
                        id => !newSourceIds.includes(id),
                    )
                    if (newMaterialIds.length > 0 || newSourceIds.length === 0) {
                        if (newSourceIds.length === 0) {
                            // 首轮：全量注入
                            const context = await getMaterialContextService(materials)
                            if (context)
                                sections.push(`## 案件材料上下文\n${context}`)
                        }
                        else {
                            // 增量：仅新增材料（summary 模式）
                            sections.push(`## 新增案件材料\n（新增 ${newMaterialIds.length} 份材料）`)
                            // 可调用 getMaterialContextService 获取新增材料的摘要
                        }
                        newSourceIds = currentSourceIds
                    }

                    // 2. 长期记忆变更检测
                    const memoryHash = memory
                        ? createHash('md5').update(memory).digest('hex')
                        : null
                    if (memoryHash !== newMemoryHash) {
                        if (memory)
                            sections.push(`## 案件基本信息（长期记忆）\n${memory}`)
                        newMemoryHash = memoryHash
                    }

                    // 3. 其他模块分析结果变更检测
                    const otherResults = Object.entries(completedResults)
                        .filter(([key]) => key !== moduleName)
                    for (const [key, content] of otherResults) {
                        const contentHash = createHash('md5').update(content).digest('hex')
                        if (newResultVersions[key] !== contentHash) {
                            sections.push(`## ${key} 分析结果\n${content}`)
                            newResultVersions[key] = contentHash
                        }
                    }

                    // 4. 当前模块结果变更检测
                    const currentModuleResult = completedResults[moduleName]
                    if (currentModuleResult && newCurrentVersion === null) {
                        sections.push(`## 当前模块已有分析结果（基线）\n${currentModuleResult}`)
                        newCurrentVersion = 1
                    }

                    // 无变更则跳过
                    if (sections.length === 0) {
                        return {}
                    }

                    // 拼接为 SystemMessage，插入最新 HumanMessage 之前
                    const contextMessage = new SystemMessage(
                        `<!-- module-context -->\n${sections.join('\n\n')}`,
                    )
                    const lastHumanIdx = state.messages.findLastIndex(
                        (m: any) => m._getType?.() === 'human' || m.constructor?.name === 'HumanMessage',
                    )
                    if (lastHumanIdx >= 0) {
                        state.messages.splice(lastHumanIdx, 0, contextMessage)
                    }
                    else {
                        state.messages.push(contextMessage)
                    }

                    return {
                        _injectedSourceIds: newSourceIds,
                        _lastMemoryHash: newMemoryHash,
                        _injectedResultVersions: newResultVersions,
                        _currentModuleVersion: newCurrentVersion,
                    }
                }
                catch (error) {
                    logger.error('ModuleContextMiddleware failed, continuing without context', { error })
                    return {}
                }
            },
        },
    })
}
```

注意：以上代码是骨架，实际实现时需参考 `caseMaterialContextMiddleware` 的精确模式调整细节。

- [ ] **Step 4: 在 middleware/index.ts 中导出**

在 `server/services/workflow/middleware/index.ts` 中添加：

```typescript
export { moduleContextMiddleware } from './moduleContext.middleware'
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/server/workflow/middleware/moduleContext.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/services/workflow/middleware/moduleContext.middleware.ts server/services/workflow/middleware/index.ts tests/server/workflow/middleware/moduleContext.test.ts
git commit -m "feat(middleware): 新增 moduleContextMiddleware 增量上下文注入"
```

---

## Task 8: moduleAgent（runModuleChat）

**Files:**
- Create: `server/services/workflow/agents/moduleAgent.ts`

- [ ] **Step 1: 实现 runModuleChat**

创建 `server/services/workflow/agents/moduleAgent.ts`：

```typescript
import { createAgent, summarizationMiddleware, type ReactAgent } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { getCheckpointer, getStore } from '../checkpointer'
import { getValidNodeConfig } from '../../node/node.service'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import { pointConsumptionMiddleware } from '../middleware'
import { moduleContextMiddleware } from '../middleware/moduleContext.middleware'
import { createTool as createSaveAnalysisResultTool } from '../tools/saveAnalysisResult.tool'

interface ModuleAgentOptions {
    userId: number
    caseId: number
    moduleName: string
    nodeId: number
    command?: unknown
    runId?: string
}

export async function runModuleChat(
    sessionId: string,
    message: string | undefined,
    options: ModuleAgentOptions,
): Promise<ReadableStream<Uint8Array>> {
    const { userId, caseId, moduleName, nodeId, command, runId } = options

    // 并发加载
    const [checkpointer, store, nodeConfig] = await Promise.all([
        getCheckpointer(),
        getStore(),
        getValidNodeConfig(moduleName, `模块对话-${moduleName}`),
    ])

    // 创建模型（参考 caseMainAgent.ts 的 API key 获取模式）
    const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`模块 ${moduleName} 没有可用的 API 密钥`)
    }
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
    })

    // 工具上下文
    const toolContext: ToolContext & { moduleName: string; nodeId: number; runId: string } = {
        userId,
        caseId,
        sessionId,
        runId: runId || '',
        moduleName,
        nodeId,
    }

    // 加载节点配置的工具 + save_analysis_result
    const nodeTools = await getToolInstancesService(nodeConfig.tools, toolContext)
    const saveResultTool = createSaveAnalysisResultTool(toolContext)
    const allTools = [...nodeTools, saveResultTool]

    // 构建静态 system prompt
    const systemPromptParts = [
        nodeConfig.prompts.find(p => p.type === 'system')?.content || '',
        '当你生成或更新了该模块的分析结果时，必须调用 save_analysis_result 工具保存结果。',
    ].filter(Boolean)
    const systemPrompt = systemPromptParts.join('\n\n')

    // 创建 Agent
    const agent: ReactAgent = createAgent({
        model,
        systemPrompt,
        checkpointer,
        store,
        tools: allTools,
        middleware: [
            pointConsumptionMiddleware(userId, 'case_analysis_token'),
            moduleContextMiddleware(caseId, moduleName),
            summarizationMiddleware({
                model,
                trigger: [{ tokens: 100000 }],
            }),
        ],
    })

    // 构造输入
    const input = command
        ? new Command({ resume: command })
        : message
            ? { messages: [new HumanMessage(message)] }
            : { messages: [] }

    // 返回 SSE 流
    return agent.stream(input, {
        configurable: { thread_id: sessionId },
        streamMode: ['values', 'messages', 'updates'],
        subgraphs: true,
        encoding: 'text/event-stream',
        recursionLimit: 50,
    })
}
```

注意：不需要实现 `getModuleChatThreadState`，Worker 的 interrupt 检测分支中 type=3 自然落入 else 分支，调用已有的 `getChatThreadState`。

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add server/services/workflow/agents/moduleAgent.ts
git commit -m "feat(agent): 新增 moduleAgent 轻量级模块对话 Agent"
```

---

## Task 9: Worker 执行分支

**Files:**
- Modify: `server/services/agent/agentWorker.ts`

- [ ] **Step 1: 扩展 Worker select 和分支逻辑**

在 `agentWorker.ts` 中：

1. 修改 session 查询的 select，添加 metadata：

```typescript
const session = await prisma.caseSessions.findUnique({
    where: { sessionId: run.sessionId },
    select: { type: true, metadata: true },
})
```

2. 在 executeRun 的 if/else 分支中，在 `if (session?.type === 2)` 之后、`else` 之前插入：

```typescript
else if (session?.type === 3) {
    // 模块对话
    const { runModuleChat } = await import('../workflow/agents/moduleAgent')
    const metadata = session.metadata as { moduleName: string; nodeId: number }
    stream = await runModuleChat(run.sessionId, input.message, {
        userId,
        caseId,
        moduleName: metadata.moduleName,
        nodeId: metadata.nodeId,
        command,
        runId: run.id,
    })
}
```

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add server/services/agent/agentWorker.ts
git commit -m "feat(worker): 添加 session type=3 模块对话分支"
```

---

## Task 10: 模块 Session API

**Files:**
- Create: `server/api/v1/case/analysis/module-session.post.ts`
- Create: `server/api/v1/case/analysis/module-sessions.get.ts`
- Test: `tests/server/api/moduleSession.test.ts`

- [ ] **Step 1: 编写 API 测试**

创建 `tests/server/api/moduleSession.test.ts`，测试：
- 创建新 session 返回 isNew: true
- 再次请求同模块返回已有 session
- 查询活跃 session 列表

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/api/moduleSession.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: 实现 POST module-session**

创建 `server/api/v1/case/analysis/module-session.post.ts`：

```typescript
import { v4 as uuidv4 } from 'uuid'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '未登录')

    const body = await readBody(event)
    const { caseId, moduleName } = body

    if (!caseId || !moduleName) {
        return resError(event, 400, '缺少 caseId 或 moduleName')
    }

    // 验证案件权限
    const caseRecord = await prisma.cases.findFirst({
        where: { id: caseId, userId: user.id, deletedAt: null },
    })
    if (!caseRecord) return resError(event, 404, '案件不存在')

    // 查找已有 type=3 session
    const existing = await prisma.caseSessions.findFirst({
        where: {
            caseId,
            type: 3,
            deletedAt: null,
            metadata: { path: ['moduleName'], equals: moduleName },
        },
    })

    if (existing) {
        return resSuccess(event, { sessionId: existing.sessionId, isNew: false })
    }

    // 获取 nodeId
    const node = await getNodeByNameService(moduleName)
    if (!node) return resError(event, 404, `未找到模块节点: ${moduleName}`)

    // 创建新 session
    const sessionId = uuidv4()
    await createSessionDao({
        sessionId,
        caseId,
        type: 3,
        metadata: { moduleName, nodeId: node.id },
    })

    return resSuccess(event, { sessionId, isNew: true })
})
```

- [ ] **Step 4: 实现 GET module-sessions**

创建 `server/api/v1/case/analysis/module-sessions.get.ts`：

```typescript
export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '未登录')

    const query = getQuery(event)
    const caseId = Number(query.caseId)
    if (!caseId) return resError(event, 400, '缺少 caseId')

    // 验证案件权限
    const caseRecord = await prisma.cases.findFirst({
        where: { id: caseId, userId: user.id, deletedAt: null },
    })
    if (!caseRecord) return resError(event, 404, '案件不存在')

    // 查询所有 type=3 session
    const sessions = await prisma.caseSessions.findMany({
        where: { caseId, type: 3, deletedAt: null },
        select: { sessionId: true, metadata: true, status: true },
    })

    // 检查每个 session 是否有 activeRun
    const result = await Promise.all(
        sessions.map(async (s) => {
            const activeRun = await getActiveRunService(s.sessionId)
            const metadata = s.metadata as { moduleName: string; nodeId: number }
            return {
                sessionId: s.sessionId,
                moduleName: metadata.moduleName,
                nodeId: metadata.nodeId,
                hasActiveRun: !!activeRun,
            }
        }),
    )

    return resSuccess(event, result)
})
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/server/api/moduleSession.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/api/v1/case/analysis/module-session.post.ts server/api/v1/case/analysis/module-sessions.get.ts tests/server/api/moduleSession.test.ts
git commit -m "feat(api): 新增模块 session 创建/查询 API"
```

---

## Task 11: 前端 — useCaseChat 扩展 onCustomEvent

**Files:**
- Modify: `app/composables/useCaseChat.ts`

- [ ] **Step 1: 扩展 CaseChatOptions**

```typescript
export interface CaseChatOptions {
    sessionId: string
    onCustomEvent?: (data: any) => void
}
```

- [ ] **Step 2: 透传 onCustomEvent 到 useStream**

在 `useStream` 调用中添加 `onCustomEvent`：

```typescript
const stream = useStream<CaseAgentState>({
    transport,
    threadId: options.sessionId,
    messagesKey: 'messages',
    onCustomEvent: options.onCustomEvent,
    onError: (error) => { ... },
})
```

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add app/composables/useCaseChat.ts
git commit -m "feat(useCaseChat): 扩展 CaseChatOptions 支持 onCustomEvent 透传"
```

---

## Task 12: 前端 — useModuleChatManager

**Files:**
- Create: `app/composables/useModuleChatManager.ts`

- [ ] **Step 1: 实现 composable**

创建 `app/composables/useModuleChatManager.ts`：

```typescript
import type { ComputedRef, Ref } from 'vue'

export interface ModuleChatInstance {
    moduleName: string
    moduleTitle: string
    sessionId: Ref<string | null>
    messages: ComputedRef<any[]>
    isLoading: Ref<boolean>
    isExpanded: Ref<boolean>
    isActive: Ref<boolean>
    sendMessage: (message: string) => void
    stopGeneration: () => void
}

export function useModuleChatManager(caseId: Ref<number>) {
    const instances = reactive<Record<string, ModuleChatInstance>>({})
    const expandedModule = ref<string | null>(null)

    const activeModules = computed(() =>
        Object.values(instances).filter(i => i.isActive.value || i.isExpanded.value),
    )

    async function getOrCreateInstance(
        moduleName: string,
        moduleTitle: string,
    ): Promise<ModuleChatInstance> {
        if (instances[moduleName]) return instances[moduleName]

        const sessionId = ref<string | null>(null)
        const isExpanded = ref(false)
        const isActive = ref(false)

        // 获取或创建 session
        const { data } = await useApiFetch('/api/v1/case/analysis/module-session', {
            method: 'POST',
            body: { caseId: caseId.value, moduleName },
        })
        if (data.value?.sessionId) {
            sessionId.value = data.value.sessionId
        }

        // 创建 chat 实例（sessionId 获取后）
        let chatInstance: ReturnType<typeof useCaseChat> | null = null
        if (sessionId.value) {
            chatInstance = useCaseChat({
                sessionId: sessionId.value,
                onCustomEvent: (eventData: any) => {
                    if (eventData.name === 'analysis_result_saved') {
                        // 触发分析结果刷新
                        refreshNuxtData('caseDetail')
                    }
                },
            })
        }

        const instance: ModuleChatInstance = {
            moduleName,
            moduleTitle,
            sessionId,
            messages: computed(() => chatInstance?.messages.value || []),
            isLoading: chatInstance?.isLoading || ref(false),
            isExpanded,
            isActive,
            sendMessage: (message: string) => chatInstance?.sendMessage(message),
            stopGeneration: async () => {
                chatInstance?.stopGeneration()
                // 获取 runId 并取消
                if (sessionId.value) {
                    const { data: runData } = await useApiFetch(
                        `/api/v1/case/analysis/runs/current/${sessionId.value}`,
                    )
                    if (runData.value?.id) {
                        await useApiFetch(
                            `/api/v1/case/analysis/runs/cancel/${runData.value.id}`,
                            { method: 'POST' },
                        )
                    }
                }
            },
        }

        instances[moduleName] = instance
        return instance
    }

    function expandModule(moduleName: string) {
        // 收起其他窗口
        for (const key of Object.keys(instances)) {
            instances[key].isExpanded.value = key === moduleName
        }
        expandedModule.value = moduleName
    }

    function collapseAll() {
        for (const key of Object.keys(instances)) {
            instances[key].isExpanded.value = false
        }
        expandedModule.value = null
    }

    // 页面刷新恢复
    async function restoreActiveSessions() {
        const { data } = await useApiFetch(
            `/api/v1/case/analysis/module-sessions?caseId=${caseId.value}`,
        )
        if (data.value) {
            for (const session of data.value) {
                if (session.hasActiveRun) {
                    const instance = await getOrCreateInstance(
                        session.moduleName,
                        session.moduleName, // title 后续从节点配置获取
                    )
                    instance.isActive.value = true
                    // 触发重连：空 submit
                    // chatInstance 内部的 stream.submit(undefined) 会走重连分支
                }
            }
        }
    }

    // cleanup
    onUnmounted(() => {
        // stream 清理由各 useCaseChat 实例的 onUnmounted 处理
    })

    return {
        instances,
        getOrCreateInstance,
        expandModule,
        collapseAll,
        expandedModule,
        activeModules,
        restoreActiveSessions,
    }
}
```

注意：以上代码是骨架实现，实际开发时需根据 useApiFetch 的具体返回格式调整。

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add app/composables/useModuleChatManager.ts
git commit -m "feat(composable): 新增 useModuleChatManager 多模块对话管理"
```

---

## Task 13: 前端 — AnalysisModuleChat 悬浮窗组件

**Files:**
- Create: `app/components/case/AnalysisModuleChat.vue`
- Create: `app/components/case/AnalysisModuleChatBar.vue`

- [ ] **Step 1: 实现 AnalysisModuleChat.vue**

参考 `CaseDetailXiaosuo.vue` 的悬浮窗结构，使用 `AiChat` 组件：

```vue
<script setup lang="ts">
import type { ModuleChatInstance } from '~/composables/useModuleChatManager'

const props = defineProps<{
    caseId: number
    chatInstance: ModuleChatInstance
}>()

const isOpen = defineModel<boolean>({ default: false })
const isMobile = useMediaQuery('(max-width: 767px)')
const isFullscreen = ref(false)

watch(isOpen, (open) => {
    if (!open) isFullscreen.value = false
})
</script>

<template>
    <!-- 桌面端 -->
    <template v-if="!isMobile">
        <!-- 小窗模式 -->
        <div
            v-if="isOpen && !isFullscreen"
            class="absolute bottom-14 right-0 w-[380px] h-[500px] z-40
                   bg-background border rounded-lg shadow-lg flex flex-col overflow-hidden"
        >
            <div class="flex items-center justify-between px-3 py-2 border-b">
                <span class="text-sm font-medium">{{ chatInstance.moduleTitle }}</span>
                <div class="flex gap-1">
                    <Button variant="ghost" size="icon-xs" @click="isFullscreen = true">
                        <MaximizeIcon class="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-xs" @click="isOpen = false">
                        <XIcon class="size-3.5" />
                    </Button>
                </div>
            </div>
            <div class="flex-1 overflow-hidden">
                <AiChat
                    :messages="chatInstance.messages.value"
                    :loading="chatInstance.isLoading.value"
                    panel-mode="left"
                    @submit="(data) => chatInstance.sendMessage(data.message)"
                />
            </div>
        </div>

        <!-- 全屏模式 -->
        <div
            v-if="isOpen && isFullscreen"
            class="fixed md:absolute inset-0 z-50 bg-background flex flex-col"
        >
            <div class="flex items-center justify-between px-4 py-2 border-b">
                <span class="font-medium">{{ chatInstance.moduleTitle }}</span>
                <div class="flex gap-1">
                    <Button variant="ghost" size="icon-xs" @click="isFullscreen = false">
                        <MinimizeIcon class="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-xs" @click="isOpen = false">
                        <XIcon class="size-3.5" />
                    </Button>
                </div>
            </div>
            <div class="flex-1 overflow-hidden">
                <AiChat
                    :messages="chatInstance.messages.value"
                    :loading="chatInstance.isLoading.value"
                    panel-mode="left"
                    @submit="(data) => chatInstance.sendMessage(data.message)"
                />
            </div>
        </div>
    </template>

    <!-- 移动端 -->
    <Sheet v-else v-model:open="isOpen" side="bottom">
        <SheetContent class="h-[90vh] flex flex-col p-0">
            <SheetHeader class="px-4 py-2 border-b">
                <SheetTitle>{{ chatInstance.moduleTitle }}</SheetTitle>
            </SheetHeader>
            <div class="flex-1 overflow-hidden">
                <AiChat
                    :messages="chatInstance.messages.value"
                    :loading="chatInstance.isLoading.value"
                    panel-mode="left"
                    @submit="(data) => chatInstance.sendMessage(data.message)"
                />
            </div>
        </SheetContent>
    </Sheet>
</template>
```

- [ ] **Step 2: 实现 AnalysisModuleChatBar.vue**

最小化状态条：

```vue
<script setup lang="ts">
import type { ModuleChatInstance } from '~/composables/useModuleChatManager'

defineProps<{
    modules: ModuleChatInstance[]
}>()

const emit = defineEmits<{
    (e: 'expand', moduleName: string): void
}>()
</script>

<template>
    <div class="fixed bottom-4 right-4 z-30 flex flex-col gap-1">
        <button
            v-for="mod in modules"
            :key="mod.moduleName"
            class="flex items-center gap-2 px-3 py-1.5 bg-background border rounded-full
                   shadow-sm hover:shadow-md transition-shadow text-xs"
            @click="emit('expand', mod.moduleName)"
        >
            <Loader2Icon v-if="mod.isActive.value" class="size-3 animate-spin" />
            <CheckCircleIcon v-else class="size-3 text-green-500" />
            <span>{{ mod.moduleTitle }}</span>
        </button>
    </div>
</template>
```

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add app/components/case/AnalysisModuleChat.vue app/components/case/AnalysisModuleChatBar.vue
git commit -m "feat(ui): 新增模块对话悬浮窗和最小化状态条组件"
```

---

## Task 14: 前端 — 事件链集成

**Files:**
- Modify: `app/components/caseDetail/CaseDetailAnalysis.vue`
- Modify: `app/pages/dashboard/cases/[id].vue`

- [ ] **Step 1: CaseDetailAnalysis 转发 regenerate 事件**

在 `CaseDetailAnalysis.vue` 中：

1. 添加 emit 定义（使用 Vue 3.3+ 简洁语法，与现有代码一致）：

```typescript
const emit = defineEmits<{
    versionChanged: []
    regenerate: [result: AnalysisResult]
}>()
```

2. 在模板中 `<CaseAnalysisResults>` 上添加 `@regenerate` 监听：

```vue
<CaseAnalysisResults
    ...
    @version-changed="emit('versionChanged')"
    @regenerate="(result) => emit('regenerate', result)"
/>
```

- [ ] **Step 2: [id].vue 集成 moduleChatManager**

在 `app/pages/dashboard/cases/[id].vue` 中：

1. 引入 moduleChatManager：

```typescript
const moduleChatManager = useModuleChatManager(computed(() => caseId))
```

2. 处理 regenerate 事件：

```typescript
async function handleModuleRegenerate(result: AnalysisResult) {
    const instance = await moduleChatManager.getOrCreateInstance(
        result.moduleName,
        result.moduleTitle,
    )
    moduleChatManager.expandModule(result.moduleName)
}
```

3. 在 `<CaseDetailAnalysis>` 上监听：

```vue
<CaseDetailAnalysis
    ...
    @regenerate="handleModuleRegenerate"
/>
```

4. 在模板底部添加悬浮窗和状态条：

```vue
<!-- 当前展开的模块对话窗口 -->
<AnalysisModuleChat
    v-if="moduleChatManager.expandedModule.value && moduleChatManager.instances[moduleChatManager.expandedModule.value]"
    v-model="moduleChatManager.instances[moduleChatManager.expandedModule.value].isExpanded.value"
    :case-id="caseId"
    :chat-instance="moduleChatManager.instances[moduleChatManager.expandedModule.value]"
/>

<!-- 最小化状态条 -->
<AnalysisModuleChatBar
    :modules="moduleChatManager.activeModules.value.filter(m => !m.isExpanded.value)"
    @expand="moduleChatManager.expandModule"
/>
```

5. 页面刷新恢复：

```typescript
onMounted(() => {
    moduleChatManager.restoreActiveSessions()
})
```

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add app/components/caseDetail/CaseDetailAnalysis.vue app/pages/dashboard/cases/[id].vue
git commit -m "feat(ui): 集成模块对话到案件详情页，连通事件链"
```

---

## Task 15: 端到端验证

- [ ] **Step 1: 启动开发服务器**

Run: `bun dev`

- [ ] **Step 2: 手动测试完整流程**

1. 打开一个有分析结果的案件 → `/dashboard/cases/[id]?tab=analysis&am=detail`
2. 点击任意模块的对话按钮（MessageCircleIcon）
3. 验证悬浮窗弹出，使用 AiChat 组件
4. 输入消息，验证 Agent 回复
5. Agent 调用 save_analysis_result 工具，验证新版本创建
6. 关闭悬浮窗，验证最小化状态条
7. 再次打开，验证对话历史保留
8. 刷新页面，验证重连恢复

- [ ] **Step 3: 运行全量测试**

Run: `npx vitest run --reporter=verbose`
Expected: 所有测试通过

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat(analysis): 完成分析模块对话功能"
```
