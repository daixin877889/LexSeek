/**
 * 模块对话 Agent
 *
 * 轻量级 ReAct Agent，为每个分析模块（如案件摘要、大事记）提供独立的多轮对话能力
 * 使用 nodes 表中 type=analysis 且同 name 的节点配置
 *
 * 中间件：
 * - pointConsumptionMiddleware: 按 token 计费
 * - moduleContextMiddleware: 每轮对话前增量注入动态上下文
 * - summarizationMiddleware: 长对话摘要
 * - 注意：不挂载 analysisResultPersistenceMiddleware（与 save_analysis_result 工具冲突）
 */

import { createAgent, summarizationMiddleware, type ReactAgent } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { getCheckpointer, getStore } from '../checkpointer'
import { getValidNodeConfig } from '../../node/node.service'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import { pointConsumptionMiddleware } from '../middleware'
import { moduleContextMiddleware } from '../middleware/moduleContext.middleware'
import { createTool as createSaveAnalysisResultTool } from '../tools/saveAnalysisResult.tool'
import { renderSystemPrompt } from '../utils/promptRenderer'
import type { ToolContext } from '../tools/types'
import { getSessionState } from '../state/storage'

interface ModuleAgentOptions {
    userId: number
    caseId: number
    moduleName: string
    nodeId: number
    command?: unknown
    runId?: string
    thinking?: boolean
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
    })

    // 工具上下文（扩展 ModuleToolContext）
    const toolContext: ToolContext & { moduleName: string; nodeId: number; runId: string; getState: () => Promise<Record<string, any> | null> } = {
        userId,
        caseId,
        sessionId,
        runId: runId || '',
        moduleName,
        nodeId,
        getState: async () => getSessionState(sessionId),
    }

    // 加载节点配置的工具（同步函数）+ save_analysis_result 工具
    const nodeTools = nodeConfig.tools.length > 0
        ? getToolInstancesService(nodeConfig.tools, toolContext)
        : []
    const saveResultTool = createSaveAnalysisResultTool(toolContext)
    const allTools = [...nodeTools, saveResultTool]

    // 构建静态 system prompt（不变，命中供应商 Prompt Caching）
    const systemPromptParts = [
        renderSystemPrompt(nodeConfig, { caseId, moduleName }),
        '当你生成或更新了该模块的分析结果时，必须调用 save_analysis_result 工具保存结果。',
    ].filter(Boolean)
    const systemPrompt = systemPromptParts.join('\n\n')

    // 创建 Agent
    const agent: ReactAgent = createAgent({
        model,
        systemPrompt,
        checkpointer,
        store,
        tools: allTools,
        middleware: [
            pointConsumptionMiddleware(userId, 'case_analysis_token', sessionId),
            moduleContextMiddleware(caseId, moduleName),
            summarizationMiddleware({
                model,
                trigger: [{ tokens: 100000 }],
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
    return agent.stream(input, {
        configurable: { thread_id: sessionId },
        streamMode: ['values', 'messages', 'updates'],
        subgraphs: true,
        encoding: 'text/event-stream',
        recursionLimit: 1000,
    })
}
