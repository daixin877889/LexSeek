# 对话式代理重构：deepagents → LangGraph createAgent 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将对话式聊天代理从 deepagents SDK 迁移到 LangGraph 原生 createAgent，实现主代理+子代理动态路由架构，按 Token 计费，最终移除 deepagents 依赖。

**Architecture:** 主代理从 DB `nodes` 表 `caseMain` 节点加载配置，子代理从 `type=analysis/document` 的节点动态生成为 async generator tool。每次调用重新构建 agent 实例，确保 DB 变更即时生效。复用现有 SSE/Redis 事件管道和 pointConsumptionMiddleware。

**Tech Stack:** LangGraph (`@langchain/langgraph`), langchain (`createAgent`/`createMiddleware`), PostgreSQL checkpointer, Redis event bridge, Zod

**Spec:** `docs/superpowers/specs/2026-04-07-agent-deepagent-to-langgraph-design.md`

---

### Task 1: 创建子代理工具工厂 subAgentToolFactory.ts

**Files:**
- Create: `server/services/workflow/agents/subAgentToolFactory.ts`
- Test: `tests/server/workflow/agents/subAgentToolFactory.test.ts`
- Reference: `server/services/agent/caseAgent.ts:72-111`（现有子代理构建逻辑）
- Reference: `server/services/node/node.service.ts:552`（`getNodeConfigsByTypes`）
- Reference: `server/services/workflow/middleware/pointConsumption.middleware.ts:63`（middleware 用法）

- [ ] **Step 1: 编写 subAgentToolFactory 单元测试**

测试核心场景：
1. 从 NodeConfig 列表生成子代理工具数组
2. 跳过无可用 API Key 的节点（warn 日志）
3. 工具名称合法性（sanitizeName 去除非法字符）
4. 空配置列表返回空数组

```typescript
// tests/server/workflow/agents/subAgentToolFactory.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSubAgentTools, sanitizeName } from '~/server/services/workflow/agents/subAgentToolFactory'

// Mock 依赖
vi.mock('~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({ bindTools: vi.fn() })),
}))
vi.mock('~/server/services/workflow/tools', () => ({
    getToolInstancesService: vi.fn(() => []),
}))
vi.mock('langchain', () => ({
    createAgent: vi.fn(() => ({
        stream: vi.fn(async function* () { yield ['values', { messages: [] }] }),
    })),
}))
vi.mock('~/server/services/workflow/middleware', () => ({
    pointConsumptionMiddleware: vi.fn(() => ({})),
}))
vi.mock('~/server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn(async () => ({})),
}))

describe('subAgentToolFactory', () => {
    const mockNodeConfig = {
        id: 1,
        name: 'case_summary',
        title: '案件摘要分析',
        description: '分析案件摘要',
        type: 'analysis',
        modelSdkType: 'openai' as const,
        modelName: 'gpt-4',
        modelProviderBaseUrl: 'https://api.openai.com/v1',
        modelApiKeys: [{ id: 1, apiKey: 'sk-test', status: 1 }],
        prompts: [{ id: 1, name: 'sys', content: '你是案件分析助手', version: '1', type: 'system', status: 1 }],
        tools: [],
        outputSchema: null,
    }

    it('sanitizeName 应只保留字母数字下划线', () => {
        expect(sanitizeName('case-summary')).toBe('case_summary')
        expect(sanitizeName('legal.risk')).toBe('legal_risk')
        expect(sanitizeName('test@node#1')).toBe('test_node_1')
    })

    it('应为有效节点生成工具', async () => {
        const tools = await createSubAgentTools(
            [mockNodeConfig as any],
            { sessionId: 'sess-1', userId: 1, caseId: 1 }
        )
        expect(tools).toHaveLength(1)
        expect(tools[0].name).toBe('ask_case_summary_expert')
    })

    it('应跳过无 API Key 的节点', async () => {
        const noKeyConfig = {
            ...mockNodeConfig,
            name: 'no_key_node',
            modelApiKeys: [{ id: 1, apiKey: 'sk-old', status: 0 }],
        }
        const tools = await createSubAgentTools(
            [noKeyConfig as any],
            { sessionId: 'sess-1', userId: 1, caseId: 1 }
        )
        expect(tools).toHaveLength(0)
    })

    it('空配置列表返回空数组', async () => {
        const tools = await createSubAgentTools(
            [],
            { sessionId: 'sess-1', userId: 1, caseId: 1 }
        )
        expect(tools).toHaveLength(0)
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/server/workflow/agents/subAgentToolFactory.test.ts --reporter=verbose
```
预期：FAIL — 模块不存在

- [ ] **Step 3: 实现 subAgentToolFactory.ts**

```typescript
// server/services/workflow/agents/subAgentToolFactory.ts
/**
 * 子代理工具工厂
 *
 * 从数据库 nodes 配置动态生成子代理工具
 * 每个 analysis/document 类型的节点 → 一个 async generator tool
 * 子代理通过 createAgent 创建，支持独立 middleware 和 checkpointer
 */

import { tool } from '@langchain/core/tools'
import { createAgent } from 'langchain'
import { z } from 'zod'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import { pointConsumptionMiddleware } from '../middleware'
import { getCheckpointer } from '../checkpointer'
import type { NodeConfig } from '#shared/types/node'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { logger } from '#shared/utils/logger'

/**
 * 工具名称合法化：只保留字母、数字、下划线
 */
export function sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

interface SubAgentToolContext {
    sessionId: string
    userId: number
    caseId: number
}

/**
 * 从节点配置列表创建子代理工具
 *
 * 每个节点生成一个 async generator tool，
 * 主代理通过调用工具来委派任务给子代理。
 *
 * @param nodeConfigs - analysis/document 类型的节点配置
 * @param context - 会话上下文
 * @returns 子代理工具数组
 */
export async function createSubAgentTools(
    nodeConfigs: NodeConfig[],
    context: SubAgentToolContext,
): Promise<StructuredToolInterface[]> {
    const { sessionId, userId, caseId } = context
    const checkpointer = await getCheckpointer()
    const toolContext = { userId, caseId, sessionId }

    const tools = await Promise.all(
        nodeConfigs.map(async (config) => {
            // 检查 API Key
            const activeApiKey = config.modelApiKeys.find(k => k.status === 1)
            if (!activeApiKey) {
                logger.warn(`子代理 ${config.name} 没有可用的 API 密钥，已跳过`)
                return null
            }

            // 获取系统提示词
            const systemPromptConfig = config.prompts.find(
                p => p.type === 'system' && p.status === 1,
            )

            // 获取子代理自带工具
            const subTools = config.tools.length > 0
                ? getToolInstancesService(config.tools, toolContext)
                : []

            const safeName = sanitizeName(config.name)

            // 创建 async generator tool
            return tool(
                async function* (input: { question: string }) {
                    try {
                        // 每次调用时创建子代理模型（确保配置最新）
                        const subModel = createChatModel({
                            sdkType: config.modelSdkType,
                            modelName: config.modelName,
                            apiKey: activeApiKey.apiKey,
                            baseUrl: config.modelProviderBaseUrl,
                            temperature: 0.7,
                            streaming: true,
                            thinking: true,
                        })

                        // 创建子代理
                        const subAgent = createAgent({
                            model: subModel,
                            tools: subTools,
                            systemPrompt: systemPromptConfig?.content ?? '',
                            checkpointer,
                            name: config.name,
                            middleware: [
                                pointConsumptionMiddleware(userId, 'case_analysis_token'),
                            ],
                        })

                        // 流式执行子代理
                        const stream = await subAgent.stream(
                            { messages: [{ role: 'user', content: input.question }] },
                            {
                                configurable: { thread_id: `${sessionId}:${config.name}` },
                                streamMode: ['values', 'messages'],
                                version: 'v2' as const,
                            },
                        )

                        let finalContent = ''
                        for await (const [eventType, data] of stream) {
                            // yield 产生 on_tool_event，实现子代理流式输出
                            yield {
                                agent: config.name,
                                event: eventType,
                                data,
                            }
                            // 提取最终 AI 回复内容
                            if (eventType === 'values') {
                                const messages = (data as any)?.messages
                                if (Array.isArray(messages) && messages.length > 0) {
                                    const lastMsg = messages[messages.length - 1]
                                    if (lastMsg?.type === 'ai' && typeof lastMsg.content === 'string') {
                                        finalContent = lastMsg.content
                                    }
                                }
                            }
                        }
                        return finalContent || '子代理执行完成，无文本输出'
                    }
                    catch (error) {
                        // 错误降级：返回错误描述而非抛出异常
                        const errorMsg = error instanceof Error ? error.message : '未知错误'
                        logger.error(`子代理 ${config.name} 执行失败`, { error: errorMsg, sessionId })
                        return `子代理 ${config.title || config.name} 执行失败: ${errorMsg}`
                    }
                },
                {
                    name: `ask_${safeName}_expert`,
                    description: config.title || config.description || config.name,
                    schema: z.object({
                        question: z.string().describe('需要分析的问题或任务描述'),
                    }),
                },
            )
        }),
    )

    return tools.filter((t): t is NonNullable<typeof t> => t != null)
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/server/workflow/agents/subAgentToolFactory.test.ts --reporter=verbose
```
预期：全部 PASS

- [ ] **Step 5: 提交**

```bash
git add server/services/workflow/agents/subAgentToolFactory.ts tests/server/workflow/agents/subAgentToolFactory.test.ts
git commit -m "feat(agent): 添加子代理工具工厂 subAgentToolFactory"
```

---

### Task 2: 创建主代理 caseMainAgent.ts

**Files:**
- Create: `server/services/workflow/agents/caseMainAgent.ts`
- Test: `tests/server/workflow/agents/caseMainAgent.test.ts`
- Reference: `server/services/agent/caseAgent.ts:35-179`（现有 createCaseAgent + runCaseChat）
- Reference: `server/services/agent/caseAnalysis.ts:62-93`（createAgent + middleware 用法）

- [ ] **Step 1: 编写 caseMainAgent 单元测试**

测试核心场景：
1. runCaseChat 返回 ReadableStream
2. 正确加载 caseMain 节点配置
3. 子代理工具被合并到主代理工具列表
4. 中断恢复（command 参数）正确处理

```typescript
// tests/server/workflow/agents/caseMainAgent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 所有依赖
vi.mock('~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(),
    getNodeConfigsByTypes: vi.fn(),
}))
vi.mock('~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({})),
}))
vi.mock('~/server/services/workflow/tools', () => ({
    getToolInstancesService: vi.fn(() => []),
}))
vi.mock('~/server/services/workflow/agents/subAgentToolFactory', () => ({
    createSubAgentTools: vi.fn(async () => []),
}))
vi.mock('~/server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn(async () => ({})),
    getStore: vi.fn(async () => ({})),
}))
vi.mock('~/server/services/workflow/middleware', () => ({
    pointConsumptionMiddleware: vi.fn(() => ({})),
    caseMaterialContextMiddleware: vi.fn(() => ({})),
    summarizationMiddleware: vi.fn(() => ({})),
}))

const mockStream = new ReadableStream({
    start(controller) {
        controller.enqueue(new TextEncoder().encode('event: values\ndata: {}\n\n'))
        controller.close()
    },
})
vi.mock('langchain', () => ({
    createAgent: vi.fn(() => ({
        stream: vi.fn(async () => mockStream),
    })),
    HumanMessage: vi.fn((content: string) => ({ content, type: 'human' })),
    summarizationMiddleware: vi.fn(() => ({})),
}))

import { runCaseChat } from '~/server/services/workflow/agents/caseMainAgent'
import { getValidNodeConfig, getNodeConfigsByTypes } from '~/server/services/node/node.service'
import { createSubAgentTools } from '~/server/services/workflow/agents/subAgentToolFactory'

describe('caseMainAgent', () => {
    const mainNodeConfig = {
        id: 1,
        name: 'caseMain',
        title: '案件主代理',
        type: 'agent',
        modelSdkType: 'openai',
        modelName: 'gpt-4',
        modelProviderBaseUrl: 'https://api.openai.com/v1',
        modelApiKeys: [{ id: 1, apiKey: 'sk-main', status: 1 }],
        prompts: [{ id: 1, name: 'sys', content: '你是法律AI助手', version: '1', type: 'system', status: 1 }],
        tools: ['search_law'],
        outputSchema: null,
    }

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(getValidNodeConfig).mockResolvedValue(mainNodeConfig as any)
        vi.mocked(getNodeConfigsByTypes).mockResolvedValue([])
        vi.mocked(createSubAgentTools).mockResolvedValue([])
    })

    it('应返回 ReadableStream', async () => {
        const result = await runCaseChat('sess-1', '分析案件', {
            userId: 1,
            caseId: 1,
        })
        expect(result).toBeInstanceOf(ReadableStream)
    })

    it('应加载 caseMain 节点配置', async () => {
        await runCaseChat('sess-1', '分析', { userId: 1, caseId: 1 })
        expect(getValidNodeConfig).toHaveBeenCalledWith('caseMain', '案件主Agent')
    })

    it('应加载子代理节点', async () => {
        await runCaseChat('sess-1', '分析', { userId: 1, caseId: 1 })
        expect(getNodeConfigsByTypes).toHaveBeenCalledWith(['analysis', 'document'])
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/server/workflow/agents/caseMainAgent.test.ts --reporter=verbose
```
预期：FAIL — 模块不存在

- [ ] **Step 3: 实现 caseMainAgent.ts**

```typescript
// server/services/workflow/agents/caseMainAgent.ts
/**
 * 案件主代理（LangGraph 原生版）
 *
 * 使用 createAgent 创建主代理 + 子代理动态路由
 * 替代原 caseAgent.ts 的 deepagents 实现
 *
 * 主代理配置从 DB nodes 表 caseMain 节点加载
 * 子代理从 type=analysis/document 的节点动态生成为工具
 */

import { createAgent, summarizationMiddleware } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { getCheckpointer, getStore } from '../checkpointer'
import { getValidNodeConfig, getNodeConfigsByTypes } from '../../node/node.service'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import { pointConsumptionMiddleware, caseMaterialContextMiddleware, caseProcessMaterialMiddleware } from '../middleware'
import { createSubAgentTools } from './subAgentToolFactory'
import { logger } from '#shared/utils/logger'

const CASE_MAIN_NODE_NAME = 'caseMain'

export interface CaseAgentOptions {
    /** 用户 ID */
    userId: number
    /** 案件 ID */
    caseId: number
    /** 是否启用 extended thinking */
    thinking?: boolean
}

/**
 * 执行案件分析对话
 *
 * 返回 ReadableStream（SSE 格式），与现有 agentWorker 兼容。
 * 每次调用重新从 DB 加载配置，确保新增节点即时生效。
 *
 * @param sessionId 会话 ID（作为 thread_id）
 * @param message 用户消息（中断恢复时可为 undefined）
 * @param options Agent 选项
 * @returns ReadableStream<Uint8Array>（SSE 格式）
 */
export async function runCaseChat(
    sessionId: string,
    message: string | undefined,
    options: CaseAgentOptions & { command?: unknown },
): Promise<ReadableStream<Uint8Array>> {
    const { userId, caseId, thinking = true, command } = options

    // 1. 并发加载：checkpointer + store + 主代理配置 + 子代理配置
    const [checkpointer, store, mainConfig, subagentConfigs] = await Promise.all([
        getCheckpointer(),
        getStore(),
        getValidNodeConfig(CASE_MAIN_NODE_NAME, '案件主Agent'),
        getNodeConfigsByTypes(['analysis', 'document']),
    ])

    // 2. 获取可用 API 密钥
    const activeApiKey = mainConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${CASE_MAIN_NODE_NAME} 节点没有可用的 API 密钥`)
    }

    // 3. 创建主代理模型
    const model = createChatModel({
        sdkType: mainConfig.modelSdkType,
        modelName: mainConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: mainConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
        thinking,
    })

    // 4. 获取系统提示词
    const systemPromptConfig = mainConfig.prompts.find(
        p => p.type === 'system' && p.status === 1,
    )
    const systemPrompt = systemPromptConfig?.content

    // 5. 加载主代理通用工具
    const toolContext = { userId, caseId, sessionId }
    const mainTools = mainConfig.tools.length > 0
        ? getToolInstancesService(mainConfig.tools, toolContext)
        : []

    // 6. 生成子代理工具
    const subAgentTools = await createSubAgentTools(subagentConfigs, {
        sessionId,
        userId,
        caseId,
    })

    // 7. 合并工具列表
    const allTools = [...mainTools, ...subAgentTools]

    logger.info('案件主Agent创建', {
        sessionId,
        model: mainConfig.modelName,
        mainToolsCount: mainTools.length,
        subAgentToolsCount: subAgentTools.length,
        subAgentNames: subAgentTools.map(t => t.name),
    })

    // 8. 创建主代理
    const agent = createAgent({
        model,
        tools: allTools,
        systemPrompt,
        checkpointer,
        store,
        name: 'caseMain',
        middleware: [
            pointConsumptionMiddleware(userId, 'case_analysis_token'),
            caseProcessMaterialMiddleware(userId, caseId),
            caseMaterialContextMiddleware(userId, caseId),
            summarizationMiddleware({
                model,
                trigger: [{ tokens: 100000 }],
            }),
        ],
    })

    // 9. 构建输入（支持中断恢复）
    const input = command
        ? new Command({ resume: command })
        : { messages: [new HumanMessage(message!)] }

    // 10. 流式执行并返回 SSE 格式 ReadableStream
    return agent.stream(
        input,
        {
            configurable: { thread_id: sessionId },
            streamMode: ['values', 'messages', 'updates'],
            version: 'v2' as const,
            subgraphs: true,
            encoding: 'text/event-stream',
        },
    )
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/server/workflow/agents/caseMainAgent.test.ts --reporter=verbose
```
预期：全部 PASS

- [ ] **Step 5: 创建 index.ts 统一导出**

```typescript
// server/services/workflow/agents/index.ts
export { runCaseChat } from './caseMainAgent'
export { createSubAgentTools, sanitizeName } from './subAgentToolFactory'
```

- [ ] **Step 6: 提交**

```bash
git add server/services/workflow/agents/caseMainAgent.ts server/services/workflow/agents/index.ts tests/server/workflow/agents/caseMainAgent.test.ts
git commit -m "feat(agent): 添加主代理 caseMainAgent（LangGraph createAgent 实现）"
```

---

### Task 3: 切换 agentWorker 到新模块

**Files:**
- Modify: `server/services/agent/agentWorker.ts:154`
- Test: 手动验证 — Worker 的 import 切换不影响流程

- [ ] **Step 1: 修改 agentWorker.ts 的 import**

将第 154 行：
```typescript
const { runCaseChat } = await import('./caseAgent')
```
改为：
```typescript
const { runCaseChat } = await import('../workflow/agents')
```

- [ ] **Step 2: 确认 typecheck 通过**

```bash
npx nuxi typecheck
```
预期：无新增类型错误（runCaseChat 签名兼容）

- [ ] **Step 3: 提交**

```bash
git add server/services/agent/agentWorker.ts
git commit -m "refactor(agent): Worker 切换到新的 workflow/agents 模块"
```

---

### Task 3.5: 扩展 agentWorker interrupt 检测以覆盖对话式 session

**Files:**
- Modify: `server/services/agent/agentWorker.ts:226`

现有 interrupt 检测逻辑仅对 `session.type === 2`（结构化分析）生效。迁移后 `caseMainAgent` 的 `pointConsumptionMiddleware` 可能触发 `interrupt()`，需要对话式 session 也能正确处理。

- [ ] **Step 1: 扩展 interrupt 检测条件**

将第 226 行：
```typescript
if (session?.type === 2 && lastValuesData) {
```
改为（移除 type 限制，让所有 session 都检测 interrupt）：
```typescript
if (lastValuesData) {
```

同时第 228 行的 `getWorkflowThreadState` import 需要改为通用的 checkpointer thread state 读取方式（因为对话式 session 不走 caseAnalysisV2 workflow）：

```typescript
// 通用 interrupt 检测：从 checkpointer 读取 thread state
const { getCheckpointer } = await import('../workflow/checkpointer')
const checkpointer = await getCheckpointer()
const threadState = await checkpointer.getTuple({
    configurable: { thread_id: run.sessionId },
})
const tasks = (threadState?.checkpoint as any)?.pending_sends ?? []
// 或者使用 getWorkflowThreadState 的通用版本
```

**注意：** interrupt 检测的具体实现取决于 `createAgent` 产生的 checkpoint 结构。实现时需要先验证对话式 agent 被 interrupt 后 checkpoint 中的状态格式，然后据此调整检测逻辑。如果格式与 workflow 不同，可能需要两套检测逻辑。

- [ ] **Step 2: 确认 typecheck 通过**

```bash
npx nuxi typecheck
```

- [ ] **Step 3: 提交**

```bash
git add server/services/agent/agentWorker.ts
git commit -m "fix(agent): 扩展 Worker interrupt 检测以覆盖对话式 session"
```

---

### Task 4: 替换 extractInfo.ts 中的 deepagents 用法

**Files:**
- Modify: `server/services/workflow/nodes/extractInfo.ts:3,4,101-107`
- Reference: `server/services/agent/caseAnalysis.ts:1`（createAgent 导入示例）

- [ ] **Step 1: 修改 extractInfo.ts 的导入**

将第 3-4 行：
```typescript
import { createDeepAgent } from 'deepagents'
import { toolStrategy } from 'langchain'
```
改为：
```typescript
import { createAgent } from 'langchain'
```

- [ ] **Step 2: 替换 createDeepAgent 为 createAgent**

将第 99-116 行替换。关键变更：
1. `createDeepAgent` → `createAgent`
2. `toolStrategy(outputSchema)` → 通过 `createAgent` 的 `responseFormat` 参数传递
3. `result.structuredResponse` → 需要根据 `createAgent` 的实际返回结构调整

**重要：** `createAgent` 与 `withStructuredOutput` 的兼容性需要在实现时验证。`createAgent` 内部调用 `model.bindTools()` 可能与 `withStructuredOutput()` 冲突。

**首选方案：** 保持 agent 使用原始 model，在 agent 执行完成后单独调用 `model.withStructuredOutput(outputSchema).invoke()` 对 agent 输出做二次结构化提取：

```typescript
// 7. 创建 Agent（不使用结构化输出）
const checkpointer = await getCheckpointer()
const agent = createAgent({
    model,
    systemPrompt,
    tools,
    checkpointer,
})

// 8. Agent 自主执行
const result = await agent.invoke(
    { messages: state.messages },
    {
        configurable: { thread_id: `${sessionId}-extract-${Date.now()}` },
    },
)

// 9. 从 agent 输出中提取结构化数据
const lastAiMessage = result.messages?.filter((m: any) => m.type === 'ai').pop()
const agentOutput = typeof lastAiMessage?.content === 'string' ? lastAiMessage.content : ''

// 用 withStructuredOutput 做二次结构化提取
const structuredModel = model.withStructuredOutput(outputSchema as any)
const extracted: ExtractedCaseInfo = await structuredModel.invoke(agentOutput)
```

**备选方案：** 如果 `langchain` 包的 `createAgent` 支持 `responseFormat` 参数（如同 `toolStrategy` 在 deepagents 中的作用），则直接传递：
```typescript
const agent = createAgent({
    model,
    systemPrompt,
    tools,
    checkpointer,
    responseFormat: toolStrategy(outputSchema as any),  // 需验证 langchain 包是否导出 toolStrategy
})
```

实现时应先验证哪种方案可行。

- [ ] **Step 3: 确认 typecheck 通过**

```bash
npx nuxi typecheck
```

- [ ] **Step 4: 提交**

```bash
git add server/services/workflow/nodes/extractInfo.ts
git commit -m "refactor(workflow): extractInfo 替换 createDeepAgent 为 createAgent"
```

---

### Task 5: 更新依赖被删文件的 API 端点

**Files:**
- Modify: `server/api/v1/case/analysis/stream/[sessionId].post.ts:13,64-68`
- Modify: `server/api/v1/case/analysis/thread/[sessionId].get.ts:10`
- Move: `server/services/agent/threadState.ts` → `server/services/workflow/agents/threadState.ts`

- [ ] **Step 1: 迁移 threadState.ts 到新位置**

将 `server/services/agent/threadState.ts` 的 `getThreadValuesService` 和 `messageToFlatDict` 函数移动到 `server/services/workflow/agents/threadState.ts`（内容不变，只是路径变更）。

同时更新 `server/services/workflow/agents/index.ts` 添加导出：
```typescript
export { getThreadValuesService, messageToFlatDict } from './threadState'
```

- [ ] **Step 2: 更新 thread/[sessionId].get.ts 的 import**

将第 10 行：
```typescript
import { getThreadValuesService } from '~~/server/services/agent/threadState'
```
改为：
```typescript
import { getThreadValuesService } from '~~/server/services/workflow/agents'
```

- [ ] **Step 3: 更新 stream/[sessionId].post.ts**

将第 13 行：
```typescript
import { mainAgent } from '~~/server/services/agent/main'
```
改为：
```typescript
import { runCaseChat } from '~~/server/services/workflow/agents'
```

将第 64-68 行的调用：
```typescript
const agentStream = await mainAgent(sessionId, prompt, {
    thinking,
    userId: user.id,
    caseId: caseInfo.id,
})
```
改为：
```typescript
const agentStream = await runCaseChat(sessionId, prompt, {
    thinking,
    userId: user.id,
    caseId: caseInfo.id,
})
```

- [ ] **Step 4: 确认 typecheck 通过**

```bash
npx nuxi typecheck
```

- [ ] **Step 5: 提交**

```bash
git add server/services/workflow/agents/threadState.ts server/services/workflow/agents/index.ts server/api/v1/case/analysis/stream/\[sessionId\].post.ts server/api/v1/case/analysis/thread/\[sessionId\].get.ts
git commit -m "refactor(api): 更新 API 端点 import 指向新的 workflow/agents 模块"
```

---

### Task 6: 删除旧文件和移除 deepagents 依赖

**Files:**
- Delete: `server/services/agent/caseAgent.ts`
- Delete: `server/services/agent/main.ts`
- Delete: `server/services/agent/threadState.ts`（已迁移）
- Delete: `server/services/agent/caseAnalysis.ts`
- Modify: `package.json`（移除 deepagents）

- [ ] **Step 1: 确认无其他文件引用待删除模块**

```bash
# 搜索所有 import/require 引用
rg "from.*agent/caseAgent" server/ app/ --type ts
rg "from.*agent/main" server/ app/ --type ts
rg "from.*agent/threadState" server/ app/ --type ts
rg "from.*agent/caseAnalysis" server/ app/ --type ts
rg "from.*deepagents" server/ --type ts
rg "runCaseChatStream" server/ --type ts
```

预期：所有引用已在前面步骤中更新，无残留引用。如果有残留，先修复再继续。

- [ ] **Step 2: 删除旧文件**

```bash
rm server/services/agent/caseAgent.ts
rm server/services/agent/main.ts
rm server/services/agent/threadState.ts
rm server/services/agent/caseAnalysis.ts
```

- [ ] **Step 3: 移除 deepagents 依赖**

```bash
bun remove deepagents
```

- [ ] **Step 4: 确认 typecheck 和构建通过**

```bash
npx nuxi typecheck
bun run build
```

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "chore(agent): 删除旧 agent 文件并移除 deepagents 依赖"
```

---

### Task 7: 集成测试验证

**Files:**
- Test: 端到端验证所有路径

- [ ] **Step 1: 运行现有测试套件**

```bash
npx vitest run --reporter=verbose
```

确认所有现有测试通过，尤其是 workflow 相关测试。

- [ ] **Step 2: 确认 typecheck 无错误**

```bash
npx nuxi typecheck
```

- [ ] **Step 3: 启动开发服务器并手动验证**

```bash
bun dev
```

手动验证以下场景：
1. 打开 `/dashboard/analysis` 页面
2. 发送一条对话消息 → 主代理应正常响应
3. 发送需要子代理处理的消息 → 子代理应被正确调用
4. 刷新页面 → 对话历史应恢复
5. 验证积分扣减记录（检查数据库）

- [ ] **Step 4: 最终提交**

如果有修复，创建对应提交。

```bash
git add -A
git commit -m "test(agent): 集成测试验证 deepagents→createAgent 迁移"
```

---

## 任务依赖图

```
Task 1 (subAgentToolFactory) ─┐
                               ├── Task 2 (caseMainAgent) ── Task 3 (Worker 切换) ── Task 3.5 (interrupt 扩展) ──┐
Task 4 (extractInfo) ─────────┘                                                                                   ├── Task 6 (删除旧文件) ── Task 7 (集成测试)
Task 5 (API 端点更新，依赖 Task 2) ──────────────────────────────────────────────────────────────────────────────┘
```

- Task 1 和 Task 4 可以并行
- Task 2 依赖 Task 1
- Task 3 依赖 Task 2
- Task 3.5 依赖 Task 3
- Task 5 依赖 Task 2（使用 runCaseChat）
- Task 6 依赖 Task 3.5, 4, 5 全部完成
- Task 7 依赖 Task 6
