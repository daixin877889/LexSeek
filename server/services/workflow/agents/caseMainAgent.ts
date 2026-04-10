/**
 * 案件主代理（LangGraph 原生版本）
 *
 * 使用 createAgent 创建统一的对话式案件主代理
 * 支持多轮对话、子代理工具委派、中断恢复
 */

import { createAgent, summarizationMiddleware, type ReactAgent } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { getCheckpointer, getStore } from '../checkpointer'
import { getValidNodeConfig, getNodeConfigsByTypes } from '../../node/node.service'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import { createSubAgentTools } from './subAgentToolFactory'
import { renderSystemPrompt } from '../utils/promptRenderer'
import {
    pointConsumptionMiddleware,
    caseProcessMaterialMiddleware,
    caseMaterialContextMiddleware,
} from '../middleware'

/** 主代理节点名称 */
const CASE_MAIN_NODE_NAME = 'caseMain'

/** 子代理节点类型 */
const SUB_AGENT_NODE_TYPES = ['analysis', 'document']

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
 * 使用 createAgent + middleware 创建主代理，
 * 子代理通过 createSubAgentTools 生成工具注入主代理，
 * 返回 SSE 格式的 ReadableStream。
 *
 * @param sessionId 会话 ID（作为 thread_id）
 * @param message 用户消息（中断恢复时为 undefined）
 * @param options Agent 选项
 * @returns ReadableStream（SSE 格式）
 */
export async function runCaseChat(
    sessionId: string,
    message: string | undefined,
    options: CaseAgentOptions & { command?: unknown },
): Promise<ReadableStream<Uint8Array>> {
    const { command, userId, caseId, thinking = true } = options

    // 1. 并发加载基础设施和配置
    const [checkpointer, store, mainConfig, subAgentConfigs] = await Promise.all([
        getCheckpointer(),
        getStore(),
        getValidNodeConfig(CASE_MAIN_NODE_NAME, '案件主Agent'),
        getNodeConfigsByTypes(SUB_AGENT_NODE_TYPES),
    ])

    // 2. 获取可用 API Key
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

    // 4. 获取系统提示词（渲染模板变量）
    const systemPrompt = renderSystemPrompt(mainConfig, { caseId })

    // 5. 加载主代理通用工具
    const toolContext = { userId, caseId, sessionId }
    const mainTools = mainConfig.tools.length > 0
        ? getToolInstancesService(mainConfig.tools, toolContext)
        : []

    // 6. 生成子代理工具
    const subAgentToolList = await createSubAgentTools(subAgentConfigs, toolContext)

    // 7. 合并工具列表
    const allTools = [...mainTools, ...subAgentToolList]

    logger.info('案件主 Agent 创建', {
        sessionId,
        model: mainConfig.modelName,
        mainToolsCount: mainTools.length,
        subAgentToolsCount: subAgentToolList.length,
        totalToolsCount: allTools.length,
    })

    // 8. 创建主代理
    const agent: ReactAgent = createAgent({
        model,
        systemPrompt,
        checkpointer,
        store,
        tools: allTools,
        middleware: [
            pointConsumptionMiddleware(userId, 'case_analysis_token', sessionId),
            caseProcessMaterialMiddleware(userId, caseId),
            caseMaterialContextMiddleware(userId, caseId),
            summarizationMiddleware({
                model,
                trigger: [{ tokens: 100000 }],
            }),
        ],
    })

    // 9. 构造输入：中断恢复时使用 Command，正常对话使用 HumanMessage
    const input = command
        ? new Command({ resume: command })
        : { messages: [new HumanMessage(message!)] }

    // 10. 流式执行，返回 SSE 格式的 ReadableStream
    return agent.stream(
        input,
        {
            configurable: {
                thread_id: sessionId,
            },
            streamMode: ['values', 'messages', 'updates'],
            subgraphs: true,
            encoding: 'text/event-stream',
            recursionLimit: 1000,
        },
    )
}

/**
 * 获取对话式 agent 的 thread state（用于 interrupt 检测）
 *
 * 与 caseAnalysisV2 的 getWorkflowThreadState 功能一致，
 * 创建一个最小化 agent 实例仅用于读取 checkpointer 中的 state。
 *
 * @param sessionId 会话 ID
 */
export async function getChatThreadState(sessionId: string) {
    const checkpointer = await getCheckpointer()

    // 创建最小化 agent 用于读取 state（不需要真实模型和工具）
    const dummyModel = createChatModel({
        sdkType: 'openai',
        modelName: 'gpt-4',
        apiKey: 'dummy',
        baseUrl: 'http://localhost',
    })

    const stateReader = createAgent({
        model: dummyModel,
        checkpointer,
    })

    return stateReader.getState({
        configurable: { thread_id: sessionId },
    })
}
