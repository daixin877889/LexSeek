/**
 * 模块对话 Agent
 *
 * 轻量级 ReAct Agent，为每个分析模块（如案件摘要、大事记）提供独立的多轮对话能力
 * 使用 nodes 表中 type=analysis 且同 name 的节点配置
 *
 * 中间件：
 * - pointConsumptionMiddleware: 按 token 计费
 * - 上下文注入: 通过 buildContextSegments 一次性构建 5 段式 system prompt（命中 prompt cache）
 * - summarizationMiddleware: 长对话摘要
 * - analysisResultPersistenceMiddleware: 末位兜底，与 save_analysis_result 工具通过
 *   state._analysisRecordId 协同——beforeAgent 先建 IN_PROGRESS 记录并把 id 注入 state；
 *   工具读到 id 时直接 update 同一条记录（避免双写）；afterAgent 检查 status，
 *   COMPLETED 跳过、IN_PROGRESS 兜底，保障"分析结果一定保存"的不变量。
 */

import { createAgent, summarizationMiddleware, type ReactAgent } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { Command } from '@langchain/langgraph'
import { getCheckpointer, getStore } from '../checkpointer'
import { getValidNodeConfig, resolveThinkingFromNodeConfig } from '../../node/node.service'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import {
    createAuditMiddleware,
    createMessageIntegrityMiddleware,
    createScopeGuardMiddleware,
    pointConsumptionMiddleware,
    userInjectionMiddleware,
} from '../middleware'
import { buildSystemPromptForAgent } from '../context/moduleContextBuilder'
import { safetyTrimMiddleware } from '../middleware/safetyTrim.middleware'
import { createTool as createSaveAnalysisResultTool } from '../tools/saveAnalysisResult.tool'
import { buildLangfuseTopLevelConfig, withLangfuseContext } from '~~/server/lib/langfuse'
import { renderSystemPrompt } from '../utils/promptRenderer'
import { buildSkillsMiddlewareForNode } from '~~/server/services/agent-platform/middleware/skills'
import { afterAgentMemoryMiddleware } from '~~/server/services/agent-platform/middleware/afterAgentMemory.middleware'
import { analysisResultPersistenceMiddleware } from '~~/server/agents/case-module/middleware/analysisResultPersistence.middleware'
import { caseProcessMaterialMiddleware } from '~~/server/agents/_shared/case-context/caseProcessMaterial.middleware'
import { caseContextSyncMiddleware } from '~~/server/agents/_shared/case-context/caseContextSync.middleware'
import { createTool as createReadSkillFileTool } from '../tools/readSkillFile.tool'
import { createTool as createWriteSkillFileTool } from '../tools/writeSkillFile.tool'
import { createTool as createRunSkillScriptTool } from '../tools/runSkillScript.tool'
import { createTool as createRunSkillCommandTool } from '../tools/runSkillCommand.tool'
import { createTool as createUploadWorkspaceFileTool } from '../tools/uploadWorkspaceFile.tool'
import type { ToolContext } from '../tools/types'
import { getSessionState } from '../state/storage'
import { resolveContextWindow } from '../context/messageCompressor'
import { prisma } from '~~/server/utils/db'

interface ModuleAgentOptions {
    userId: number
    caseId: number
    moduleName: string
    nodeId: number
    command?: unknown
    runId?: string
    thinking?: boolean
    /** 来自 agentWorker.executeRun 的 AbortController，用户取消/超时时传入 */
    signal?: AbortSignal
}

/**
 * 执行模块对话
 *
 * @param sessionId 会话 ID（同时作为 LangGraph thread_id）
 * @param message 用户消息（重连时可为 undefined）
 * @param options 模块对话选项
 * @returns SSE 格式的 ReadableStream
 */
export async function runModuleChat(
    sessionId: string,
    message: string | undefined,
    options: ModuleAgentOptions,
): Promise<ReadableStream<Uint8Array>> {
    return withLangfuseContext(
        {
            runId: options.runId,
            sessionId,
            threadId: sessionId,
            userId: options.userId,
            caseId: options.caseId,
            vertical: 'case-module',
        },
        () => runModuleChatInner(sessionId, message, options),
    )
}

async function runModuleChatInner(
    sessionId: string,
    message: string | undefined,
    options: ModuleAgentOptions,
): Promise<ReadableStream<Uint8Array>> {
    const { userId, caseId, moduleName, nodeId, command, runId } = options

    // 并发加载基础设施和节点配置
    const [checkpointer, store, nodeConfig] = await Promise.all([
        getCheckpointer(),
        getStore(),
        getValidNodeConfig(moduleName, `模块对话-${moduleName}`),
    ])

    // 创建模型（参考 caseMainAgent 的 API key 获取模式）
    const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`模块 ${moduleName} 没有可用的 API 密钥`)
    }
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
        thinking: resolveThinkingFromNodeConfig(nodeConfig, options.thinking),
        maxTokens: nodeConfig.modelMaxOutputTokens,
    })

    // 工具上下文（扩展 ModuleToolContext）
    const toolContext: ToolContext & { moduleName: string; nodeId: number; runId: string; getState: () => Promise<Record<string, any> | null>; model: typeof model } = {
        userId,
        caseId,
        sessionId,
        runId: runId || '',
        moduleName,
        nodeId,
        getState: async () => getSessionState(sessionId),
        model,
    }

    // 阶段 8：skillsMw 改成按节点动态构造（删模块级单例，让"模块对话只加载对应 skill"自动生效）
    // 节点未关联 skill 时返回 null，不挂 skillsMw 也不注入 4 个 skill 工具；
    // createUploadWorkspaceFileTool 是 case-module 业务专属工具，始终注入。
    const skillsMw = await buildSkillsMiddlewareForNode(nodeConfig.id)

    // 加载节点配置的工具（同步函数）+ save_analysis_result 工具
    // 按 name 去重：后注入的 skillTools / saveResultTool 胜出，避免 DB 中
    // nodeConfig.tools 同时登记了 skill 工具导致 LangChain AgentNode 检测到
    // "同名不同实例"而抛错（见 caseMainAgent.ts 相同防护）
    const nodeTools = nodeConfig.tools.length > 0
        ? getToolInstancesService(nodeConfig.tools, toolContext)
        : []
    const saveResultTool = createSaveAnalysisResultTool(toolContext)
    const skillTools: StructuredToolInterface[] = skillsMw
        ? [
            createReadSkillFileTool(toolContext),
            createWriteSkillFileTool(toolContext),
            createRunSkillScriptTool(toolContext),
            createRunSkillCommandTool(toolContext),
            createUploadWorkspaceFileTool(toolContext),
        ]
        : [createUploadWorkspaceFileTool(toolContext)]
    const toolsByName = new Map<string, StructuredToolInterface>()
    for (const tool of [...nodeTools, saveResultTool, ...skillTools]) {
        toolsByName.set(tool.name, tool)
    }
    const allTools = Array.from(toolsByName.values())

    // SystemMessage 仅含 roleAndFlow（4 段案件上下文交给 caseContextSyncMiddleware 注入 HumanMessage）
    // 复用 buildSystemPromptForAgent 退化路径：caseId=null 时仅返单段 roleAndFlow + 按 SDK 分流
    const roleAndFlowText = [
        renderSystemPrompt(nodeConfig, { caseId, moduleName }),
        '当你完成该模块的分析后，请按以下顺序操作：1) 先以纯文本形式输出完整的分析报告（Markdown 格式）；2) 然后调用 save_analysis_result 工具（无需任何参数）。工具会自动从你刚输出的报告中读取内容保存。请勿在工具参数中重复正文。',
    ].filter(Boolean).join('\n\n')

    const { systemMessage, plainText: plainTextPrompt } = await buildSystemPromptForAgent(
        nodeConfig.modelSdkType,
        { caseId: null, agentName: moduleName, userQuery: '', roleAndFlowTemplate: roleAndFlowText },
    )

    const { triggerTokens, maxTokens, maxOutputTokens } = resolveContextWindow(
        nodeConfig.modelContextWindow,
        nodeConfig.modelMaxOutputTokens,
    )

    // 取案件名作为计费消耗记录的业务上下文标签（best-effort，查不到则空）
    const caseRow = await prisma.cases.findUnique({
        where: { id: caseId },
        select: { title: true },
    }).catch(() => null)
    const caseTitle = caseRow?.title ?? `案件_${caseId}`

    const agent: ReactAgent = createAgent({
        model,
        systemPrompt: systemMessage,
        checkpointer,
        store,
        tools: allTools,
        middleware: [
            // 业务私有：每轮自动补做未处理材料 + 实时拉案件上下文（plain array 顺序执行）
            caseProcessMaterialMiddleware(userId, caseId, runId, sessionId),
            caseContextSyncMiddleware({ caseId, agentName: moduleName }),
            // 消息完整性兜底必须最先：防止 orphan tool_use 引发 Provider 400
            createMessageIntegrityMiddleware(),
            createScopeGuardMiddleware(),
            pointConsumptionMiddleware(userId, 'case_analysis_token', sessionId, runId, caseTitle),
            summarizationMiddleware({
                model,
                trigger: [{ tokens: triggerTokens }],
            }),
            safetyTrimMiddleware({
                model,
                maxTokens,
                // safetyTrim 仅用于 token 计数，统一传 plain text 即可
                systemPrompt: plainTextPrompt,
                maxOutputTokens,
            }),
            ...(skillsMw ? [skillsMw] : []),
            // 用户每轮注入（反越狱护栏 / 隐藏注入）：节点配置中 type=user_injection && status=1
            // 的提示词，每轮 LLM 调用前作为隐藏 HumanMessage 插入到最新 HumanMessage 之前；
            // 不写回 state.messages、不进 checkpoint。节点无该类提示词时 middleware 内部 short-circuit。
            userInjectionMiddleware({
                prompts: nodeConfig.prompts,
                context: { caseId, moduleName },
            }),
            afterAgentMemoryMiddleware({ caseId, sessionId, userId }),
            createAuditMiddleware(),
            // 末位兜底：beforeAgent 创建 IN_PROGRESS + 注入 _analysisRecordId；
            // afterAgent 看 record.status：工具改过 → 跳过，没改 → 兜底落库。
            analysisResultPersistenceMiddleware({
                agentName: moduleName,
                caseId,
                sessionId,
                model,
                runId,
            }),
        ],
    })

    // 构造输入：中断恢复 → Command，新消息 → HumanMessage，重连 → 空
    const input = command
        ? new Command({ resume: command })
        : message
            ? { messages: [new HumanMessage(message)] }
            : { messages: [] }

    // 返回 SSE 流
    return agent.stream(input as any, {
        configurable: { thread_id: sessionId },
        streamMode: ['values', 'messages', 'updates'],
        subgraphs: true,
        encoding: 'text/event-stream',
        recursionLimit: 1000,
        signal: options.signal,
        ...buildLangfuseTopLevelConfig(),
    })
}
