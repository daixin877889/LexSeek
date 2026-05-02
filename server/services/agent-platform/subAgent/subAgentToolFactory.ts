/**
 * 子代理工具工厂
 *
 * 从 NodeConfig 列表生成子代理工具数组
 * 每个工具内部创建独立的 createAgent 子代理，通过流式执行返回结果
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { HumanMessage } from '@langchain/core/messages'
import { createAgent, summarizationMiddleware } from 'langchain'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { resolveThinkingFromNodeConfig } from '~~/server/services/node/node.service'
import { getToolInstancesService } from '~~/server/services/agent-platform/tools'
import {
    createAuditMiddleware,
    createMessageIntegrityMiddleware,
    createScopeGuardMiddleware,
    pointConsumptionMiddleware,
} from '~~/server/services/agent-platform/middleware'
import { safetyTrimMiddleware } from '~~/server/services/agent-platform/middleware/safetyTrim.middleware'
import { analysisResultPersistenceMiddleware } from '~~/server/services/workflow/middleware/analysisResultPersistence.middleware'
import { afterAgentMemoryMiddleware } from '~~/server/services/agent-platform/middleware/afterAgentMemory.middleware'
import { getCheckpointer, getStore } from '~~/server/services/agent-platform/checkpointer'
import { renderSystemPrompt } from '~~/server/services/workflow/utils/promptRenderer'
import { resolveContextWindow } from '~~/server/services/agent-platform/context/messageCompressor'
import { buildSystemPromptForAgent } from '~~/server/services/agent-platform/context/moduleContextBuilder'
import type { NodeConfig } from '~~/server/services/node/node.service'
import { buildSubAgentCallbacks } from './buildSubAgentCallbacks'
import { publishSubAgentStatus } from './publishSubAgentStatus'

/** 子代理工具上下文 */
export interface SubAgentToolContext {
    /** 用户 ID */
    userId: number
    /** 案件 ID */
    caseId: number
    /** 会话 ID */
    sessionId: string
    /** 主 Agent run id（agentRuns.id），供 callbacks 转发事件到同一 SSE 流 */
    runId: string
}

/**
 * 工具名合法化
 *
 * 将非字母数字下划线字符替换为 `_`，确保工具名称符合 LangChain 要求
 *
 * @param name 原始名称
 * @returns 合法的工具名称
 */
export function sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

/**
 * 从 NodeConfig 列表生成子代理工具数组
 *
 * 每个子代理工具是一个 async generator tool，内部：
 * - 从 NodeConfig 创建 model
 * - 加载工具
 * - 创建子代理（createAgent）
 * - 挂载 pointConsumptionMiddleware
 * - 流式执行，yield 每个事件
 * - try/catch 错误降级，返回错误字符串而非抛异常
 * - 跳过无可用 API Key 的节点
 *
 * @param nodeConfigs 节点配置列表
 * @param context 子代理工具上下文
 * @returns 子代理工具数组
 */
export async function createSubAgentTools(
    nodeConfigs: NodeConfig[],
    context: SubAgentToolContext,
): Promise<StructuredToolInterface[]> {
    if (nodeConfigs.length === 0) {
        return []
    }

    const tools: StructuredToolInterface[] = []

    for (const config of nodeConfigs) {
        // 查找可用的 API Key（status === 1）
        const activeApiKey = config.modelApiKeys.find(k => k.status === 1)
        if (!activeApiKey) {
            logger.warn(`子代理 ${config.name} 没有可用的 API 密钥，已跳过`)
            continue
        }

        const safeName = sanitizeName(config.name)
        const toolName = `ask_${safeName}_expert`
        const description = config.title || config.description || config.name
        // 子代理 agentName 用 NodeConfig.name（如 evidence_expert / risk_expert），
        // 与持久化中间件 / buildContextSegments 排除自身模块的 NOT 过滤保持一致
        const agentName = config.name

        // 渲染 NodeConfig 系统提示词模板（仅替换变量；五段式拼装由 buildContextSegments 负责）
        const roleAndFlowTemplate = renderSystemPrompt(config, { caseId: context.caseId })

        const subAgentTool = tool(
            async (input: { question: string }, cfg): Promise<string> => {
                // 从 ToolRunnableConfig.toolCall.id 拿主 Agent 那次 ask_*_expert tool_call 的 id
                const parentToolCallId = (cfg as any)?.toolCall?.id ?? ''
                const mainRunId = context.runId
                const nodeConfig = config   // 外层闭包的 NodeConfig（forEach 迭代变量）

                // subThreadId 提前声明，catch 分支发 failed 事件时也需要
                const subThreadId = `${context.sessionId}_sub_${safeName}`

                try {
                    // 创建模型实例
                    const model = createChatModel({
                        sdkType: config.modelSdkType,
                        modelName: config.modelName,
                        apiKey: activeApiKey.apiKey,
                        baseUrl: config.modelProviderBaseUrl,
                        temperature: 0.7,
                        streaming: true,
                        // 子代理无 ctx.thinking（前端开关），按节点配置默认决议；
                        // 不继承父 Agent 的 ctx.thinking，保持决议源清晰
                        thinking: resolveThinkingFromNodeConfig(config, undefined),
                        maxTokens: config.modelMaxOutputTokens,
                    })

                    // 加载子代理工具
                    const toolContext = {
                        userId: context.userId,
                        caseId: context.caseId,
                        sessionId: context.sessionId,
                    }
                    const subTools = config.tools.length > 0
                        ? getToolInstancesService(config.tools, toolContext)
                        : []

                    // 获取检查点器和存储
                    const [checkpointer, store] = await Promise.all([
                        getCheckpointer(),
                        getStore(),
                    ])

                    // 构建 5 段式上下文（与主 agent 同套 helper，保证 cache_control 行为一致）
                    const { systemMessage, plainText: systemPromptPlainText } = await buildSystemPromptForAgent(
                        config.modelSdkType,
                        {
                            caseId: context.caseId,
                            agentName,
                            userQuery: input.question,
                            roleAndFlowTemplate,
                        },
                    )

                    const initialMessages = [systemMessage, new HumanMessage(input.question)]

                    // 上下文压缩参数（与主 agent 同规格）
                    const { triggerTokens, maxTokens, maxOutputTokens } = resolveContextWindow(
                        config.modelContextWindow,
                        config.modelMaxOutputTokens,
                    )

                    // 创建子代理（systemPrompt 已通过 SystemMessage 注入，不再走 createAgent.systemPrompt）
                    const agent = createAgent({
                        model,
                        tools: subTools,
                        checkpointer,
                        store,
                        middleware: [
                            // 消息完整性兜底必须最先：子 agent 独立 thread 同样会遗留 orphan tool_use
                            createMessageIntegrityMiddleware(),
                            createScopeGuardMiddleware(),
                            pointConsumptionMiddleware(context.userId, 'case_analysis_token', context.sessionId),
                            summarizationMiddleware({
                                model,
                                trigger: [{ tokens: triggerTokens }],
                            }),
                            // 与主 agent 一致：用完整 5 段拼接的纯文本估算 token，避免低估
                            safetyTrimMiddleware({ model, maxTokens, systemPrompt: systemPromptPlainText, maxOutputTokens }),
                            analysisResultPersistenceMiddleware({
                                agentName,
                                caseId: context.caseId,
                                sessionId: context.sessionId,
                                model,
                                // 主 Agent runId：让 middleware afterAgent 完成落库后能 publish
                                // ANALYSIS_RESULT_SAVED 事件给主流，前端分析模块列表实时刷新
                                runId: mainRunId,
                            }),
                            afterAgentMemoryMiddleware({
                                caseId: context.caseId,
                                sessionId: context.sessionId,
                                userId: context.userId,
                            }),
                            createAuditMiddleware(),
                        ],
                    })

                    // 执行子代理（挂 callbacks 旁路转发事件，返回值仍走 invoke + messages 末尾 AI）
                    const result = await agent.invoke(
                        { messages: initialMessages },
                        {
                            configurable: {
                                thread_id: subThreadId,
                            },
                            recursionLimit: 1000,
                            callbacks: buildSubAgentCallbacks({
                                mainRunId,
                                sessionId: context.sessionId,
                                parentToolCallId,
                                agentName: nodeConfig.name,
                                subThreadId,
                            }),
                        },
                    )

                    await publishSubAgentStatus({
                        runId: mainRunId,
                        sessionId: context.sessionId,
                        status: 'completed',
                        agentName: nodeConfig.name,
                        threadId: subThreadId,
                        parentToolCallId,
                    })

                    // 从 agent 返回的 messages 中提取最后一条 AI 回复
                    const messages = result?.messages
                    if (Array.isArray(messages) && messages.length > 0) {
                        // 从后往前找最后一条 AI 消息
                        for (let i = messages.length - 1; i >= 0; i--) {
                            const msg = messages[i] as any
                            if (!msg) continue
                            const msgType = msg._getType?.() ?? msg.type
                            if (msgType === 'ai' && msg.content) {
                                const content = typeof msg.content === 'string'
                                    ? msg.content
                                    : JSON.stringify(msg.content)
                                if (content.trim()) return content
                            }
                        }
                    }

                    return '子代理执行完成，但未生成文本回复'
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : '未知错误'
                    logger.error(`子代理 ${config.name} 执行失败`, { error: errorMessage })

                    // 前端翻 isFailed=true + 显示 failureReason；fire-and-forget，已在
                    // catch 路径里再失败也无法上报
                    void publishSubAgentStatus({
                        runId: mainRunId,
                        sessionId: context.sessionId,
                        status: 'failed',
                        error: errorMessage,
                        agentName: nodeConfig.name,
                        threadId: subThreadId,
                        parentToolCallId,
                    })

                    return `子代理 ${config.title} 执行失败: ${errorMessage}`
                }
            },
            {
                name: toolName,
                description,
                schema: z.object({
                    question: z.string().describe('向该专家提出的问题'),
                }),
            },
        )

        tools.push(subAgentTool)
    }

    logger.info('子代理工具创建完成', {
        totalConfigs: nodeConfigs.length,
        createdTools: tools.length,
        toolNames: tools.map(t => t.name),
    })

    return tools
}
