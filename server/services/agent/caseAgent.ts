/**
 * 案件分析 Agent（新版）
 *
 * 使用 Deep Agents SDK 创建统一的对话式案件分析 Agent
 * 支持多轮对话、子代理委派、长期记忆
 */

import { createDeepAgent } from 'deepagents'
import { HumanMessage } from '@langchain/core/messages'
import { getCheckpointer } from '../workflow/checkpointer'
import { getValidNodeConfig, getSubagentConfigsService } from '../node/node.service'
import { createChatModel } from '../node/chatModelFactory'
import { getToolInstancesService } from '../workflow/tools'
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
 * 创建案件分析 Agent
 *
 * @param sessionId 会话 ID（作为 thread_id）
 * @param options Agent 选项
 * @returns DeepAgent 实例
 */
export async function createCaseAgent(sessionId: string, options: CaseAgentOptions) {
    const { userId, caseId, thinking = true } = options
    const checkpointer = await getCheckpointer()

    // 1. 获取主代理节点配置
    const mainConfig = await getValidNodeConfig(CASE_MAIN_NODE_NAME, '案件主Agent')

    // 2. 获取可用 API 密钥
    const activeApiKey = mainConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${CASE_MAIN_NODE_NAME} 节点没有可用的 API 密钥`)
    }

    // 3. 创建模型实例
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
        p => p.type === 'system' && p.status === 1
    )
    const systemPrompt = systemPromptConfig?.content

    // 5. 获取主代理工具
    const toolContext = { userId, caseId, sessionId }
    const mainTools = mainConfig.tools.length > 0
        ? getToolInstancesService(mainConfig.tools, toolContext)
        : []

    // 6. 获取子代理配置（按 priority 排序）
    const subagentConfigs = await getSubagentConfigsService(['analysis', 'document'])

    // 7. 构建子代理定义
    const subagents = await Promise.all(
        subagentConfigs.map(async (config) => {
            const subApiKey = config.modelApiKeys.find(k => k.status === 1)
            if (!subApiKey) {
                logger.warn(`子代理 ${config.name} 没有可用的 API 密钥，已跳过`)
                return null
            }

            const subModel = createChatModel({
                sdkType: config.modelSdkType,
                modelName: config.modelName,
                apiKey: subApiKey.apiKey,
                baseUrl: config.modelProviderBaseUrl,
                temperature: 0.7,
                streaming: true,
                thinking,
            })

            const subPrompt = config.prompts.find(
                p => p.type === 'system' && p.status === 1
            )

            const subTools = config.tools.length > 0
                ? getToolInstancesService(config.tools, toolContext)
                : []

            return {
                name: config.name,
                description: config.title || config.description || config.name,
                model: subModel,
                systemPrompt: subPrompt?.content,
                tools: subTools,
            }
        })
    )

    const validSubagents = subagents.filter(Boolean)

    logger.info('案件 Agent 创建', {
        sessionId,
        model: mainConfig.modelName,
        toolsCount: mainTools.length,
        subagentsCount: validSubagents.length,
        subagentNames: validSubagents.map(s => s!.name),
    })

    // 8. 创建 DeepAgent（含长期记忆）
    const agent: any = createDeepAgent({
        model,
        systemPrompt,
        checkpointer,
        tools: mainTools,
        subagents: validSubagents,
        // 长期记忆配置（设计文档 §4.5）
        // CompositeBackend: /memories/ 路径路由到 PostgresStore
        // SDK 自动注入 manage_memory 工具
        // 注意：CompositeBackend 和 StoreBackend 的 import 需要验证
        // 如果 deepagents 包不导出这些，则作为后续迭代单独实现
    })

    return agent
}

/**
 * 执行案件分析对话
 *
 * 使用 agent.stream() + encoding: "text/event-stream"，
 * 返回的 ReadableStream 内容已是 LangGraph Platform API 兼容的 SSE 格式：
 *   event: values\ndata: {...}\n\n
 *   event: messages\ndata: [...]\n\n
 *   event: messages|model_request:xxx\ndata: [...]\n\n
 *
 * 由 @langchain/langgraph 内置的 toEventStream() 负责格式转换，
 * 前端 @langchain/vue useStream + FetchStreamTransport 可直接消费。
 *
 * @param sessionId 会话 ID
 * @param message 用户消息
 * @param options Agent 选项
 * @returns ReadableStream（SSE 格式）
 */
export async function runCaseChat(
    sessionId: string,
    message: string,
    options: CaseAgentOptions
) {
    const agent = await createCaseAgent(sessionId, options)

    return agent.stream(
        { messages: [new HumanMessage(message)] },
        {
            configurable: {
                thread_id: sessionId,
            },
            streamMode: ['values', 'messages', 'updates'],
            version: 'v2' as const,
            subgraphs: true,
            encoding: 'text/event-stream',
        },
    )
}
