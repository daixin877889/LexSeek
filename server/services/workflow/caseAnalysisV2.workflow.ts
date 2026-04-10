/**
 * 案件分析工作流
 *
 * 使用 LangGraph 原生编排（StateGraph + ToolNode）替代 ReactAgent
 * 解决 ReactAgent 在 streamMode 多模式下 invoke 失败的问题
 *
 * 每个分析模块内部构建独立的 ReAct 图（callModel → tools 循环）
 * 支持 streamMode: ['values', 'messages', 'updates'] + subgraphs: true
 */

import { StateGraph, StateSchema, Annotation, MessagesAnnotation, MessagesValue, ReducedValue, START, END, interrupt, isGraphInterrupt } from "@langchain/langgraph"
import { ToolNode } from '@langchain/langgraph/prebuilt'
import type { GraphNode } from "@langchain/langgraph"
import { HumanMessage, isAIMessage } from '@langchain/core/messages'
import { getCheckpointer } from './checkpointer'
import { buildModuleContext } from './context/moduleContextBuilder'
import { estimateMessagesTokens, getContextBudget, compressMessages, safetyTrimMessages } from './context/messageCompressor'
import { z } from "zod/v4"
import { getNodeConfigsByTypes, getValidNodeConfig, getNodeByNameService } from '../node/node.service'
import { createChatModel } from '../node/chatModelFactory'
import { getToolInstancesService } from './tools'
import { findAnalysisBySessionAndNodeDao, findLatestAnalysisBySessionAndNodeDao, AnalysisStatus } from '../case/analysis.dao'
import { markAnalysisFailedById } from './middleware/analysisResultPersistence.middleware'
import { deactivateVersionsDao, updateAnalysisDao, createAnalysisDao } from '../case/analysis.dao'
import { checkPointsService, consumePointsService } from '../point/pointConsumption.service'
import { getCurrentMembershipService } from '../membership/userMembership.service'
import { InterruptType } from '#shared/types/case'


/**
 * 工作流状态
 */
export const WorkflowState = new StateSchema({
    /** 会话 ID */
    sessionId: z.string(),
    /** 用户 ID */
    userId: z.number(),
    /** 案件 ID */
    caseId: z.number(),
    /** 是否启用 extended thinking（默认 true） */
    thinking: z.boolean().default(true),
    /** 提示词 */
    prompt: z.string().optional(),
    /** 消息 */
    messages: MessagesValue,
    /** 用户选择的分析模块 */
    selectedModules: z.array(z.string()).default(['summary', 'chronicle', 'claim', 'trend', 'cause', 'defense', 'evidence']),
    /** LLM 调用次数 */
    llmCalls: new ReducedValue(
        z.number().default(0),
        { reducer: (x, y) => x + y }
    ),
    /** 各模块分析结果 */
    result: new ReducedValue(
        z.record(z.string(), z.string()).default({}),
        { reducer: (a, b) => ({ ...a, ...b }) }
    ),
    /** 当前正在执行的模块名 */
    lastExecutedModule: z.string().default(''),
    /** 最近执行的模块结果 */
    lastExecutedResult: z.string().default(''),
    /** 最近执行的模块标题 */
    lastExecutedTitle: z.string().default(''),
    /** 失败的模块信息 */
    failedModules: new ReducedValue(
        z.record(z.string(), z.string()).default({}),
        { reducer: (a, b) => ({ ...a, ...b }) }
    ),
})


/** 每个汉字估算 4 tokens（无模型返回时的备降策略） */
const TOKENS_PER_CHAR = 4

/**
 * 计算消息列表中所有 AI 消息的总 token 用量
 *
 * 优先使用模型返回的 usage_metadata.total_tokens（精确值）
 * 无模型返回时按每个字符 4 token 估算（中文法律文本场景偏高估以覆盖成本）
 */
function calculateTotalTokens(messages: any[]): number {
    let total = 0
    for (const msg of messages) {
        if (!isAIMessage(msg)) continue

        // 优先使用模型返回的精确值
        if (msg.usage_metadata?.total_tokens) {
            total += msg.usage_metadata.total_tokens
            continue
        }

        // 备降：按字符数估算
        const content = typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content)
        let estimated = content.length * TOKENS_PER_CHAR

        // thinking tokens
        if (msg.additional_kwargs?.thinking) {
            const thinking = msg.additional_kwargs.thinking
            const text = Array.isArray(thinking)
                ? thinking.map((t: any) => t.thinking || '').join('')
                : String(thinking)
            estimated += text.length * TOKENS_PER_CHAR
        }

        // tool_calls tokens
        if (msg.tool_calls?.length) {
            estimated += JSON.stringify(msg.tool_calls).length * TOKENS_PER_CHAR
        }

        total += Math.max(estimated, 100)

        logger.warn('AI 消息缺少 usage_metadata，使用字符估算', {
            contentLength: content.length,
            estimated,
        })
    }
    return total
}


/** 分析模块统一使用的积分消耗项目 key */
const ANALYSIS_POINT_ITEM_KEY = 'case_analysis_token'

/**
 * 创建分析节点
 *
 * 完整生命周期：
 * 1. 查 DB 判断模块状态（COMPLETED+已扣费/COMPLETED+未扣费/其他）
 * 2. 会员检查（始终执行）
 * 3. 积分预检（始终执行）
 * 4. 创建 IN_PROGRESS 记录（仅未完成时）
 * 5. 执行 LLM 分析 + 持久化（仅未完成时）
 * 6. 按 token 扣减积分（始终执行）
 */
function createAnalysisNode(agentName: string, moduleTitle: string): GraphNode<typeof WorkflowState> {
    return async (state) => {
        try {
            const nodeInfo = await getNodeByNameService(agentName)

            // ====== 步骤 1：查 DB 该 session+node 的最新记录 ======
            let resultText = ''
            let totalTokens = 0
            let tokenQuantity = 0
            let analysisAlreadyDone = false
            let analysisRecordId: number | null = null

            if (nodeInfo) {
                const latestRecord = await findLatestAnalysisBySessionAndNodeDao(
                    state.sessionId, nodeInfo.id,
                )
                if (latestRecord?.status === AnalysisStatus.COMPLETED) {
                    if (latestRecord.pointDeducted) {
                        // 已完成且已扣费 → 直接返回结果
                        logger.info('模块已完成且已扣费，跳过', { agentName })
                        return {
                            result: { [agentName]: latestRecord.analysisResult ?? '' },
                            lastExecutedModule: agentName,
                            lastExecutedResult: latestRecord.analysisResult ?? '',
                            lastExecutedTitle: moduleTitle,
                        }
                    }
                    // 已完成但未扣费（上次因积分不足 interrupt）→ 跳过分析，进入扣减
                    resultText = latestRecord.analysisResult ?? ''
                    tokenQuantity = latestRecord.tokenCount ?? 0
                    totalTokens = latestRecord.tokens ?? 0
                    analysisRecordId = latestRecord.id
                    analysisAlreadyDone = true
                    logger.info('模块已完成但未扣费，跳过分析直接扣减', {
                        agentName, tokenQuantity, totalTokens,
                    })
                }
            }

            // ====== 步骤 2-3：会员+积分预检 ======
            // 仅在需要新分析时执行（analysisAlreadyDone 路径跳过，避免 interrupt 索引错位）
            // analysisAlreadyDone 的扣减失败由步骤 6 的 while 循环独立处理
            if (!analysisAlreadyDone) {
                // 步骤 2：会员检查（while 循环，直到用户开通会员）
                while (true) {
                    const membership = await getCurrentMembershipService(state.userId)
                    if (membership) break
                    interrupt({
                        type: InterruptType.INSUFFICIENT_POINTS,
                        message: '请先开通会员',
                        data: { isMember: false, availablePoints: 0, requiredPoints: 1, reason: 'no_membership' },
                    })
                    // resume 后 interrupt() 返回，循环继续重新检查
                }

                // 步骤 3：积分预检（while 循环，直到积分充足）
                while (true) {
                    const pointCheck = await checkPointsService(state.userId, ANALYSIS_POINT_ITEM_KEY, 1)
                    if (pointCheck.sufficient) break
                    interrupt({
                        type: InterruptType.INSUFFICIENT_POINTS,
                        message: '积分不足，请充值后继续',
                        data: {
                            isMember: true,
                            availablePoints: pointCheck.available,
                            requiredPoints: pointCheck.required,
                            reason: 'insufficient_points',
                        },
                    })
                    // resume 后 interrupt() 返回，循环继续重新检查
                }

                logger.info('积分检查通过', { agentName, userId: state.userId, caseId: state.caseId })
            }

            // ====== 步骤 4-5：分析+持久化（仅在未完成时执行）======
            let responseMessages: any[] = []

            if (!analysisAlreadyDone) {
                // 步骤 4：创建 IN_PROGRESS 记录
                if (nodeInfo) {
                    const existingInProgress = await findAnalysisBySessionAndNodeDao(
                        state.sessionId, nodeInfo.id, AnalysisStatus.IN_PROGRESS,
                    )
                    if (!existingInProgress) {
                        await deactivateVersionsDao(state.caseId, nodeInfo.id)
                        await createAnalysisDao({
                            caseId: state.caseId,
                            sessionId: state.sessionId,
                            nodeId: nodeInfo.id,
                            analysisType: agentName,
                            analysisResult: null,
                            status: AnalysisStatus.IN_PROGRESS,
                            isActive: true,
                            version: 1,
                        })
                    }
                }

                // 步骤 5a：执行 LLM 分析
                const nodeConfig = await getValidNodeConfig(agentName)
                const activeApiKey = nodeConfig.modelApiKeys.find((k: any) => k.status === 1)
                if (!activeApiKey) throw new Error(`${agentName} 节点无可用 API 密钥`)

                const model = createChatModel({
                    sdkType: nodeConfig.modelSdkType,
                    modelName: nodeConfig.modelName,
                    apiKey: activeApiKey.apiKey,
                    baseUrl: nodeConfig.modelProviderBaseUrl,
                    temperature: 0.7,
                    streaming: true,
                    thinking: state.thinking,
                })

                const tools = nodeConfig.tools?.length > 0
                    ? getToolInstancesService(nodeConfig.tools, {
                        userId: state.userId,
                        caseId: state.caseId,
                        sessionId: state.sessionId,
                    })
                    : []

                const toolNode = tools.length > 0 ? new ToolNode(tools) : null
                const modelWithTools = tools.length > 0 && model.bindTools ? model.bindTools(tools) : model

                const systemPrompt = nodeConfig.prompts?.find(
                    (p: any) => p.type === 'system' && p.status === 1,
                )?.content ?? ''

                const InnerState = Annotation.Root({ ...MessagesAnnotation.spec })

                const { budget: contextBudget, compressThreshold } = getContextBudget(nodeConfig.modelContextWindow)

                const callModel = async (innerState: typeof InnerState.State) => {
                    let messagesToSend = innerState.messages

                    // 防线2：动态摘要压缩
                    const roughEstimate = estimateMessagesTokens(innerState.messages)
                    if (roughEstimate > compressThreshold) {
                        logger.info('触发消息压缩', { agentName, roughEstimate, compressThreshold })
                        messagesToSend = await compressMessages(innerState.messages, contextBudget, model)
                    }

                    // 防线3：trimMessages 兜底（传入预计算的估算值避免重复遍历）
                    const trimEstimate = messagesToSend === innerState.messages ? roughEstimate : undefined
                    messagesToSend = await safetyTrimMessages(messagesToSend, contextBudget, trimEstimate)

                    const response = await modelWithTools.invoke(messagesToSend)
                    return { messages: [response] }  // state 保留完整历史
                }

                const shouldContinue = (innerState: typeof InnerState.State) => {
                    const lastMsg = innerState.messages[innerState.messages.length - 1]
                    if (lastMsg && isAIMessage(lastMsg) && lastMsg.tool_calls?.length) return 'tools'
                    return '__end__'
                }

                const innerBuilder = new StateGraph(InnerState)
                    .addNode('callModel', callModel)
                    .addEdge(START, 'callModel')

                if (toolNode) {
                    innerBuilder
                        .addNode('tools', toolNode)
                        .addConditionalEdges('callModel', shouldContinue, { tools: 'tools', __end__: END })
                        .addEdge('tools', 'callModel')
                } else {
                    innerBuilder.addEdge('callModel', END)
                }

                const innerGraph = innerBuilder.compile()

                // 构建模块上下文（案件信息 + 材料 + 已完成分析结果 + 记忆）
                const moduleContext = await buildModuleContext({
                    caseId: state.caseId,
                    agentName,
                    contextWindow: nodeConfig.modelContextWindow || 128000,
                })

                // 合并到 system prompt（被 Worker stripSystemMessages 自动过滤，不到达前端）
                const enrichedSystemPrompt = [systemPrompt, moduleContext].filter(Boolean).join('\n\n')

                const initialMessages = [
                    ...(enrichedSystemPrompt ? [{ role: 'system' as const, content: enrichedSystemPrompt }] : []),
                    new HumanMessage(`现在请开始"${moduleTitle}"分析。`),
                ]

                const response = await innerGraph.invoke(
                    { messages: initialMessages },
                    { recursionLimit: 1000 },
                )

                responseMessages = response.messages ?? []

                // 步骤 5b：提取结果
                const lastMsg = responseMessages[responseMessages.length - 1]
                if (lastMsg && typeof lastMsg.content === 'string') {
                    resultText = lastMsg.content
                } else if (lastMsg && Array.isArray(lastMsg.content)) {
                    resultText = lastMsg.content
                        .filter((c: any) => c.type === 'text')
                        .map((c: any) => c.text)
                        .join('\n')
                }

                // 步骤 5c：计算 token
                totalTokens = calculateTotalTokens(responseMessages)
                tokenQuantity = Math.ceil(totalTokens / 1000)

                // 步骤 5d：持久化为 COMPLETED + pointDeducted=false
                try {
                    if (nodeInfo) {
                        const inProgressRecord = await findAnalysisBySessionAndNodeDao(
                            state.sessionId, nodeInfo.id, AnalysisStatus.IN_PROGRESS,
                        )
                        if (inProgressRecord) {
                            await updateAnalysisDao(inProgressRecord.id, {
                                analysisResult: resultText,
                                status: AnalysisStatus.COMPLETED,
                                isActive: true,
                                pointDeducted: false,
                                tokenCount: tokenQuantity,
                                tokens: totalTokens,
                            })
                            analysisRecordId = inProgressRecord.id
                        } else {
                            const newRecord = await createAnalysisDao({
                                caseId: state.caseId,
                                sessionId: state.sessionId,
                                nodeId: nodeInfo.id,
                                analysisType: agentName,
                                analysisResult: resultText,
                                status: AnalysisStatus.COMPLETED,
                                isActive: true,
                                version: 1,
                                pointDeducted: false,
                                tokenCount: tokenQuantity,
                                tokens: totalTokens,
                            })
                            analysisRecordId = newRecord.id
                        }
                        logger.info('分析结果持久化完成', { agentName, resultLength: resultText.length, totalTokens })
                    }
                } catch (persistError) {
                    logger.error('分析结果持久化失败', { agentName, error: persistError })
                    // 持久化失败：返回 result（当前会话可用）+ 警告，不进入步骤 6
                    return {
                        messages: responseMessages,
                        result: { [agentName]: resultText },
                        failedModules: { [`${agentName}_persist`]: '分析结果保存失败，刷新后可能丢失' },
                        lastExecutedModule: agentName,
                        lastExecutedResult: resultText,
                        lastExecutedTitle: moduleTitle,
                    }
                }
            }

            // ====== 步骤 6：扣减积分（while 循环，直到扣减成功）======
            while (tokenQuantity > 0) {
                try {
                    await consumePointsService(state.userId, ANALYSIS_POINT_ITEM_KEY, tokenQuantity, {
                        sourceId: state.caseId,
                        remark: `案件分析：${moduleTitle}（${totalTokens} tokens）`,
                    })
                    // 扣减成功 → 标记已扣费
                    if (analysisRecordId) {
                        await updateAnalysisDao(analysisRecordId, { pointDeducted: true })
                    }
                    logger.info('积分消耗成功', { agentName, totalTokens, tokenQuantity })
                    break
                } catch (consumeError: any) {
                    // 扣减失败 → interrupt 弹出购买 UI（结果已安全保存在 DB）
                    logger.warn('积分不足，等待充值', { agentName, tokenQuantity })
                    const check = await checkPointsService(state.userId, ANALYSIS_POINT_ITEM_KEY, 1)
                    interrupt({
                        type: InterruptType.INSUFFICIENT_POINTS,
                        message: '积分不足，请充值后继续',
                        data: {
                            isMember: true,
                            availablePoints: check.available,
                            requiredPoints: tokenQuantity,
                            reason: 'insufficient_points',
                        },
                    })
                    // resume 后 interrupt() 返回，while 循环继续重试扣减
                }
            }

            return {
                messages: responseMessages,
                result: { [agentName]: resultText },
                lastExecutedModule: agentName,
                lastExecutedResult: resultText,
                lastExecutedTitle: moduleTitle,
            }
        } catch (error: any) {
            // interrupt() 抛出的 GraphInterrupt 必须传播到框架层
            if (isGraphInterrupt(error)) {
                throw error
            }

            // 标记 IN_PROGRESS 记录为失败
            try {
                const nodeInfo = await getNodeByNameService(agentName)
                if (nodeInfo) {
                    const record = await findAnalysisBySessionAndNodeDao(
                        state.sessionId, nodeInfo.id, AnalysisStatus.IN_PROGRESS,
                    )
                    if (record) {
                        await markAnalysisFailedById(record.id)
                    }
                }
            } catch (cleanupError) {
                logger.error('标记分析失败异常', { agentName, cleanupError })
            }

            logger.error(`分析模块 ${agentName} 执行失败`, {
                sessionId: state.sessionId,
                error: error.message,
            })

            return {
                messages: [],
                failedModules: { [agentName]: error.message },
                lastExecutedModule: agentName,
                lastExecutedResult: '',
                lastExecutedTitle: moduleTitle,
            }
        }
    }
}

/**
 * 获取案件分析工作流实例
 *
 * 每次调用都：
 * 1. 从数据库加载最新的 analysis 类型节点（status=1, deletedAt=null）
 * 2. 按 priority 升序排序构建模块顺序
 * 3. 动态编译 StateGraph
 *
 * @returns 编译后的工作流实例
 */
export async function getCaseAnalysisWorkflow() {
    const checkpointer = await getCheckpointer()

    // 1. 异步加载模块（每次都查数据库）
    const analysisModules = await getNodeConfigsByTypes(['analysis'])
    const MODULE_ORDER = analysisModules.map(m => m.name)

    // 2. 创建路由函数（闭包访问 MODULE_ORDER）
    const getNextNode = (current: string, state: typeof WorkflowState.State): string => {
        const idx = MODULE_ORDER.indexOf(current)
        if (idx === -1) return END
        const next = MODULE_ORDER.slice(idx + 1).find(m => state.selectedModules.includes(m))
        return next ?? END
    }

    // 3. 动态创建节点和边
    const graph = new StateGraph(WorkflowState)

    // 注册节点
    for (const module of analysisModules) {
        graph.addNode(module.name, createAnalysisNode(module.name, module.title || module.name))
    }

    // START 入口：指向第一个选中的模块（按 MODULE_ORDER 顺序）
    graph.addConditionalEdges(START, (state) => {
        const first = MODULE_ORDER.find(m => state.selectedModules.includes(m))
        return first ?? END
    })

    // 模块间边（使用 any 类型以支持动态节点名称）
    for (const moduleName of MODULE_ORDER) {
        graph.addConditionalEdges(moduleName as any, (state) => getNextNode(moduleName, state))
    }

    return await graph.compile({ checkpointer })
}
