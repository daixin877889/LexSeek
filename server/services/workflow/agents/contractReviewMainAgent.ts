/**
 * 合同审查主代理（contractReviewMain 节点）
 *
 * 仿 documentMainAgent 骨架：
 * - 从 sessionId 反查 review（contractReviews.sessionId unique）
 * - 构造 buildRiskSchema() 作为 responseFormat
 * - 挂载 reviewResultPersistenceMiddleware（末位 afterAgent）
 * - 唯一工具 parseAndAskStance 由 toolModules 加载
 *
 * 参见 spec §6.2 / §6.6
 */

import {
    createAgent,
    summarizationMiddleware,
    toolStrategy,
    type ReactAgent,
} from 'langchain'
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
    reviewResultPersistenceMiddleware,
    buildMiddlewareStack,
    MIDDLEWARE_PRIORITY,
    MIDDLEWARE_NAMES,
} from '../middleware'
import { findContractReviewBySessionIdDAO } from '../../assistant/contract/contractReview.dao'
import { buildRiskSchema } from '../../assistant/contract/riskSchema.builder'

/** 合同审查主代理节点名称 */
const CONTRACT_MAIN_NODE_NAME = 'contractReviewMain'

/**
 * Agent 首轮启动指令。
 *
 * 要求模型：
 * 1. 第一步调用 parseAndAskStance 工具（触发 interrupt 等待用户立场）
 * 2. 第二步按 responseFormat 输出结构化风险清单
 */
function buildInitialPrompt(reviewId: number): string {
    return [
        `请审查合同（reviewId=${reviewId}）。`,
        '第一步：调用 parseAndAskStance 工具解析合同并请求用户立场；该工具会 interrupt 等待用户回复。',
        '第二步：工具返回后，根据 stance / stanceFocus / paragraphs 按 responseFormat 输出结构化风险清单。',
    ].join('\n')
}

export interface ContractReviewAgentOptions {
    /** 用户 ID */
    userId: number
    /** 来自 agentWorker.executeRun 的 AbortController，用户取消/超时时传入 */
    signal?: AbortSignal
    /** 中断恢复命令（若存在则走 resume 分支） */
    command?: unknown
}

/**
 * 执行合同审查对话。
 *
 * 使用 createAgent + 合同审查专用中间件栈创建主代理，
 * 返回 SSE 格式的 ReadableStream。
 *
 * @param sessionId 会话 ID（同时作为 thread_id 和 review.sessionId）
 * @param options Agent 选项
 * @returns ReadableStream（SSE 格式）
 */
export async function runContractReviewChat(
    sessionId: string,
    options: ContractReviewAgentOptions,
): Promise<ReadableStream<Uint8Array>> {
    const { userId, signal, command } = options

    // 1. 并发加载基础设施 + 反查 review
    const [checkpointer, store, nodeConfig, review] = await Promise.all([
        getCheckpointer(),
        getStore(),
        getValidNodeConfig(CONTRACT_MAIN_NODE_NAME, '合同审查主Agent'),
        findContractReviewBySessionIdDAO(sessionId),
    ])

    if (!review) {
        throw new Error(`No contract review found for session ${sessionId}`)
    }

    // 2. 获取可用 API Key
    const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${CONTRACT_MAIN_NODE_NAME} 节点没有可用的 API 密钥`)
    }

    // 3. 创建模型实例（temperature=0 确保审查稳定性）
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0,
        streaming: true,
    })

    // 4. 渲染系统提示词（注入 reviewId + contractType）
    const systemPrompt = renderSystemPrompt(nodeConfig, {
        reviewId: review.id,
        contractType: review.contractType ?? undefined,
    })

    // 5. 加载工具（传入 reviewId 关键上下文，parseAndAskStance 工具依赖）
    const toolContext = {
        userId,
        sessionId,
        reviewId: review.id,
    }
    const tools = nodeConfig.tools.length > 0
        ? getToolInstancesService(nodeConfig.tools, toolContext)
        : []

    logger.info('合同审查主 Agent 创建', {
        sessionId,
        reviewId: review.id,
        contractType: review.contractType,
        model: nodeConfig.modelName,
        toolsCount: tools.length,
    })

    // 6. 计算 summarization 触发阈值
    const contextWindow = nodeConfig.modelContextWindow || 128000
    const triggerTokens = Math.max(Math.floor(contextWindow * 0.6), 30000)

    // 7. 组装中间件栈（按 priority 排序：计费 → 摘要 → 安全裁剪 → 结果持久化）
    const middleware = buildMiddlewareStack([
        {
            middleware: pointConsumptionMiddleware(userId, 'contract_review_token', sessionId),
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
                maxTokens: Math.floor(contextWindow * 0.8),
            }),
            priority: MIDDLEWARE_PRIORITY.SAFETY_TRIM,
            name: MIDDLEWARE_NAMES.SAFETY_TRIM,
        },
        {
            middleware: reviewResultPersistenceMiddleware({
                reviewId: review.id,
                sessionId,
            }),
            priority: MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE,
            name: MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE,
        },
    ])

    // 8. 构造 responseFormat schema
    // 显式 toolStrategy 包装：强制所有 SDK（含 DeepSeek）通过结构化工具调用返回最终结果，
    // 避免模型把 JSON 写进消息正文导致 state.structuredResponse 为空（后续 persistence 置 failed）。
    // 与 documentMainAgent 保持一致。
    const riskSchema = buildRiskSchema()
    const responseFormat = toolStrategy(riskSchema)

    // 9. 组装 Agent
    const agent: ReactAgent = createAgent({
        model,
        systemPrompt,
        checkpointer,
        store,
        tools,
        responseFormat,
        middleware,
    })

    // 10. 构造输入：中断恢复时使用 Command；否则用首轮启动指令
    const input: Command | { messages: HumanMessage[] } = command
        ? new Command({ resume: command })
        : { messages: [new HumanMessage(buildInitialPrompt(review.id))] }

    // 11. 流式执行，返回 SSE 格式的 ReadableStream
    return agent.stream(input, {
        configurable: { thread_id: sessionId },
        streamMode: ['values', 'messages', 'updates'],
        subgraphs: true,
        encoding: 'text/event-stream',
        recursionLimit: 1000,
        signal,
    })
}
