/**
 * 初始化分析 LangGraph 工作流
 *
 * 每个分析模块作为 StateGraph 的独立节点，节点内部调用 Agent 并返回 messages
 * 父图 messages 使用 concat reducer 累积所有模块的消息
 * 父图 stream() 的 messages/values 事件自然包含所有节点的消息更新
 * useStream 可直接消费，无需额外处理
 *
 * 参考：/Users/daixin/work/dev/LexSeek/lexseekApi/src/services/ai/graph/caseAnalysisTask.ts
 *
 * 图结构：START → summaryNode → chronicleNode → claimNode → ... → END
 * （未选中的模块在节点函数内部跳过，返回空更新）
 */

import { Annotation, StateGraph } from '@langchain/langgraph'
import { createAgent, summarizationMiddleware } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import { createChatModel } from '../node/chatModelFactory'
import { getToolInstancesService } from './tools'
import { getCheckpointer, getStore } from './checkpointer'
import { pointConsumptionMiddleware } from './middleware/pointConsumption.middleware'
import { caseMaterialContextMiddleware } from './middleware/caseMaterialContext.middleware'
import { analysisResultPersistenceMiddleware, markAnalysisFailedById } from './middleware/analysisResultPersistence.middleware'
import { safetyTrimMiddleware } from './middleware/safetyTrim.middleware'
import { findAnalysisBySessionAndNodeDao, AnalysisStatus } from '../case/analysis.dao'
import { VALID_MODULE_NAMES } from '#shared/types/initAnalysis'

// ==================== State 定义 ====================

export const InitAnalysisAnnotation = Annotation.Root({
    // messages 使用 concat reducer：每个节点返回的 messages 追加到数组中
    // 这样父图 stream() 的 values 事件中 messages 包含所有节点的消息
    messages: Annotation<BaseMessage[]>({
        default: () => [],
        reducer: (a, b) => a.concat(b),
    }),
    userId: Annotation<number>,
    caseId: Annotation<number>,
    sessionId: Annotation<string>,
    // 用户选中的模块列表
    selectedModules: Annotation<string[]>,
    // 各模块分析结果
    result: Annotation<Record<string, string>>({
        default: () => ({}),
        reducer: (a, b) => ({ ...a, ...b }),
    }),
    // 上一个执行的模块信息（供后续模块引用）
    lastExecutedModule: Annotation<string>,
    lastExecutedResult: Annotation<string>,
    lastExecutedTitle: Annotation<string>,
})

type InitAnalysisState = typeof InitAnalysisAnnotation.State

// ==================== 节点工厂 ====================

interface ModuleNodeConfig {
    moduleName: string
    title: string
}

/**
 * 创建分析节点函数
 *
 * 节点内部：
 * 1. 检查是否在 selectedModules 中（未选中则跳过）
 * 2. 加载节点配置 + 创建 Agent
 * 3. 调用 agent.invoke() 获取结果
 * 4. 返回 { messages, result, lastExecuted* }
 *
 * 父图的 messages concat reducer 会自动累积
 */
function createModuleNode(config: ModuleNodeConfig) {
    return async (state: InitAnalysisState): Promise<Partial<InitAnalysisState>> => {
        // 检查是否应执行此模块
        if (!state.selectedModules.includes(config.moduleName)) {
            return {}
        }

        const { userId, caseId, sessionId, lastExecutedTitle, lastExecutedResult } = state

        // 1. 加载节点配置
        let nodeConfig
        try {
            nodeConfig = await getValidNodeConfig(config.moduleName, `分析模块: ${config.moduleName}`)
        } catch (error: any) {
            logger.error(`模块 ${config.moduleName} 配置获取失败:`, error)
            return {
                result: { [config.moduleName]: `[错误] ${error.message}` },
                lastExecutedModule: config.moduleName,
                lastExecutedResult: '',
                lastExecutedTitle: config.title,
            }
        }

        const activeApiKey = nodeConfig.modelApiKeys.find((k: any) => k.status === 1)
        if (!activeApiKey) {
            return {
                result: { [config.moduleName]: '[错误] 无可用 API 密钥' },
                lastExecutedModule: config.moduleName,
                lastExecutedResult: '',
                lastExecutedTitle: config.title,
            }
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

        // 4. 构建系统提示
        const systemPrompt = nodeConfig.prompts?.find(
            (p: { type: string; status: number }) => p.type === 'system' && p.status === 1,
        )?.content ?? ''

        // 5. 构建上下文提示（注入前一个模块的结果）
        let contextPrompt = ''
        if (lastExecutedTitle && lastExecutedResult) {
            contextPrompt = `\n\n## 前置分析结果\n### ${lastExecutedTitle}\n${lastExecutedResult}`
        }
        const fullPrompt = `${contextPrompt}\n\n --- \n\n 现在请开始任务：${config.title}`

        logger.info(`初始化分析模块 ${config.moduleName} 开始`, {
            sessionId, caseId, userId, toolsCount: tools.length,
        })

        // 6. 创建并执行 Agent（中间件自动处理 start/complete）
        // 注意：不使用 checkpointer，消息由父图 StateGraph 的 messages concat reducer 累积
        // 根据模型上下文窗口动态计算 summarization 触发阈值（窗口 * 60%，下限 30k）
        const contextWindow = nodeConfig.modelContextWindow || 128000
        const triggerTokens = Math.max(Math.floor(contextWindow * 0.6), 30000)

        const agent = createAgent({
            model,
            systemPrompt,
            tools,
            store: await getStore(),
            middleware: [
                pointConsumptionMiddleware(userId, 'case_analysis_token', sessionId),
                caseMaterialContextMiddleware(userId, caseId),
                summarizationMiddleware({
                    model,
                    trigger: [{ tokens: triggerTokens }],
                }),
                safetyTrimMiddleware({
                    model,
                    maxTokens: Math.floor(contextWindow * 0.8),
                }),
                analysisResultPersistenceMiddleware({
                    agentName: config.moduleName,
                    caseId,
                    sessionId,
                }),
            ],
        })

        try {
            const result = await agent.invoke(
                { messages: [new HumanMessage(fullPrompt)] },
                {
                    configurable: {
                        thread_id: sessionId,
                        user_id: userId,
                        case_id: caseId,
                    },
                    recursionLimit: 1000,
                },
            )

            // 7. 提取最终文本
            const lastMsg = result.messages?.[result.messages.length - 1]
            let resultText = ''
            if (lastMsg) {
                const content = lastMsg.content
                if (typeof content === 'string') {
                    resultText = content
                } else if (Array.isArray(content)) {
                    resultText = content
                        .filter((c: any) => c.type === 'text')
                        .map((c: any) => c.text)
                        .join('')
                }
            }

            logger.info(`初始化分析模块 ${config.moduleName} 完成`, {
                sessionId, resultLength: resultText.length,
            })

            return {
                messages: result.messages ?? [],
                result: { [config.moduleName]: resultText },
                lastExecutedModule: config.moduleName,
                lastExecutedResult: resultText,
                lastExecutedTitle: config.title,
            }
        } catch (error: any) {
            // 查找 IN_PROGRESS 记录并标记失败
            try {
                const nodeInfo = await getNodeByNameService(config.moduleName)
                if (nodeInfo) {
                    const record = await findAnalysisBySessionAndNodeDao(
                        sessionId, nodeInfo.id, AnalysisStatus.IN_PROGRESS
                    )
                    if (record) {
                        await markAnalysisFailedById(record.id)
                    }
                }
            } catch (cleanupError) {
                logger.error('标记分析失败异常', { moduleName: config.moduleName, cleanupError })
            }

            logger.error(`初始化分析模块 ${config.moduleName} 失败`, { sessionId, error })

            return {
                result: { [config.moduleName]: `[错误] ${error.message}` },
                lastExecutedModule: config.moduleName,
                lastExecutedResult: '',
                lastExecutedTitle: config.title,
            }
        }
    }
}

// ==================== 模块节点定义（固定顺序） ====================

const MODULE_CONFIGS: ModuleNodeConfig[] = [
    { moduleName: 'summary', title: '生成案件概要' },
    { moduleName: 'chronicle', title: '提取案件大事记' },
    { moduleName: 'claim', title: '预分析案件请求权' },
    { moduleName: 'trend', title: '判决趋势预测' },
    { moduleName: 'cause', title: '预选案由' },
    { moduleName: 'defense', title: '抗辩分析及应对策略预测' },
    { moduleName: 'evidence', title: '证据清单预梳理' },
]

// ==================== 工作流编译 ====================

let workflowInstance: any = null

async function getInitAnalysisWorkflow() {
    if (workflowInstance) return workflowInstance

    const checkpointer = await getCheckpointer()

    const graph = new StateGraph(InitAnalysisAnnotation) as any

    // 注册所有模块节点
    for (const config of MODULE_CONFIGS) {
        graph.addNode(`${config.moduleName}Node`, createModuleNode(config))
    }

    // 串行连接：START → summaryNode → chronicleNode → ... → END
    const nodeNames = MODULE_CONFIGS.map(c => `${c.moduleName}Node`)

    graph.addEdge('__start__', nodeNames[0])
    for (let i = 0; i < nodeNames.length - 1; i++) {
        graph.addEdge(nodeNames[i], nodeNames[i + 1])
    }
    graph.addEdge(nodeNames[nodeNames.length - 1], '__end__')

    workflowInstance = graph.compile({ checkpointer })
    return workflowInstance
}

// ==================== 公开 API ====================

export interface InitAnalysisParams {
    caseId: number
    sessionId: string
    userId: number
    selectedModules: string[]
    completedResults?: Record<string, string>
    command?: unknown
}

/**
 * 启动初始化分析
 *
 * 返回 SSE 格式的 ReadableStream，Worker 可直接消费
 * useStream 前端可直接消费 messages/values
 */
export async function startInitAnalysis(params: InitAnalysisParams): Promise<ReadableStream> {
    const workflow = await getInitAnalysisWorkflow()

    if (params.command) {
        const { Command } = await import('@langchain/langgraph')
        return workflow.stream(
            new Command({ resume: params.command }),
            {
                configurable: { thread_id: params.sessionId },
                streamMode: ['values', 'messages', 'updates'],
                version: 'v2' as const,
                subgraphs: true,
                encoding: 'text/event-stream',
            },
        )
    }

    return workflow.stream(
        {
            userId: params.userId,
            caseId: params.caseId,
            sessionId: params.sessionId,
            selectedModules: params.selectedModules,
        },
        {
            configurable: { thread_id: params.sessionId },
            streamMode: ['values', 'messages', 'updates'],
            version: 'v2' as const,
            subgraphs: true,
            encoding: 'text/event-stream',
        },
    )
}

export function resetInitAnalysisWorkflow(): void {
    workflowInstance = null
}
