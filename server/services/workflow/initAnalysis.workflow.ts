/**
 * 初始化分析 LangGraph 工作流
 *
 * 单循环节点串行执行所选模块的分析 Agent
 * 每个模块独立执行，失败不阻塞后续模块
 *
 * 图结构：__start__ → execute_module ⟲ (loop) → __end__
 */

import { StateGraph } from '@langchain/langgraph'
import { isGraphInterrupt } from '@langchain/langgraph'
import { interrupt } from '@langchain/langgraph'
import { HumanMessage } from '@langchain/core/messages'
import { createAgent, type ReactAgent } from 'langchain'
import { InitAnalysisAnnotation, type InitAnalysisState } from './initAnalysis.state'
import { getCheckpointer, getStore } from './checkpointer'
import { getValidNodeConfig } from '../node/node.service'
import { createChatModel } from '../node/chatModelFactory'
import { getToolInstancesService } from './tools'
import { pointConsumptionMiddleware } from './middleware/pointConsumption.middleware'
import { caseMaterialContextMiddleware } from './middleware/caseMaterialContext.middleware'
import {
    startAnalysisService,
    completeAnalysisService,
    failAnalysisService,
} from '../case/analysis.service'
import { InterruptType } from '#shared/types/case'
import { getCurrentMembershipService } from '../membership/userMembership.service'
import { checkPointsService } from '../point/pointConsumption.service'

const EXECUTE_MODULE_NODE = 'execute_module'

/**
 * 核心执行节点：串行执行当前模块的分析 Agent
 *
 * 每次调用执行一个模块，通过 currentModuleIndex 递增控制循环
 * 失败时记录到 failedModules，不抛出异常
 */
export async function executeModuleNode(
    state: InitAnalysisState,
): Promise<Partial<InitAnalysisState>> {
    const { selectedModules, currentModuleIndex, completedResults, userId, caseId, sessionId } = state
    const moduleName = selectedModules[currentModuleIndex]

    if (!moduleName) {
        return { isComplete: true }
    }

    try {
        // 0. 积分/会员预检（在工作流层中断，确保前端能感知）
        const membership = await getCurrentMembershipService(userId)
        if (!membership) {
            interrupt({
                type: InterruptType.INSUFFICIENT_POINTS,
                message: '请先开通会员',
                data: {
                    module: moduleName,
                    isMember: false,
                    availablePoints: 0,
                    reason: 'no_membership',
                },
            })
            // resume 后重新检查
            const refreshed = await getCurrentMembershipService(userId)
            if (!refreshed) {
                return {
                    currentModule: moduleName,
                    currentModuleIndex: currentModuleIndex + 1,
                    failedModules: { [moduleName]: '未开通会员' },
                }
            }
        }

        const pointCheck = await checkPointsService(userId, 'case_analysis_token', 1)
        if (!pointCheck.sufficient) {
            interrupt({
                type: InterruptType.INSUFFICIENT_POINTS,
                message: '积分不足，请充值后继续',
                data: {
                    module: moduleName,
                    isMember: true,
                    availablePoints: pointCheck.available,
                    requiredPoints: pointCheck.required,
                    reason: 'insufficient_points',
                },
            })
            // resume 后重新检查
            const recheck = await checkPointsService(userId, 'case_analysis_token', 1)
            if (!recheck.sufficient) {
                return {
                    currentModule: moduleName,
                    currentModuleIndex: currentModuleIndex + 1,
                    failedModules: { [moduleName]: '积分不足' },
                }
            }
        }

        // 1. 加载节点配置
        const nodeConfig = await getValidNodeConfig(moduleName, `分析模块: ${moduleName}`)
        const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
        if (!activeApiKey) {
            throw new Error(`模块 ${moduleName} 无可用 API 密钥`)
        }

        // 2. 创建模型
        const model = createChatModel({
            sdkType: nodeConfig.modelSdkType,
            modelName: nodeConfig.modelName,
            apiKey: activeApiKey.apiKey,
            baseUrl: nodeConfig.modelProviderBaseUrl,
            temperature: 0.7,
            streaming: true,
        })

        // 3. 加载工具
        const tools = nodeConfig.tools?.length > 0
            ? getToolInstancesService(nodeConfig.tools, { userId, caseId, sessionId })
            : []

        // 4. 构建系统提示（注入已完成模块结果作为上下文）
        const systemPromptConfig = nodeConfig.prompts?.find(
            (p: { type: string; status: number }) => p.type === 'system' && p.status === 1,
        )
        const systemPrompt = systemPromptConfig?.content ?? ''
        const contextPrefix = Object.keys(completedResults).length > 0
            ? `以下是已完成的分析结果，请参考：\n\n${Object.entries(completedResults).map(([k, v]) => `### ${k}\n${v}`).join('\n\n')}\n\n---\n\n`
            : ''

        // 5. 标记分析开始（在数据库中创建/更新 caseAnalyses 记录）
        const analysisRecord = await startAnalysisService({
            caseId,
            sessionId,
            nodeId: nodeConfig.id,
            analysisType: moduleName,
        })

        // 6. 创建 Agent
        const [checkpointer, store] = await Promise.all([getCheckpointer(), getStore()])
        const agent: ReactAgent = createAgent({
            model,
            systemPrompt: contextPrefix + systemPrompt,
            checkpointer,
            tools,
            store,
            middleware: [
                pointConsumptionMiddleware(userId, 'case_analysis_token'),
                caseMaterialContextMiddleware(userId, caseId),
            ],
        })

        // 7. 执行并收集结果
        let result = ''
        const stream = await agent.stream(
            { messages: [new HumanMessage('请执行分析')] },
            {
                configurable: { thread_id: `${sessionId}_${moduleName}` },
                streamMode: ['values', 'messages'],
            },
        )

        for await (const chunk of stream) {
            // stream chunk 类型因 streamMode 配置而异，使用 any 安全访问
            const chunkData: any = Array.isArray(chunk) ? chunk[1] : chunk
            if (chunkData?.messages) {
                const lastMsg = chunkData.messages[chunkData.messages.length - 1]
                if (lastMsg?.content && typeof lastMsg.content === 'string') {
                    result = lastMsg.content
                }
            }
        }

        // 8. 保存分析结果
        await completeAnalysisService(analysisRecord.id, result)

        return {
            currentModule: moduleName,
            currentModuleIndex: currentModuleIndex + 1,
            completedResults: { [moduleName]: result },
        }
    } catch (error: any) {
        // GraphInterrupt 需要向上传递，不当作失败处理
        if (isGraphInterrupt(error)) {
            throw error
        }

        logger.error(`初始化分析模块 ${moduleName} 执行失败:`, error)

        // 失败不阻塞后续模块
        return {
            currentModule: moduleName,
            currentModuleIndex: currentModuleIndex + 1,
            failedModules: { [moduleName]: error.message ?? '未知错误' },
        }
    }
}

/**
 * 路由函数：判断是否还有下一个模块需要执行
 */
export function routeAfterExecute(state: InitAnalysisState): string {
    if (state.isComplete || state.currentModuleIndex >= state.selectedModules.length) {
        return '__end__'
    }
    return EXECUTE_MODULE_NODE
}

/**
 * 获取编译后的初始化分析工作流（单例）
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let workflowInstance: any = null

export async function getInitAnalysisWorkflow() {
    if (workflowInstance) return workflowInstance

    const checkpointer = await getCheckpointer()

    const graph = new StateGraph(InitAnalysisAnnotation)
        .addNode(EXECUTE_MODULE_NODE, executeModuleNode)
        .addEdge('__start__', EXECUTE_MODULE_NODE)
        .addConditionalEdges(EXECUTE_MODULE_NODE, routeAfterExecute, [
            EXECUTE_MODULE_NODE,
            '__end__',
        ])

    workflowInstance = graph.compile({ checkpointer })
    return workflowInstance!
}

/**
 * 重置工作流实例（用于测试）
 */
export function resetInitAnalysisWorkflow(): void {
    workflowInstance = null
}

/**
 * 启动初始化分析
 *
 * @param params 启动参数
 * @returns LangGraph 流式输出
 */
export async function startInitAnalysis(params: {
    caseId: number
    sessionId: string
    userId: number
    selectedModules: string[]
    completedResults?: Record<string, string>
}) {
    const workflow = await getInitAnalysisWorkflow()

    return workflow.stream(
        {
            userId: params.userId,
            caseId: params.caseId,
            sessionId: params.sessionId,
            selectedModules: params.selectedModules,
            currentModuleIndex: 0,
            completedResults: params.completedResults ?? {},
            currentModule: params.selectedModules[0],
        },
        {
            configurable: { thread_id: params.sessionId },
            streamMode: ['values', 'messages'],
            version: 'v2' as const,
            encoding: 'text/event-stream',
        },
    )
}
