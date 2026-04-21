/**
 * 通用法律助手主代理（assistantMain 节点）
 *
 * 对照 caseMainAgent 的 assistant 版：
 * - 系统提示词不假设 case 上下文
 * - 工具集不含 case 相关工具（由 nodes 表中 assistantMain 节点的 tools 字段控制）
 * - 中间件不注入 caseMaterialContext / caseProcessMaterial / moduleContext
 * - 积分计费键为 assistant_token（与 case_analysis_token 独立）
 *
 * 参见 spec §5.3 与 plan §1279-1414。
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
    createAuditMiddleware,
    createScopeGuardMiddleware,
    createToolCallLimitMiddlewares,
    pointConsumptionMiddleware,
    safetyTrimMiddleware,
} from '../middleware'
import { resolveContextWindow } from '../context/messageCompressor'

/** 通用法律助手主代理节点名称 */
const ASSISTANT_MAIN_NODE_NAME = 'assistantMain'

export interface AssistantAgentOptions {
    /** 用户 ID */
    userId: number
    /** 是否启用 extended thinking */
    thinking?: boolean
    /** 来自 agentWorker.executeRun 的 AbortController，用户取消/超时时传入 */
    signal?: AbortSignal
    /** 中断恢复命令（若存在则走 resume 分支） */
    command?: unknown
}

/**
 * 执行通用法律助手对话。
 *
 * 使用 createAgent + 精简中间件创建 assistant 主代理，
 * 返回 SSE 格式的 ReadableStream。
 *
 * @param sessionId 会话 ID（作为 thread_id）
 * @param message 用户消息（中断恢复时为 undefined）
 * @param options Agent 选项
 * @returns ReadableStream（SSE 格式）
 */
export async function runAssistantChat(
    sessionId: string,
    message: string | undefined,
    options: AssistantAgentOptions,
): Promise<ReadableStream<Uint8Array>> {
    const { userId, thinking = true, signal, command } = options

    // 1. 并发加载基础设施和配置
    const [checkpointer, store, mainConfig] = await Promise.all([
        getCheckpointer(),
        getStore(),
        getValidNodeConfig(ASSISTANT_MAIN_NODE_NAME, '通用法律助手主Agent'),
    ])

    // 2. 获取可用 API Key
    const activeApiKey = mainConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${ASSISTANT_MAIN_NODE_NAME} 节点没有可用的 API 密钥`)
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

    // 4. 渲染系统提示词：assistantMain 的 v1 提示词无模板变量
    const systemPrompt = renderSystemPrompt(mainConfig, {})

    // 5. 加载 assistant 域工具（无 caseId）
    const toolContext = { userId, sessionId }
    const tools = mainConfig.tools.length > 0
        ? getToolInstancesService(mainConfig.tools, toolContext)
        : []

    logger.info('通用法律助手 Agent 创建', {
        sessionId,
        model: mainConfig.modelName,
        toolsCount: tools.length,
        toolNames: tools.map(t => t.name),
    })

    const { triggerTokens, maxTokens } = resolveContextWindow(mainConfig.modelContextWindow)

    const agent: ReactAgent = createAgent({
        model,
        systemPrompt,
        checkpointer,
        store,
        tools,
        middleware: [
            // Agent 安全三层（scope 校验 / 工具调用熔断 / 审计归档）
            createScopeGuardMiddleware(),
            ...createToolCallLimitMiddlewares(),
            // assistant_token 独立计费（与 case_analysis_token 分开）
            pointConsumptionMiddleware(userId, 'assistant_token', sessionId),
            summarizationMiddleware({
                model,
                trigger: [{ tokens: triggerTokens }],
            }),
            safetyTrimMiddleware({
                model,
                maxTokens,
                systemPrompt,
            }),
            // audit 放最后：能同时捕获 scopeGuard 拒绝 / toolCallLimit 熔断 / 正常执行 / 异常四种情况
            createAuditMiddleware(),
        ],
    })

    // 7. 构造输入：中断恢复时使用 Command，正常对话使用 HumanMessage
    const input = command
        ? new Command({ resume: command })
        : { messages: [new HumanMessage(message!)] }

    // 8. 流式执行，返回 SSE 格式的 ReadableStream
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
 * 读取 assistant 会话 checkpoint 状态（用于 interrupt 检测 / 消息历史）。
 *
 * 结构与 caseMainAgent 的 getChatThreadState 一致。
 *
 * @param sessionId 会话 ID
 */
export async function getAssistantThreadState(sessionId: string) {
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
