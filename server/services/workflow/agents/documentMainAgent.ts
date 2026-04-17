/**
 * 文书生成主代理（documentMain 节点）
 *
 * 仿 caseMainAgent 骨架，专用于文书草稿填写场景：
 * - 从 sessionId 反查 draft + template
 * - 按模板占位符构造 responseFormat schema
 * - 挂载 draftResultPersistenceMiddleware 持久化结果
 *
 * 参见 spec §6.7
 */

import { createAgent, summarizationMiddleware, type ReactAgent } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { getCheckpointer, getStore } from '../checkpointer'
import { getValidNodeConfig } from '../../node/node.service'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import { renderSystemPrompt } from '../utils/promptRenderer'
import {
    pointConsumptionMiddleware,
    safetyTrimMiddleware,
    draftResultPersistenceMiddleware,
} from '../middleware'
import { findDraftBySessionIdDAO } from '../../assistant/document/documentDraft.dao'
import { getDocumentTemplateDAO } from '../../assistant/document/documentTemplate.dao'
import { buildDraftSchema } from '../../assistant/document/draftSchema.builder'
import type { Placeholder } from '#shared/types/document'

/** 文书主代理节点名称 */
const DOCUMENT_MAIN_NODE_NAME = 'documentMain'

export interface DocumentAgentOptions {
    /** 用户 ID */
    userId: number
    /** 案件 ID（可选） */
    caseId?: number
    /** 来自 agentWorker.executeRun 的 AbortController，用户取消/超时时传入 */
    signal?: AbortSignal
    /** 中断恢复命令（若存在则走 resume 分支） */
    command?: unknown
}

/**
 * 执行文书草稿生成对话。
 *
 * 使用 createAgent + 文书专用中间件创建主代理，
 * 返回 SSE 格式的 ReadableStream。
 *
 * @param sessionId 会话 ID（同时作为 thread_id 和 draft.sessionId）
 * @param message 用户消息（中断恢复时为 undefined）
 * @param options Agent 选项
 * @returns ReadableStream（SSE 格式）
 */
export async function runDocumentChat(
    sessionId: string,
    message: string | undefined,
    options: DocumentAgentOptions,
): Promise<ReadableStream<Uint8Array>> {
    const { userId, caseId, signal, command } = options

    // 1. 从 sessionId 反查 draft + template（并发加载基础设施）
    const [checkpointer, store, nodeConfig, draft] = await Promise.all([
        getCheckpointer(),
        getStore(),
        getValidNodeConfig(DOCUMENT_MAIN_NODE_NAME, '文书生成主Agent'),
        findDraftBySessionIdDAO(sessionId),
    ])

    if (!draft) {
        throw new Error(`未找到 sessionId=${sessionId} 对应的文书草稿`)
    }

    const template = await getDocumentTemplateDAO(draft.templateId)
    if (!template) {
        throw new Error(`未找到 templateId=${draft.templateId} 对应的文书模板`)
    }

    // 2. 获取可用 API Key
    const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${DOCUMENT_MAIN_NODE_NAME} 节点没有可用的 API 密钥`)
    }

    // 3. 构造 responseFormat schema（由占位符列表动态生成）
    const schema = buildDraftSchema(template.placeholders as unknown as Placeholder[])

    // 4. 创建模型实例
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
    })

    // 5. 渲染系统提示词（注入模板名称和类别）
    const resolvedCaseId = draft.caseId ?? caseId
    const systemPrompt = renderSystemPrompt(nodeConfig, {
        caseId: resolvedCaseId,
        templateName: template.name,
        templateCategory: template.category,
    })

    // 6. 加载工具（传入 draftId 关键上下文）
    const toolContext = {
        userId,
        caseId: resolvedCaseId,
        sessionId,
        draftId: draft.id,
    }
    const tools = nodeConfig.tools.length > 0
        ? getToolInstancesService(nodeConfig.tools, toolContext)
        : []

    logger.info('文书生成主 Agent 创建', {
        sessionId,
        draftId: draft.id,
        templateId: template.id,
        templateName: template.name,
        model: nodeConfig.modelName,
        toolsCount: tools.length,
    })

    // 7. 计算 summarization 触发阈值
    const contextWindow = nodeConfig.modelContextWindow || 128000
    const triggerTokens = Math.max(Math.floor(contextWindow * 0.6), 30000)

    // 8. 组装 Agent（中间件顺序：计费 → 摘要 → 安全裁剪 → 持久化）
    // draftResultPersistenceMiddleware 必须最后，确保拿到最终 structuredResponse
    const agent: ReactAgent = createAgent({
        model,
        systemPrompt,
        checkpointer,
        store,
        tools,
        responseFormat: schema,
        middleware: [
            pointConsumptionMiddleware(userId, 'document_draft_token', sessionId),
            summarizationMiddleware({
                model,
                trigger: [{ tokens: triggerTokens }],
            }),
            safetyTrimMiddleware({
                model,
                maxTokens: Math.floor(contextWindow * 0.8),
            }),
            draftResultPersistenceMiddleware({ draftId: draft.id, sessionId }),
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
            signal,
        },
    )
}

/**
 * 读取文书生成会话 checkpoint 状态（用于 interrupt 检测）。
 *
 * 结构与 caseMainAgent 的 getChatThreadState 一致。
 *
 * @param sessionId 会话 ID
 */
export async function getDocumentThreadState(sessionId: string) {
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
