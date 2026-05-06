/**
 * 文书生成主代理(documentMain 节点)
 *
 * 平级主 Agent,跟 caseMain / assistantMain 同构。挂 legal-document-writer skill,
 * 用对话上下文 + skill 写作规范方法论产出字段值,通过 save_document_draft /
 * update_document_draft 工具主动写库。
 *
 * 架构差异(对比旧实现):
 * - 删除 toolStrategy / responseFormat / buildDraftSchema 强约束 schema
 * - 删除 draftResultPersistenceMiddleware afterAgent hook 兜底
 * - 系统 prompt 启动时注入 draft 当前状态(模板/已填字段/字段清单)
 *
 * @see docs/superpowers/specs/2026-05-05-document-agent-tool-refactor-design.md §5
 */

import { createAgent, summarizationMiddleware, type ReactAgent } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { getCheckpointer, getStore } from '../checkpointer'
import { getValidNodeConfig } from '../../node/node.service'
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
    buildMiddlewareStack,
    MIDDLEWARE_PRIORITY,
    MIDDLEWARE_NAMES,
} from '../middleware'
import { afterAgentMemoryMiddleware } from '~~/server/services/agent-platform/middleware/afterAgentMemory.middleware'
import { caseProcessMaterialMiddleware } from '~~/server/agents/_shared/case-context/caseProcessMaterial.middleware'
import { caseContextSyncMiddleware } from '~~/server/agents/_shared/case-context/caseContextSync.middleware'
import { buildLangfuseTopLevelConfig } from '~~/server/lib/langfuse'
import { findDraftBySessionIdDAO } from '../../assistant/document/documentDraft.dao'
import { getDocumentTemplateDAO } from '../../assistant/document/documentTemplate.dao'
import { resolveContextWindow } from '../context/messageCompressor'
import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base'

const DOCUMENT_MAIN_NODE_NAME = 'documentMain'

export interface DocumentAgentOptions {
    userId: number
    caseId?: number
    signal?: AbortSignal
    command?: unknown
    callbacks?: CallbackHandlerMethods[]
}

/**
 * 执行文书草稿生成对话(平级主 Agent 模式)。
 */
export async function runDocumentChat(
    sessionId: string,
    message: string | undefined,
    options: DocumentAgentOptions,
): Promise<ReadableStream<Uint8Array>> {
    const { userId, caseId, signal, command } = options

    // 1. 反查 draft + template + nodeConfig + 基建(并发)
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

    // 3. 创建模型实例
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
        maxTokens: nodeConfig.modelMaxOutputTokens,
    })

    // 4. 构建系统 prompt（仅含 roleAndFlow，草稿字段+占位符通过 caseContextSyncMiddleware 注入 HumanMessage）
    // 闭包外捕获：placeholders 渲染（template 不变，整 session 复用）
    const placeholders = (template.placeholders ?? []) as Array<{ name: string; firstContext?: string }>
    const placeholdersWithHints = placeholders
        .map(p => `- ${p.name}${p.firstContext ? `(参考上下文:${p.firstContext})` : ''}`)
        .join('\n')

    const resolvedCaseId = draft.caseId ?? caseId
    // SystemMessage 仅含 roleAndFlow（草稿字段+占位符 通过 caseContextSyncMiddleware 注入 HumanMessage）
    const roleAndFlowText = renderSystemPrompt(nodeConfig, {
        caseId: resolvedCaseId,
        templateName: template.name,
        templateCategory: template.category,
        draftId: draft.id,
        status: draft.status,
    })
    // 复用 buildSystemPromptForAgent 退化路径：caseId=null 时仅返单段 roleAndFlow + 按 SDK 分流
    // （Anthropic 1h cache_control / 其他 SDK plain text）。与 assistantAgent / runtime.ts 同款。
    const { systemMessage, plainText: systemPromptPlainText } = await buildSystemPromptForAgent(
        nodeConfig.modelSdkType,
        {
            caseId: null,
            agentName: DOCUMENT_MAIN_NODE_NAME,
            userQuery: '',
            roleAndFlowTemplate: roleAndFlowText,
        },
    )

    // 5. 加载工具(含 recommend_template / save_document_draft / update_document_draft)
    const toolContext = {
        userId,
        caseId: resolvedCaseId,
        sessionId,
        draftId: draft.id,
    }
    const baseTools = nodeConfig.tools.length > 0
        ? getToolInstancesService(nodeConfig.tools, toolContext)
        : []
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

    // draftLoader：闭包外 placeholders 已渲染好不变；闭包内每轮实时查 draft.values
    const draftLoader = async () => ({
        placeholdersWithHints,
        draftValuesJSON: async () => {
            const latest = await findDraftBySessionIdDAO(sessionId)
            return JSON.stringify(latest?.values ?? draft.values ?? {}, null, 2)
        },
    })

    // 6. 组装中间件栈(afterAgentMemory 条件挂载,agent-platform.md 铁律)
    const middleware = buildMiddlewareStack([
        // 业务私有：每轮自动补做未处理材料（仅 caseId 非空时挂）+ 实时拉案件 4 段 + 文书 2 段
        ...(resolvedCaseId
            ? [{
                // 文书生成主 Agent 函数签名当前没有 runId 闭包，传 null（中间件会跳过 SSE 推送，
                // 行为与升级前一致；用户在文书页看不到材料预处理进度卡片，但识别+摘要双就绪逻辑保留）
                middleware: caseProcessMaterialMiddleware(userId, resolvedCaseId, null, sessionId),
                priority: MIDDLEWARE_PRIORITY.PROCESS_MATERIAL,
                name: MIDDLEWARE_NAMES.PROCESS_MATERIAL,
            }]
            : []),
        {
            middleware: caseContextSyncMiddleware({
                caseId: resolvedCaseId ?? null,
                agentName: DOCUMENT_MAIN_NODE_NAME,
                draftLoader,
            }),
            priority: MIDDLEWARE_PRIORITY.MODULE_CONTEXT,
            name: MIDDLEWARE_NAMES.MODULE_CONTEXT,
        },
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
        // afterAgentMemory 条件挂载:caseId 非空时才挂(铁律)
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
        // 不再有 responseFormat:Agent 通过 tool call 主动写库,不靠 toolStrategy 强约束
        middleware,
    })

    // 7. 构造输入
    let input: Command | { messages: HumanMessage[] }
    if (command) {
        input = new Command({ resume: command })
    }
    else if (message !== undefined) {
        input = { messages: [new HumanMessage(message)] }
    }
    else {
        // 启动时无消息(checkpoint 重放),传空 messages 让 graph 从 checkpoint 恢复
        input = { messages: [] }
    }

    // 8. 流式执行
    const { createErrorTraceHandler } = await import(
        '~~/server/services/agent-platform/diagnostics/errorTraceHandler'
    )
    return agent.stream(
        input as any,
        {
            configurable: {
                thread_id: sessionId,
            },
            streamMode: ['values', 'messages', 'updates'],
            subgraphs: true,
            encoding: 'text/event-stream',
            recursionLimit: 1000,
            signal,
            ...buildLangfuseTopLevelConfig({
                additionalCallbacks: [
                    createErrorTraceHandler({
                        sessionId,
                        agentName: 'documentMain',
                        extra: { draftId: draft.id, templateId: template.id, caseId: resolvedCaseId },
                    }),
                    ...(options.callbacks ?? []),
                ],
            }),
        },
    )
}

/**
 * 读取文书会话 checkpoint 状态(用于 interrupt 检测)。
 * 结构与 caseMainAgent.getChatThreadState 一致。
 */
export async function getDocumentThreadState(sessionId: string) {
    const checkpointer = await getCheckpointer()

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
