import { createAgent, todoListMiddleware, summarizationMiddleware, type ReactAgent } from "langchain";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import { caseMaterialContextMiddleware, caseProcessMaterialMiddleware, createMessageIntegrityMiddleware, pointConsumptionMiddleware, analysisResultPersistenceMiddleware, safetyTrimMiddleware } from '../middleware'
import { renderSystemPrompt } from '../utils/promptRenderer'
import { resolveContextWindow } from '../context/messageCompressor'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { getCheckpointer, getStore } from '~~/server/services/workflow/checkpointer'


export interface AnalysisAgentOptions {
    /** 节点名称（必填） */
    agentName: string
    /** 会话 ID */
    sessionId: string
    /** 是否启用 extended thinking（默认 true） */
    thinking?: boolean
    /** 用户 ID（可在运行时通过 config.configurable 覆盖） */
    userId?: number
    /** 案件 ID（可在运行时通过 config.configurable 覆盖） */
    caseId?: number
    /** 提示词（可在运行时通过 config.configurable 覆盖） */
    prompt?: string
}

/** 从 config.configurable 中提取运行时参数 */
function extractRuntimeConfig(config?: LangGraphRunnableConfig) {
    const cfg = config?.configurable as Record<string, unknown> | undefined
    return {
        userId: cfg?.user_id as number | undefined,
        caseId: cfg?.case_id as number | undefined,
    }
}

/**
 * 案件分析 Agent
 *
 * 支持两种调用方式：
 * 1. 直接调用：传入 userId/caseId/prompt 作为占位值，运行时通过 config.configurable 覆盖
 * 2. 独立使用：传入完整的 userId/caseId（用于工具加载和 middleware）
 *
 * @param options 选项
 * @param runtimeConfig 可选：运行时配置，用于从 workflow state 中获取 userId/caseId/prompt
 * @returns Agent
 */
export const caseAnalysisAgent = async (
    agentName: string,
    options: Omit<AnalysisAgentOptions, 'agentName'>,
    runtimeConfig?: LangGraphRunnableConfig
): Promise<ReactAgent> => {
    const { thinking = true, sessionId } = options

    // 优先使用 runtimeConfig 中的值（workflow 场景）
    const runtime = extractRuntimeConfig(runtimeConfig)
    const userId = runtime.userId ?? options.userId
    const caseId = runtime.caseId ?? options.caseId

    const [checkpointer, store] = await Promise.all([getCheckpointer(), getStore()])

    // 从数据库获取节点配置
    const nodeConfig = await getValidNodeConfig(agentName)

    // 获取可用的 API 密钥
    const activeApiKey = nodeConfig.modelApiKeys.find((k) => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${agentName} 节点的模型提供商没有可用的 API 密钥`)
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
        maxTokens: nodeConfig.modelMaxOutputTokens,
    })

    // 获取系统提示词（优先使用数据库配置，并渲染模板变量）
    // agentName 对应 nodes 表中的节点名，即当前模块名
    const systemPrompt = renderSystemPrompt(nodeConfig, { caseId, moduleName: agentName })

    // 从节点配置动态加载工具（使用 runtime userId/caseId）
    const tools = nodeConfig.tools.length > 0 && userId && caseId
        ? getToolInstancesService(nodeConfig.tools, { userId, caseId, sessionId })
        : []

    logger.info(`${nodeConfig.title} Agent 创建`, {
        sessionId,
        userId,
        caseId,
        model: nodeConfig.modelName,
        sdkType: nodeConfig.modelSdkType,
        provider: nodeConfig.modelProviderName,
        toolsCount: tools.length,
    })

    const { triggerTokens, maxTokens, maxOutputTokens } = resolveContextWindow(
        nodeConfig.modelContextWindow,
        nodeConfig.modelMaxOutputTokens,
    )

    const agent: ReactAgent = createAgent({
        model,
        systemPrompt,
        checkpointer,
        tools,
        store,
        middleware: [
            // 消息完整性兜底必须最先：防止 orphan tool_use 引发 Provider 400
            createMessageIntegrityMiddleware(),
            pointConsumptionMiddleware(userId!, 'case_analysis_token', sessionId),
            caseProcessMaterialMiddleware(userId!, caseId!),
            caseMaterialContextMiddleware(userId!, caseId!),
            todoListMiddleware(),
            summarizationMiddleware({
                model,
                trigger: [{ tokens: triggerTokens }],
            }),
            safetyTrimMiddleware({
                model,
                maxTokens,
                systemPrompt,
                maxOutputTokens,
            }),
            // 末位：afterAgent 在所有其他中间件之后执行
            analysisResultPersistenceMiddleware({
                agentName,
                caseId: caseId!,
                sessionId,
                model,
            }),
        ],
    })

    return agent
}
