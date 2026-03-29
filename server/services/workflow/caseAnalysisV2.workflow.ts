/**
 * 案件分析工作流
 *
 * 使用 LangGraph 原生编排（StateGraph + ToolNode）替代 ReactAgent
 * 解决 ReactAgent 在 streamMode 多模式下 invoke 失败的问题
 *
 * 每个分析模块内部构建独立的 ReAct 图（callModel → tools 循环）
 * 支持 streamMode: ['values', 'messages', 'updates'] + subgraphs: true
 */

import { StateGraph, StateSchema, Annotation, MessagesAnnotation, MessagesValue, ReducedValue, START, END } from "@langchain/langgraph"
import { ToolNode } from '@langchain/langgraph/prebuilt'
import type { GraphNode } from "@langchain/langgraph"
import { HumanMessage, isAIMessage } from '@langchain/core/messages'
import { getCheckpointer } from './checkpointer'
import { z } from "zod/v4"
import { getNodeConfigsByTypes, getValidNodeConfig, getNodeByNameService } from '../node/node.service'
import { createChatModel } from '../node/chatModelFactory'
import { getToolInstancesService } from './tools'
import { findAnalysisBySessionAndNodeDao, AnalysisStatus } from '../case/analysis.dao'
import { markAnalysisFailedById } from './middleware/analysisResultPersistence.middleware'
import { deactivateVersionsDao, updateAnalysisDao, createAnalysisDao } from '../case/analysis.dao'


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


/**
 * 创建分析节点
 *
 * 使用 LangGraph 原生 StateGraph + ToolNode 编排工具调用循环
 * 不使用 createAgent（ReactAgent），避免 streamMode 多模式下的兼容性问题
 */
function createAnalysisNode(agentName: string, moduleTitle: string): GraphNode<typeof WorkflowState> {
    return async (state) => {
        try {
            // 0. 创建 IN_PROGRESS 记录（在分析开始前）
            const nodeInfo = await getNodeByNameService(agentName)
            if (nodeInfo) {
                // 检查是否已有 IN_PROGRESS 记录
                const existingRecord = await findAnalysisBySessionAndNodeDao(
                    state.sessionId, nodeInfo.id, AnalysisStatus.IN_PROGRESS
                )
                if (!existingRecord) {
                    // 创建新的 IN_PROGRESS 记录
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

            // 1. 加载节点配置
            const nodeConfig = await getValidNodeConfig(agentName)
            const activeApiKey = nodeConfig.modelApiKeys.find((k: any) => k.status === 1)
            if (!activeApiKey) throw new Error(`${agentName} 节点无可用 API 密钥`)

            // 2. 创建模型
            const model = createChatModel({
                sdkType: nodeConfig.modelSdkType,
                modelName: nodeConfig.modelName,
                apiKey: activeApiKey.apiKey,
                baseUrl: nodeConfig.modelProviderBaseUrl,
                temperature: 0.7,
                streaming: true,
                thinking: state.thinking,
            })

            // 3. 加载工具
            const tools = nodeConfig.tools?.length > 0
                ? getToolInstancesService(nodeConfig.tools, {
                    userId: state.userId,
                    caseId: state.caseId,
                    sessionId: state.sessionId,
                })
                : []

            const toolNode = tools.length > 0 ? new ToolNode(tools) : null
            const modelWithTools = tools.length > 0 && model.bindTools ? model.bindTools(tools) : model

            // 4. 获取系统提示
            const systemPrompt = nodeConfig.prompts?.find(
                (p: any) => p.type === 'system' && p.status === 1,
            )?.content ?? ''

            // 5. 构建内部 ReAct 图（callModel → tools 循环）
            const InnerState = Annotation.Root({ ...MessagesAnnotation.spec })

            const callModel = async (innerState: typeof InnerState.State) => {
                const response = await modelWithTools.invoke(innerState.messages)
                return { messages: [response] }
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

            // 6. 执行
            const initialMessages = [
                ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
                new HumanMessage(state.prompt ?? `现在请开始任务：${moduleTitle}`),
            ]

            const response = await innerGraph.invoke(
                { messages: initialMessages },
                { recursionLimit: 1000 }
            )

            // 7. 提取结果并持久化到数据库
            const lastMsg = response.messages?.[response.messages.length - 1]
            let resultText = ''
            if (lastMsg && typeof lastMsg.content === 'string') {
                resultText = lastMsg.content
            } else if (lastMsg && Array.isArray(lastMsg.content)) {
                resultText = lastMsg.content
                    .filter((c: any) => c.type === 'text')
                    .map((c: any) => c.text)
                    .join('\n')
            }

            // 8. 持久化分析结果到数据库
            try {
                const nodeInfo = await getNodeByNameService(agentName)
                if (nodeInfo) {
                    // 查找是否有 IN_PROGRESS 记录
                    const existingRecord = await findAnalysisBySessionAndNodeDao(
                        state.sessionId, nodeInfo.id, AnalysisStatus.IN_PROGRESS
                    )

                    if (existingRecord) {
                        // 更新现有记录为 COMPLETED
                        await updateAnalysisDao(existingRecord.id, {
                            analysisResult: resultText,
                            status: AnalysisStatus.COMPLETED,
                            isActive: true,
                        })
                    } else {
                        // 创建新记录
                        await createAnalysisDao({
                            caseId: state.caseId,
                            sessionId: state.sessionId,
                            nodeId: nodeInfo.id,
                            analysisType: agentName,
                            analysisResult: resultText,
                            status: AnalysisStatus.COMPLETED,
                            isActive: true,
                            version: 1,
                        })
                    }

                    logger.info('分析结果持久化完成', {
                        agentName,
                        caseId: state.caseId,
                        sessionId: state.sessionId,
                        resultLength: resultText.length,
                    })
                }
            } catch (persistError) {
                logger.error('分析结果持久化失败', {
                    agentName,
                    error: persistError,
                })
                // 持久化失败不影响返回结果
            }

            return {
                messages: response.messages,
                result: { [agentName]: resultText },
                lastExecutedModule: agentName,
                lastExecutedResult: resultText,
                lastExecutedTitle: moduleTitle,
            }
        } catch (error: any) {
            // 标记 IN_PROGRESS 记录为失败
            try {
                const nodeInfo = await getNodeByNameService(agentName)
                if (nodeInfo) {
                    const record = await findAnalysisBySessionAndNodeDao(
                        state.sessionId, nodeInfo.id, AnalysisStatus.IN_PROGRESS
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
