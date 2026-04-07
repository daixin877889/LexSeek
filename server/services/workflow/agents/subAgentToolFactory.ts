/**
 * 子代理工具工厂
 *
 * 从 NodeConfig 列表生成子代理工具数组
 * 每个工具内部创建独立的 createAgent 子代理，通过流式执行返回结果
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { createAgent } from 'langchain'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import { pointConsumptionMiddleware } from '../middleware'
import { getCheckpointer, getStore } from '../checkpointer'
import type { NodeConfig } from '../../node/node.service'

/** 子代理工具上下文 */
export interface SubAgentToolContext {
    /** 用户 ID */
    userId: number
    /** 案件 ID */
    caseId: number
    /** 会话 ID */
    sessionId: string
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

        // 获取系统提示词
        const systemPromptConfig = config.prompts.find(
            p => p.type === 'system' && p.status === 1
        )
        const systemPrompt = systemPromptConfig?.content ?? ''

        const subAgentTool = tool(
            async (input: { question: string }): Promise<string> => {
                try {
                    // 创建模型实例
                    const model = createChatModel({
                        sdkType: config.modelSdkType,
                        modelName: config.modelName,
                        apiKey: activeApiKey.apiKey,
                        baseUrl: config.modelProviderBaseUrl,
                        temperature: 0.7,
                        streaming: true,
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

                    // 创建子代理
                    const agent = createAgent({
                        model,
                        systemPrompt,
                        tools: subTools,
                        checkpointer,
                        store,
                        middleware: [
                            pointConsumptionMiddleware(context.userId, 'case_analysis_token'),
                        ],
                    })

                    // 执行子代理（使用 invoke 而非 stream，因为工具需要完整返回值）
                    const result = await agent.invoke(
                        { messages: [{ role: 'user', content: input.question }] },
                        {
                            configurable: {
                                thread_id: `${context.sessionId}_sub_${safeName}`,
                            },
                            recursionLimit: 1000,
                        },
                    )

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
