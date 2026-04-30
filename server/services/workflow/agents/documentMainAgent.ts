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

import { createAgent, summarizationMiddleware, toolStrategy, type ReactAgent } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { getCheckpointer, getStore } from '../checkpointer'
import { getValidNodeConfig, type NodeConfig } from '../../node/node.service'
import { renderContent } from '../../node/prompt.service'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import { renderSystemPrompt } from '../utils/promptRenderer'
import { buildSystemPromptForAgent } from '../context/moduleContextBuilder'
import {
    createAuditMiddleware,
    createMessageIntegrityMiddleware,
    createScopeGuardMiddleware,
    pointConsumptionMiddleware,
    safetyTrimMiddleware,
    draftResultPersistenceMiddleware,
    caseMaterialContextMiddleware,
    buildMiddlewareStack,
    MIDDLEWARE_PRIORITY,
    MIDDLEWARE_NAMES,
} from '../middleware'
import { afterAgentMemoryMiddleware } from '~~/server/services/agent-platform/middleware/afterAgentMemory.middleware'
import { findDraftBySessionIdDAO } from '../../assistant/document/documentDraft.dao'
import { getDocumentTemplateDAO } from '../../assistant/document/documentTemplate.dao'
import { buildDraftSchema } from '../../assistant/document/draftSchema.builder'
import type { Placeholder } from '#shared/types/document'
import { resolveContextWindow } from '../context/messageCompressor'
import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base'

/** 文书主代理节点名称 */
const DOCUMENT_MAIN_NODE_NAME = 'documentMain'

/**
 * 根据 draft 状态选择对应的 user prompt name。
 */
function pickInitialPromptName(draft: { sourceRef: unknown; caseId: number | null }): string {
    const sourceRef = (draft.sourceRef as Record<string, unknown> | null) ?? {}
    const fileIds = Array.isArray(sourceRef.fileIds)
        ? (sourceRef.fileIds as unknown[]).map(x => Number(x)).filter(n => Number.isInteger(n) && n > 0)
        : []
    if (fileIds.length > 0) return 'documentMain_user_with_files'
    if (draft.caseId != null) return 'documentMain_user_with_case'
    return 'documentMain_user_standalone'
}

/**
 * 从 draft.sourceRef 构造 Agent 首轮启动指令。
 *
 * 读 nodeConfig.prompts 中对应分支的 user prompt template，用 renderContent 注入变量。
 * 模板内容由运营在后台节点管理维护，不在代码中硬编。
 */
function buildInitialPromptFromDraft(
    draft: { sourceRef: unknown; caseId: number | null },
    templateName: string,
    nodeConfig: NodeConfig,
): string {
    const sourceRef = (draft.sourceRef as Record<string, unknown> | null) ?? {}
    const fileIds = Array.isArray(sourceRef.fileIds)
        ? (sourceRef.fileIds as unknown[]).map(x => Number(x)).filter(n => Number.isInteger(n) && n > 0)
        : []
    const userExtraText = typeof sourceRef.text === 'string' && sourceRef.text.trim()
        ? `用户补充说明：\n${sourceRef.text.trim()}`
        : ''

    const promptName = pickInitialPromptName(draft)
    const template = nodeConfig.prompts.find(
        p => p.name === promptName && p.type === 'user' && p.status === 1,
    )?.content
    if (!template) {
        throw new Error(`documentMain 节点缺少 ${promptName} prompt 配置`)
    }

    return renderContent(template, {
        templateName,
        fileIds: JSON.stringify(fileIds),
        userExtraText,
    })
}

/**
 * 创建 Agent 错误追踪 callback handler。
 *
 * Agent 执行过程中遇到未捕获错误时记录日志（含 sessionId / agentName / extra 上下文），
 * 便于排查问题。非侵入式设计：不干扰正常 streaming。
 */
function createErrorTraceHandler(params: {
    sessionId: string
    agentName: string
    extra?: Record<string, unknown>
}): CallbackHandlerMethods {
    return {
        handleChainError: async (err: Error) => {
            logger.error(`[${params.agentName}] Chain execution error`, {
                sessionId: params.sessionId,
                error: err.message,
                ...(params.extra ?? {}),
            })
        },
    }
}

export interface DocumentAgentOptions {
    /** 用户 ID */
    userId: number
    /** 案件 ID（可选） */
    caseId?: number
    /** 来自 agentWorker.executeRun 的 AbortController，用户取消/超时时传入 */
    signal?: AbortSignal
    /** 中断恢复命令（若存在则走 resume 分支） */
    command?: unknown
    /**
     * 子流事件转发到主流的 callbacks。
     *
     * 由 draftDocument.tool 调用时构造（buildSubAgentCallbacks），
     * 让 documentMain 内部的 LLM/tool 事件旁路 publish 给前端 subThreadsMap
     * 渲染 SubAgentChainOfThought CoT。
     *
     * 与 errorTraceHandler 合并：errorTraceHandler 在前（保留诊断），用户 callbacks 在后。
     */
    callbacks?: CallbackHandlerMethods[]
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
    // 显式使用 toolStrategy：强制所有模型（含 DeepSeek）通过专用结构化工具返回最终结果，
    // 避免模型把 JSON 写到消息正文里导致 state.structuredResponse 缺失。
    const schema = buildDraftSchema(template.placeholders as unknown as Placeholder[])
    const responseFormat = toolStrategy(schema)

    // 4. 创建模型实例
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
        maxTokens: nodeConfig.modelMaxOutputTokens,
    })

    // 5. 构建 5 段式系统提示词（caseId 可空：独立文书草稿场景传 null）
    const resolvedCaseId = draft.caseId ?? caseId
    const roleAndFlowTemplate = renderSystemPrompt(nodeConfig, {
        caseId: resolvedCaseId,
        templateName: template.name,
        templateCategory: template.category,
    })
    const { systemMessage, plainText: systemPromptPlainText } = await buildSystemPromptForAgent(
        nodeConfig.modelSdkType,
        {
            caseId: resolvedCaseId ?? null,
            agentName: DOCUMENT_MAIN_NODE_NAME,
            userQuery: message ?? '',
            roleAndFlowTemplate,
        },
    )

    // 6. 加载工具（传入 draftId 关键上下文）
    const toolContext = {
        userId,
        caseId: resolvedCaseId,
        sessionId,
        draftId: draft.id,
    }
    const baseTools = nodeConfig.tools.length > 0
        ? getToolInstancesService(nodeConfig.tools, toolContext)
        : []
    // 文书草稿场景必须能取案件已分析模块的全文（事实/请求/案由等精确字段）
    // 旧 nodes 表 documentMain.tools 未登记 search_case_analysis，此处兜底注入避免依赖 DB 配置
    const requiredToolNames = ['search_case_analysis']
    const baseNames = new Set(baseTools.map(t => t.name))
    const missingNames = requiredToolNames.filter(n => !baseNames.has(n))
    const supplementaryTools = missingNames.length > 0
        ? getToolInstancesService(missingNames, toolContext)
        : []
    const tools = [...baseTools, ...supplementaryTools]

    logger.info('文书生成主 Agent 创建', {
        sessionId,
        draftId: draft.id,
        templateId: template.id,
        templateName: template.name,
        model: nodeConfig.modelName,
        toolsCount: tools.length,
    })

    const { triggerTokens, maxTokens, maxOutputTokens } = resolveContextWindow(
        nodeConfig.modelContextWindow,
        nodeConfig.modelMaxOutputTokens,
    )

    // 8. 组装 Agent（通过 buildMiddlewareStack 按 priority 排序，保证顺序不依赖手动排列）
    // draftResultPersistenceMiddleware 必须最后，确保拿到最终 structuredResponse
    const middleware = buildMiddlewareStack([
        {
            middleware: createMessageIntegrityMiddleware(),
            priority: MIDDLEWARE_PRIORITY.MESSAGE_INTEGRITY,
            name: MIDDLEWARE_NAMES.MESSAGE_INTEGRITY,
        },
        {
            middleware: createScopeGuardMiddleware(),
            priority: MIDDLEWARE_PRIORITY.SCOPE_GUARD,
            name: MIDDLEWARE_NAMES.SCOPE_GUARD,
        },
        {
            middleware: pointConsumptionMiddleware(userId, 'document_draft_token', sessionId),
            priority: MIDDLEWARE_PRIORITY.POINT_CONSUMPTION,
            name: MIDDLEWARE_NAMES.POINT_CONSUMPTION,
        },
        ...(resolvedCaseId
            ? [{
                middleware: caseMaterialContextMiddleware(userId, resolvedCaseId),
                priority: MIDDLEWARE_PRIORITY.MATERIAL_CONTEXT,
                name: MIDDLEWARE_NAMES.MATERIAL_CONTEXT,
            }]
            : []),
        {
            middleware: summarizationMiddleware({
                model,
                trigger: [{ tokens: triggerTokens }],
            }),
            priority: MIDDLEWARE_PRIORITY.SUMMARIZATION,
            name: MIDDLEWARE_NAMES.SUMMARIZATION,
        },
        {
            middleware: safetyTrimMiddleware({
                model,
                maxTokens,
                systemPrompt: systemPromptPlainText,
                maxOutputTokens,
            }),
            priority: MIDDLEWARE_PRIORITY.SAFETY_TRIM,
            name: MIDDLEWARE_NAMES.SAFETY_TRIM,
        },
        {
            middleware: draftResultPersistenceMiddleware({ draftId: draft.id, sessionId }),
            priority: MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE,
            name: 'draftResultPersistence',
        },
        ...(resolvedCaseId
            ? [{
                middleware: afterAgentMemoryMiddleware({
                    caseId: resolvedCaseId,
                    sessionId,
                    userId,
                }),
                priority: MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE,
                name: 'afterAgentMemory',
            }]
            : []),
        {
            middleware: createAuditMiddleware(),
            priority: MIDDLEWARE_PRIORITY.AUDIT,
            name: MIDDLEWARE_NAMES.AUDIT,
        },
    ])
    const agent: ReactAgent = createAgent({
        model,
        systemPrompt: systemMessage,
        checkpointer,
        store,
        tools,
        responseFormat,
        middleware,
    })

    // 9. 构造输入：中断恢复时使用 Command；否则用用户消息或从 draft.sourceRef 自动组装启动指令
    // message 为 undefined 是正常场景（创建草稿后首次入队），此时从 draft 的 sourceRef 拼接启动提示
    let input: Command | { messages: HumanMessage[] }
    if (command) {
        input = new Command({ resume: command })
    }
    else {
        const startMessage = message ?? buildInitialPromptFromDraft(draft, template.name, nodeConfig)
        input = { messages: [new HumanMessage(startMessage)] }
    }

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
            callbacks: [
                createErrorTraceHandler({
                    sessionId,
                    agentName: 'documentMain',
                    extra: { draftId: draft.id, templateId: template.id, caseId: resolvedCaseId },
                }),
                ...(options.callbacks ?? []),
            ],
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
