/**
 * 案件主 Agent
 *
 * 使用 deepagents 创建案件分析对话 Agent
 * 模型配置通过数据库节点配置（caseMain）获取，支持动态切换模型
 */

import { createDeepAgent } from 'deepagents'
import { HumanMessage } from '@langchain/core/messages'
import { getCheckpointer } from '../workflow/checkpointer'
import { getValidNodeConfig } from '../node/node.service'
import { createChatModel } from '../node/chatModelFactory'
import { getToolInstancesService } from '../workflow/tools'
import { logger } from '#shared/utils/logger'

/** Agent 节点配置名称（必须在后台管理中配置） */
const CASE_MAIN_NODE_NAME = 'caseMain'

interface MainAgentOptions {
    /** 是否启用 extended thinking（默认 true） */
    thinking?: boolean
    /** 用户 ID（工具加载需要） */
    userId?: number
    /** 案件 ID（工具加载需要） */
    caseId?: number
}

export const mainAgent = async (sessionId: string, prompt: string, options: MainAgentOptions = {}) => {
    const { thinking = true, userId, caseId } = options
    const checkpointer = await getCheckpointer()

    // 从数据库获取节点配置
    const nodeConfig = await getValidNodeConfig(CASE_MAIN_NODE_NAME, '案件主Agent')

    // 获取可用的 API 密钥
    const activeApiKey = nodeConfig.modelApiKeys.find((k) => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${CASE_MAIN_NODE_NAME} 节点的模型提供商没有可用的 API 密钥`)
    }

    // 通过 chatModelFactory 创建模型实例
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
        thinking,
    })

    // 获取系统提示词（优先使用数据库配置，否则使用默认值）
    const systemPromptConfig = nodeConfig.prompts.find((p) => p.type === 'system' && p.status === 1)
    const systemPrompt = systemPromptConfig?.content;

    // 从节点配置动态加载工具
    const tools = nodeConfig.tools.length > 0 && userId && caseId
        ? getToolInstancesService(nodeConfig.tools, { userId, caseId, sessionId })
        : []

    logger.info('案件主Agent创建', {
        sessionId,
        model: nodeConfig.modelName,
        sdkType: nodeConfig.modelSdkType,
        provider: nodeConfig.modelProviderName,
        toolsCount: tools.length,
    })

    const agent: any = createDeepAgent({
        model,
        systemPrompt,
        checkpointer,
        tools,
    })

    const streamConfig: any = {
        configurable: {
            thread_id: sessionId,
        },
        streamMode: ['values', 'messages'],
        encoding: 'text/event-stream',
    }

    return agent.stream(
        { messages: [new HumanMessage(prompt)] },
        streamConfig,
    )
}
