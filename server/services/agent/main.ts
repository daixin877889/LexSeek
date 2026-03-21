/**
 * 案件主 Agent
 *
 * 使用 deepagents 创建案件分析对话 Agent
 * 模型配置通过数据库节点配置（caseMain）获取，支持动态切换模型
 */

import { createDeepAgent } from 'deepagents'
import { getCheckpointer } from '../workflow/checkpointer'
import { getValidNodeConfig } from '../node/node.service'
import { createChatModel } from '../node/chatModelFactory'
import { logger } from '#shared/utils/logger'

/** Agent 节点配置名称（必须在后台管理中配置） */
const CASE_MAIN_NODE_NAME = 'caseMain'

interface MainAgentOptions {
    /** 是否启用 extended thinking（默认 true） */
    thinking?: boolean
}

export const mainAgent = async (sessionId: string, prompt: string, options: MainAgentOptions = {}) => {
    const { thinking = true } = options
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
    const systemPrompt = systemPromptConfig?.content
        ?? '你是一个专业的律师，请根据用户的问题，给出专业的回答。'

    logger.info('案件主Agent创建', {
        sessionId,
        model: nodeConfig.modelName,
        sdkType: nodeConfig.modelSdkType,
        provider: nodeConfig.modelProviderName,
    })

    const agent: any = createDeepAgent({
        model,
        systemPrompt,
        checkpointer,
    })

    const streamConfig: any = {
        configurable: {
            thread_id: sessionId,
        },
        streamMode: ['values', 'messages', 'custom'],
        version: 'v2',
        subgraphs: true,
    }

    const result = await agent.streamEvents(
        {
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
        },
        streamConfig,
    )

    return result
}
