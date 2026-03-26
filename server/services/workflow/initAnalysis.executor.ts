/**
 * 初始化分析 LangGraph 工作流（subgraph 版本）
 *
 * 父图 StateGraph 串行编排，每个模块创建 ReactAgent 作为子图节点
 * - 父图 checkpointer 自动管理所有子图状态，支持崩溃恢复
 * - subgraphs: true 让子图事件透传到 SSE 流
 * - _langchain_path 自动标注子图路径，前端无需额外注入
 *
 * 图结构：START → execute_next → (子图 Agent) → execute_next → ... → END
 */

import { Annotation, StateGraph } from '@langchain/langgraph'
import { isGraphInterrupt } from '@langchain/langgraph'
import { createAgent, type ReactAgent } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import { messagesStateReducer } from '@langchain/langgraph'
import { createChatModel } from '../node/chatModelFactory'
import { getToolInstancesService } from './tools'
import { pointConsumptionMiddleware } from './middleware/pointConsumption.middleware'
import { caseMaterialContextMiddleware } from './middleware/caseMaterialContext.middleware'
import {
    startAnalysisService,
    completeAnalysisService,
} from '../case/analysis.service'

// ==================== State 定义 ====================

function replaceReducer<T>(_existing: T, updated: T): T {
    return updated
}

function mergeRecordReducer(
    existing: Record<string, string>,
    updated: Record<string, string>,
): Record<string, string> {
    return { ...existing, ...updated }
}

const InitAnalysisAnnotation = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),
    userId: Annotation<number>,
    caseId: Annotation<number>,
    sessionId: Annotation<string>,
    selectedModules: Annotation<string[]>({
        reducer: replaceReducer,
        default: () => [],
    }),
    currentModuleIndex: Annotation<number>({
        reducer: replaceReducer,
        default: () => 0,
    }),
    currentModule: Annotation<string>({
        reducer: replaceReducer,
        default: () => '',
    }),
    completedResults: Annotation<Record<string, string>>({
        reducer: mergeRecordReducer,
        default: () => ({}),
    }),
    failedModules: Annotation<Record<string, string>>({
        reducer: mergeRecordReducer,
        default: () => ({}),
    }),
    isComplete: Annotation<boolean>({
        reducer: replaceReducer,
        default: () => false,
    }),
})

type InitAnalysisState = typeof InitAnalysisAnnotation.State

// ==================== 节点函数 ====================

/**
 * 执行当前模块的 Agent
 *
 * 每次执行一个模块：创建 Agent → invoke → 提取结果 → 保存 → 递增 index
 * Agent 内部的 pointConsumptionMiddleware 会处理积分中断（GraphInterrupt 向上传递）
 */
async function executeModuleNode(state: InitAnalysisState): Promise<Partial<InitAnalysisState>> {
    const { selectedModules, currentModuleIndex, completedResults, userId, caseId, sessionId } = state
    const moduleName = selectedModules[currentModuleIndex]

    if (!moduleName) {
        return { isComplete: true }
    }

    // 跳过已完成模块（resume 场景）
    if (completedResults[moduleName]) {
        return {
            currentModule: moduleName,
            currentModuleIndex: currentModuleIndex + 1,
        }
    }

    // 1. 加载节点配置
    const nodeConfig = await getValidNodeConfig(moduleName, `分析模块: ${moduleName}`)
    const activeApiKey = nodeConfig.modelApiKeys.find((k: any) => k.status === 1)
    if (!activeApiKey) {
        return {
            currentModule: moduleName,
            currentModuleIndex: currentModuleIndex + 1,
            failedModules: { [moduleName]: `模块 ${moduleName} 无可用 API 密钥` },
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

    // 4. 构建系统提示（注入已完成模块结果）
    const systemPromptConfig = nodeConfig.prompts?.find(
        (p: { type: string; status: number }) => p.type === 'system' && p.status === 1,
    )
    const systemPrompt = systemPromptConfig?.content ?? ''
    const contextPrefix = Object.keys(completedResults).length > 0
        ? `以下是已完成的分析结果，请参考：\n\n${Object.entries(completedResults).map(([k, v]) => `### ${k}\n${v}`).join('\n\n')}\n\n---\n\n`
        : ''

    // 5. 标记分析开始
    const analysisRecord = await startAnalysisService({
        caseId,
        sessionId,
        nodeId: nodeConfig.id,
        analysisType: moduleName,
    })

    logger.info(`初始化分析模块 ${moduleName} 开始执行`, {
        sessionId, caseId, userId, toolsCount: tools.length,
    })

    try {
        // 6. 创建并执行 Agent
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

        // invoke 而非 stream——父图的 stream() 会自动透传子图事件
        const result = await agent.invoke(
            { messages: [new HumanMessage('请执行分析')] },
            {
                configurable: { thread_id: `${sessionId}_${moduleName}` },
                recursionLimit: 100,
            },
        )

        // 7. 提取最终文本
        const lastAIMsg = [...(result.messages ?? [])].reverse().find(
            (m: any) => m._getType?.() === 'ai' || m.type === 'ai',
        )
        let resultText = ''
        if (lastAIMsg) {
            const content = lastAIMsg.content
            if (typeof content === 'string') {
                resultText = content
            } else if (Array.isArray(content)) {
                resultText = content
                    .filter((c: any) => c.type === 'text')
                    .map((c: any) => c.text)
                    .join('')
            }
        }

        // 8. 保存分析结果
        await completeAnalysisService(analysisRecord.id, resultText)

        logger.info(`初始化分析模块 ${moduleName} 完成`, {
            sessionId, resultLength: resultText.length,
        })

        return {
            currentModule: moduleName,
            currentModuleIndex: currentModuleIndex + 1,
            completedResults: { [moduleName]: resultText },
        }
    } catch (error: any) {
        // GraphInterrupt（积分不足）向上传递给父图处理
        if (isGraphInterrupt(error)) {
            throw error
        }

        logger.error(`初始化分析模块 ${moduleName} 执行失败:`, error)

        return {
            currentModule: moduleName,
            currentModuleIndex: currentModuleIndex + 1,
            failedModules: { [moduleName]: error.message ?? '未知错误' },
        }
    }
}

// ==================== 路由 ====================

function routeAfterExecute(state: InitAnalysisState): string {
    if (state.isComplete || state.currentModuleIndex >= state.selectedModules.length) {
        return '__end__'
    }
    return 'execute_module'
}

// ==================== 工作流编译 ====================

let workflowInstance: any = null

async function getInitAnalysisWorkflow() {
    if (workflowInstance) return workflowInstance

    const checkpointer = await getCheckpointer()

    const graph = new StateGraph(InitAnalysisAnnotation)
        .addNode('execute_module', executeModuleNode)
        .addEdge('__start__', 'execute_module')
        .addConditionalEdges('execute_module', routeAfterExecute, [
            'execute_module',
            '__end__',
        ])

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
 * 返回 SSE 格式的 ReadableStream，与 runCaseChat 格式一致
 * Worker 可直接用 parseSSEEvents 消费
 */
export async function startInitAnalysis(params: InitAnalysisParams): Promise<ReadableStream> {
    const workflow = await getInitAnalysisWorkflow()

    const { command, ...restParams } = params

    // resume：有 command 时恢复已中断的工作流
    if (command) {
        const { Command } = await import('@langchain/langgraph')
        return workflow.stream(
            new Command({ resume: command }),
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
            currentModuleIndex: 0,
            currentModule: params.selectedModules[0] ?? '',
            completedResults: params.completedResults ?? {},
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

/**
 * 重置工作流实例（用于测试）
 */
export function resetInitAnalysisWorkflow(): void {
    workflowInstance = null
}
