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
 * - 注意：不挂载 analysisResultPersistenceMiddleware（与 save_analysis_result 工具冲突）
 */

import { createAgent, summarizationMiddleware, type ReactAgent } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { Command } from '@langchain/langgraph'
import { getCheckpointer, getStore } from '../checkpointer'
import { getValidNodeConfig } from '../../node/node.service'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import {
    createAuditMiddleware,
    createMessageIntegrityMiddleware,
    createScopeGuardMiddleware,
    pointConsumptionMiddleware,
} from '../middleware'
import { buildSystemPromptForAgent } from '../context/moduleContextBuilder'
import { safetyTrimMiddleware } from '../middleware/safetyTrim.middleware'
import { createTool as createSaveAnalysisResultTool } from '../tools/saveAnalysisResult.tool'
import { renderSystemPrompt } from '../utils/promptRenderer'
import { buildSkillsMiddlewareForNode } from '~~/server/services/agent-platform/middleware/skills'
import { afterAgentMemoryMiddleware } from '~~/server/services/agent-platform/middleware/afterAgentMemory.middleware'
import { createTool as createReadSkillFileTool } from '../tools/readSkillFile.tool'
import { createTool as createWriteSkillFileTool } from '../tools/writeSkillFile.tool'
import { createTool as createRunSkillScriptTool } from '../tools/runSkillScript.tool'
import { createTool as createRunSkillCommandTool } from '../tools/runSkillCommand.tool'
import { createTool as createUploadWorkspaceFileTool } from '../tools/uploadWorkspaceFile.tool'
import type { ToolContext } from '../tools/types'
import { getSessionState } from '../state/storage'
import { resolveContextWindow } from '../context/messageCompressor'

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
        thinking: options.thinking,
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

    // 构建 5 段式上下文 prompt（roleAndFlow 段含 save_analysis_result 提醒，命中 1h cache）
    // 关键差异：agentName 用 moduleName，让 buildContextSegments 内部 caseAnalyses.findMany
    // { NOT: { analysisType: agentName } } 能正确排除当前模块自身的旧结果
    const roleAndFlowTemplate = [
        renderSystemPrompt(nodeConfig, { caseId, moduleName }),
        '当你生成或更新了该模块的分析结果时，必须调用 save_analysis_result 工具保存结果。',
    ].filter(Boolean).join('\n\n')

    const { systemMessage, plainText: plainTextPrompt } = await buildSystemPromptForAgent(
        nodeConfig.modelSdkType,
        { caseId, agentName: moduleName, userQuery: message ?? '', roleAndFlowTemplate },
    )

    const { triggerTokens, maxTokens, maxOutputTokens } = resolveContextWindow(
        nodeConfig.modelContextWindow,
        nodeConfig.modelMaxOutputTokens,
    )

    const agent: ReactAgent = createAgent({
        model,
        systemPrompt: systemMessage,
        checkpointer,
        store,
        tools: allTools,
        middleware: [
            // 消息完整性兜底必须最先：防止 orphan tool_use 引发 Provider 400
            createMessageIntegrityMiddleware(),
            createScopeGuardMiddleware(),
            pointConsumptionMiddleware(userId, 'case_analysis_token', sessionId),
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
            afterAgentMemoryMiddleware({ caseId, sessionId, userId }),
            createAuditMiddleware(),
        ],
    })

    // 构造输入：中断恢复 → Command，新消息 → HumanMessage，重连 → 空
    const input = command
        ? new Command({ resume: command })
        : message
            ? { messages: [new HumanMessage(message)] }
            : { messages: [] }

    // 返回 SSE 流
    return agent.stream(input, {
        configurable: { thread_id: sessionId },
        streamMode: ['values', 'messages', 'updates'],
        subgraphs: true,
        encoding: 'text/event-stream',
        recursionLimit: 1000,
        signal: options.signal,
    })
}
