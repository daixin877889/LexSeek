/**
 * 分析任务节点
 *
 * LangGraph 工作流中的分析任务执行节点，负责：
 * 1. 按顺序执行用户选择的分析模块
 * 2. 根据节点配置动态加载工具
 * 3. 在模块执行前检查并扣减积分
 * 4. 流式输出分析过程和结果
 * 5. 保存分析结果到数据库
 *
 * @see Requirements 6.1-6.7, 12.5, 16.6, 16.7
 * @see design.md - LangGraph 工作流架构
 */

import { Command } from '@langchain/langgraph'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createChatModel } from '../../node/chatModelFactory'
import {
    type CaseAnalysisState,
    type CaseAnalysisStateUpdate,
    getNextModule,
    areAllModulesComplete,
} from '../state'
import { type AnalysisResult, WorkflowPhase } from '#shared/types/case'
import { getNodeConfigService, type NodeConfig } from '../../node/node.service'
import { renderContent } from '../../node/prompt.service'
import { getToolInstancesService, type ToolContext } from '../tools'
import { checkPointsService, consumePointsService } from '../../point/pointConsumption.service'
import { logger } from '#shared/utils/logger'

/** 分析任务节点名称（LangGraph 工作流中使用） */
export const ANALYSIS_TASK_NODE_NAME = 'analysis_task'

/** 分析模块积分消耗项目分组名称 */
const ANALYSIS_MODULES_GROUP = 'analysisModules'

/** 分析结果状态 */
export enum AnalysisStatus {
    /** 进行中 */
    IN_PROGRESS = 1,
    /** 已完成 */
    COMPLETED = 2,
    /** 已失败 */
    FAILED = 3,
}

/**
 * 分析任务节点
 *
 * 该节点在模块选择确认后执行，负责：
 * 1. 按顺序执行选定的分析模块
 * 2. 每个模块执行前检查并扣减积分
 * 3. 流式输出分析过程
 * 4. 保存分析结果
 * 5. 所有模块完成后结束工作流
 *
 * @param state 当前工作流状态
 * @returns 状态更新或 Command
 */
export async function analysisTaskNode(
    state: CaseAnalysisState
): Promise<CaseAnalysisStateUpdate | Command> {
    const {
        caseId,
        sessionId,
        userId,
        selectedModules,
        currentModuleIndex,
        aggregatedContent,
        title,
        plaintiff,
        defendant,
        summary,
        caseTypeName,
    } = state

    logger.info('分析任务节点开始执行', {
        caseId,
        sessionId,
        userId,
        currentModuleIndex,
        totalModules: selectedModules.length,
        phase: state.currentPhase,
    })

    try {
        // 检查是否所有模块都已完成
        // Requirements 6.7: 所有模块执行完成后结束工作流
        if (areAllModulesComplete(state)) {
            logger.info('所有分析模块执行完成', {
                caseId,
                totalModules: selectedModules.length,
            })

            return {
                currentPhase: WorkflowPhase.COMPLETE,
                isComplete: true,
                messages: [
                    new AIMessage({
                        content: `所有分析模块执行完成！共完成 ${selectedModules.length} 个模块的分析。`,
                    }),
                ],
            }
        }

        // 获取当前要执行的模块
        const currentModuleName = getNextModule(state)
        if (!currentModuleName) {
            logger.warn('没有待执行的模块', { caseId, currentModuleIndex })
            return {
                currentPhase: WorkflowPhase.COMPLETE,
                isComplete: true,
                messages: [
                    new AIMessage({
                        content: '没有待执行的分析模块。',
                    }),
                ],
            }
        }

        logger.info('开始执行分析模块', {
            caseId,
            moduleName: currentModuleName,
            moduleIndex: currentModuleIndex,
        })

        // 获取节点配置
        const nodeConfig = await getNodeConfigService(currentModuleName)
        if (!nodeConfig) {
            throw new Error(`节点配置不存在：${currentModuleName}，请在后台管理中配置该节点`)
        }

        // 验证节点配置完整性
        validateNodeConfig(nodeConfig)

        // Requirements 16.6, 16.7: 检查并扣减积分
        const pointResult = await handlePointConsumption(userId, currentModuleName, caseId)
        if (!pointResult.success) {
            // 积分不足，返回错误并停止执行
            return {
                error: pointResult.error,
                messages: [
                    new AIMessage({
                        content: `执行模块 "${nodeConfig.title}" 失败：${pointResult.error}`,
                    }),
                ],
            }
        }

        // Requirements 6.2: 发送任务开始事件
        const startMessage = new AIMessage({
            content: `开始执行分析模块：${nodeConfig.title}...`,
        })

        // 构建分析上下文
        const analysisContext = buildAnalysisContext({
            materials: aggregatedContent,
            title,
            plaintiff,
            defendant,
            summary,
            caseTypeName,
        })

        // Requirements 6.3, 6.4: 执行分析任务，流式输出
        const analysisResult = await executeAnalysis(
            nodeConfig,
            analysisContext,
            { userId, caseId, sessionId }
        )

        // Requirements 6.5: 保存分析结果
        const savedAnalysis = await saveAnalysisResult({
            caseId,
            sessionId,
            nodeId: nodeConfig.id,
            analysisType: currentModuleName,
            analysisResult: analysisResult.content,
        })

        logger.info('分析模块执行完成', {
            caseId,
            moduleName: currentModuleName,
            analysisId: savedAnalysis.id,
        })

        // 构建分析结果对象
        const result: AnalysisResult = {
            nodeId: nodeConfig.id,
            moduleName: currentModuleName,
            moduleTitle: nodeConfig.title,
            content: analysisResult.content,
            analyzedAt: new Date().toISOString(),
        }

        // 返回 Command 更新状态并继续执行下一个模块
        return new Command({
            update: {
                currentModuleIndex: currentModuleIndex + 1,
                analysisResults: [result],
                lastExecutedModule: currentModuleName,
                lastExecutedResult: analysisResult.content,
                lastExecutedTitle: nodeConfig.title,
                messages: [
                    startMessage,
                    new AIMessage({
                        content: analysisResult.content,
                    }),
                    new AIMessage({
                        content: `模块 "${nodeConfig.title}" 分析完成。${currentModuleIndex + 1 < selectedModules.length
                            ? '继续执行下一个模块...'
                            : ''
                            }`,
                    }),
                ],
            },
            // 继续执行分析任务节点（处理下一个模块）
            goto: ANALYSIS_TASK_NODE_NAME,
        })
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误'
        logger.error('分析任务节点执行异常', {
            caseId,
            userId,
            currentModuleIndex,
            error: errorMessage,
        })

        // Requirements 6.7: 分析过程出错时保存错误状态
        return {
            error: `分析任务异常: ${errorMessage}`,
            messages: [
                new AIMessage({
                    content: `分析过程中发生异常：${errorMessage}。您可以稍后重试或联系管理员。`,
                }),
            ],
        }
    }
}


/**
 * 验证节点配置完整性
 *
 * @param nodeConfig 节点配置
 * @throws 如果配置不完整
 */
function validateNodeConfig(nodeConfig: NodeConfig): void {
    // 检查是否有生效的系统提示词
    const systemPrompt = nodeConfig.prompts.find((p) => p.type === 'system' && p.status === 1)
    if (!systemPrompt) {
        throw new Error(`节点 ${nodeConfig.name} 缺少生效的系统提示词，请在后台管理中配置`)
    }

    // 检查是否有生效的用户提示词
    const userPrompt = nodeConfig.prompts.find((p) => p.type === 'user' && p.status === 1)
    if (!userPrompt) {
        throw new Error(`节点 ${nodeConfig.name} 缺少生效的用户提示词，请在后台管理中配置`)
    }

    // 检查是否有可用的 API 密钥
    const activeApiKey = nodeConfig.modelApiKeys.find((k) => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`节点 ${nodeConfig.name} 关联的模型没有可用的 API 密钥，请在后台管理中配置`)
    }
}

/**
 * 处理积分消耗
 *
 * @param userId 用户 ID
 * @param moduleName 模块名称（作为积分消耗项目的 key）
 * @param caseId 案件 ID（作为 sourceId）
 * @returns 处理结果
 */
async function handlePointConsumption(
    userId: number,
    moduleName: string,
    caseId: number
): Promise<{ success: boolean; error?: string }> {
    try {
        // 检查积分是否足够
        const checkResult = await checkPointsService(userId, moduleName, 1)

        if (!checkResult.sufficient) {
            logger.warn('用户积分不足', {
                userId,
                moduleName,
                required: checkResult.required,
                available: checkResult.available,
            })
            return {
                success: false,
                error: `积分不足，执行该模块需要 ${checkResult.required} 积分，您当前可用积分为 ${checkResult.available}。请充值后再试。`,
            }
        }

        // 扣减积分
        const consumeResult = await consumePointsService(userId, moduleName, 1, {
            sourceId: caseId,
            remark: `案件分析：${moduleName}`,
        })

        logger.info('积分扣减成功', {
            userId,
            moduleName,
            consumedAmount: consumeResult.consumedAmount,
        })

        return { success: true }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误'
        logger.error('积分处理失败', {
            userId,
            moduleName,
            error: errorMessage,
        })

        // 如果是消耗项目不存在的错误，给出更友好的提示
        if (errorMessage.includes('消耗项目不存在')) {
            return {
                success: false,
                error: `分析模块 "${moduleName}" 的积分配置不存在，请联系管理员配置。`,
            }
        }

        return {
            success: false,
            error: `积分处理失败：${errorMessage}`,
        }
    }
}

/**
 * 构建分析上下文
 *
 * @param params 上下文参数
 * @returns 格式化的分析上下文
 */
function buildAnalysisContext(params: {
    materials: string
    title: string
    plaintiff: string[]
    defendant: string[]
    summary: string
    caseTypeName: string
}): AnalysisContext {
    const { materials, title, plaintiff, defendant, summary, caseTypeName } = params

    return {
        materials,
        title,
        plaintiff: plaintiff.join('、'),
        defendant: defendant.join('、'),
        summary,
        caseTypeName,
        // 构建案件基本信息摘要
        caseInfo: formatCaseInfo(params),
    }
}

/** 分析上下文接口 */
interface AnalysisContext {
    /** 材料内容 */
    materials: string
    /** 案件标题 */
    title: string
    /** 原告（逗号分隔） */
    plaintiff: string
    /** 被告（逗号分隔） */
    defendant: string
    /** 案件摘要 */
    summary: string
    /** 案件类型名称 */
    caseTypeName: string
    /** 案件基本信息（格式化） */
    caseInfo: string
}

/**
 * 格式化案件基本信息
 *
 * @param params 案件信息参数
 * @returns 格式化的案件信息
 */
function formatCaseInfo(params: {
    title: string
    plaintiff: string[]
    defendant: string[]
    summary: string
    caseTypeName: string
}): string {
    const { title, plaintiff, defendant, summary, caseTypeName } = params

    let info = `案件标题：${title}\n`
    info += `案件类型：${caseTypeName}\n`

    if (plaintiff.length > 0) {
        info += `原告：${plaintiff.join('、')}\n`
    }

    if (defendant.length > 0) {
        info += `被告：${defendant.join('、')}\n`
    }

    if (summary) {
        info += `案件摘要：${summary}\n`
    }

    return info
}

/** 分析执行结果接口 */
interface AnalysisExecutionResult {
    /** 分析结果内容 */
    content: string
    /** 工具调用记录 */
    toolCalls?: Array<{
        name: string
        input: Record<string, unknown>
        output: string
    }>
}

/**
 * 执行分析任务
 *
 * @param nodeConfig 节点配置
 * @param context 分析上下文
 * @param toolContext 工具上下文
 * @returns 分析结果
 */
async function executeAnalysis(
    nodeConfig: NodeConfig,
    context: AnalysisContext,
    toolContext: ToolContext
): Promise<AnalysisExecutionResult> {
    // 构建提示词
    const { systemPrompt, userPrompt } = buildPrompts(nodeConfig, context)

    // 创建 AI 模型
    const model = createChatModelFromConfig(nodeConfig)

    // Requirements 12.5: 根据节点配置的 tools 字段动态加载工具
    const tools = nodeConfig.tools.length > 0
        ? getToolInstancesService(nodeConfig.tools, toolContext)
        : []

    logger.info('执行分析任务', {
        nodeName: nodeConfig.name,
        toolCount: tools.length,
        toolNames: nodeConfig.tools,
    })

    // 如果有工具，绑定到模型
    const modelWithTools = tools.length > 0 ? model.bindTools(tools) : model

    // 导入 ToolMessage 类型
    const { ToolMessage } = await import('@langchain/core/messages')
    type BaseMessageLike = SystemMessage | HumanMessage | AIMessage | InstanceType<typeof ToolMessage>

    // 构建消息
    const messages: BaseMessageLike[] = [
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
    ]

    // 执行分析（支持工具调用）
    const toolCalls: Array<{ name: string; input: Record<string, unknown>; output: string }> = []
    let finalContent = ''

    // 循环执行，处理工具调用
    const currentMessages: BaseMessageLike[] = [...messages]
    const maxIterations = 10 // 防止无限循环
    let iteration = 0

    while (iteration < maxIterations) {
        iteration++

        const response = await modelWithTools.invoke(currentMessages)

        // 检查是否有工具调用
        if (response.tool_calls && response.tool_calls.length > 0) {
            // 添加 AI 响应到消息历史
            currentMessages.push(new AIMessage({
                content: typeof response.content === 'string' ? response.content : '',
                tool_calls: response.tool_calls,
            }))

            // 执行工具调用
            for (const toolCall of response.tool_calls) {
                logger.info('执行工具调用', {
                    toolName: toolCall.name,
                    toolInput: toolCall.args,
                })

                // 查找对应的工具
                const tool = tools.find((t) => t.name === toolCall.name)
                if (!tool) {
                    logger.warn('工具不存在', { toolName: toolCall.name })
                    continue
                }

                try {
                    // 执行工具
                    const toolResult = await tool.invoke(toolCall.args)
                    const toolOutput = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)

                    toolCalls.push({
                        name: toolCall.name,
                        input: toolCall.args as Record<string, unknown>,
                        output: toolOutput,
                    })

                    // 添加工具结果到消息历史
                    currentMessages.push(new ToolMessage({
                        content: toolOutput,
                        tool_call_id: toolCall.id || toolCall.name,
                    }))
                } catch (error) {
                    logger.error('工具执行失败', {
                        toolName: toolCall.name,
                        error: error instanceof Error ? error.message : '未知错误',
                    })

                    // 添加错误结果到消息历史
                    currentMessages.push(new ToolMessage({
                        content: JSON.stringify({ error: '工具执行失败' }),
                        tool_call_id: toolCall.id || toolCall.name,
                    }))
                }
            }
        } else {
            // 没有工具调用，获取最终结果
            finalContent = typeof response.content === 'string' ? response.content : ''
            break
        }
    }

    if (iteration >= maxIterations) {
        logger.warn('分析任务达到最大迭代次数', {
            nodeName: nodeConfig.name,
            maxIterations,
        })
    }

    return {
        content: finalContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
}


/**
 * 构建提示词
 *
 * @param nodeConfig 节点配置
 * @param context 分析上下文
 * @returns 系统提示词和用户提示词
 */
function buildPrompts(
    nodeConfig: NodeConfig,
    context: AnalysisContext
): { systemPrompt: string; userPrompt: string } {
    // 获取生效的提示词（已在 validateNodeConfig 中验证存在）
    const systemPromptConfig = nodeConfig.prompts.find((p) => p.type === 'system' && p.status === 1)!
    const userPromptConfig = nodeConfig.prompts.find((p) => p.type === 'user' && p.status === 1)!

    // 将 AnalysisContext 转换为 Record<string, string>
    const variables: Record<string, string> = {
        materials: context.materials,
        title: context.title,
        plaintiff: context.plaintiff,
        defendant: context.defendant,
        summary: context.summary,
        caseTypeName: context.caseTypeName,
        caseInfo: context.caseInfo,
    }

    // 渲染提示词，替换变量
    const systemPrompt = renderContent(systemPromptConfig.content, variables)
    const userPrompt = renderContent(userPromptConfig.content, variables)

    return {
        systemPrompt,
        userPrompt,
    }
}

/**
 * 创建聊天模型
 *
 * 使用 chatModelFactory 根据节点配置的 SDK 类型动态创建对应的 LangChain 模型实例
 * 支持 OpenAI、DeepSeek、Gemini、Anthropic 四种 SDK 类型
 *
 * @param nodeConfig 节点配置
 * @returns BaseChatModel 实例
 * @see Requirements 5.1, 5.2, 5.3, 5.4 - 动态模型实例化
 */
function createChatModelFromConfig(nodeConfig: NodeConfig) {
    // 获取可用的 API 密钥（已在 validateNodeConfig 中验证存在）
    const activeApiKey = nodeConfig.modelApiKeys.find((k) => k.status === 1)!

    // 使用 chatModelFactory 根据 SDK 类型创建对应的模型实例
    return createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
    })
}

/** 保存分析结果参数接口 */
interface SaveAnalysisParams {
    caseId: number
    sessionId: string
    nodeId: number
    analysisType: string
    analysisResult: string
}

/** 保存的分析结果接口 */
interface SavedAnalysis {
    id: number
    caseId: number
    sessionId: string
    nodeId: number
    analysisType: string
    analysisResult: string
    version: number
    status: number
}

/**
 * 保存分析结果到数据库
 *
 * @param params 保存参数
 * @returns 保存的分析结果
 */
async function saveAnalysisResult(params: SaveAnalysisParams): Promise<SavedAnalysis> {
    const { caseId, sessionId, nodeId, analysisType, analysisResult } = params

    // 查找是否已有该模块的分析结果
    const existingAnalysis = await prisma.caseAnalyses.findFirst({
        where: {
            caseId,
            sessionId,
            nodeId,
            deletedAt: null,
        },
        orderBy: {
            version: 'desc',
        },
    })

    // 计算版本号
    const version = existingAnalysis ? existingAnalysis.version + 1 : 1

    // 创建新的分析结果记录
    const savedAnalysis = await prisma.caseAnalyses.create({
        data: {
            caseId,
            sessionId,
            nodeId,
            analysisType,
            analysisResult,
            version,
            status: AnalysisStatus.COMPLETED,
        },
    })

    logger.info('分析结果已保存', {
        analysisId: savedAnalysis.id,
        caseId,
        nodeId,
        analysisType,
        version,
    })

    return {
        id: savedAnalysis.id,
        caseId: savedAnalysis.caseId,
        sessionId: savedAnalysis.sessionId,
        nodeId: savedAnalysis.nodeId,
        analysisType: savedAnalysis.analysisType,
        analysisResult: savedAnalysis.analysisResult || '',
        version: savedAnalysis.version,
        status: savedAnalysis.status,
    }
}

// ==================== 导出辅助函数 ====================

/**
 * 获取当前执行的模块名称（用于外部调用）
 *
 * @param state 工作流状态
 * @returns 当前模块名称，如果没有则返回 null
 */
export function getCurrentModuleName(state: CaseAnalysisState): string | null {
    return getNextModule(state)
}

/**
 * 获取已完成的模块数量（用于外部调用）
 *
 * @param state 工作流状态
 * @returns 已完成的模块数量
 */
export function getCompletedModuleCount(state: CaseAnalysisState): number {
    return state.currentModuleIndex
}

/**
 * 获取总模块数量（用于外部调用）
 *
 * @param state 工作流状态
 * @returns 总模块数量
 */
export function getTotalModuleCount(state: CaseAnalysisState): number {
    return state.selectedModules.length
}

/**
 * 获取分析进度百分比（用于外部调用）
 *
 * @param state 工作流状态
 * @returns 进度百分比（0-100）
 */
export function getAnalysisProgress(state: CaseAnalysisState): number {
    const total = state.selectedModules.length
    if (total === 0) return 100
    return Math.round((state.currentModuleIndex / total) * 100)
}

/**
 * 检查分析是否完成（用于外部调用）
 *
 * @param state 工作流状态
 * @returns 是否完成
 */
export function isAnalysisComplete(state: CaseAnalysisState): boolean {
    return areAllModulesComplete(state)
}

/**
 * 获取最近执行的分析结果（用于外部调用）
 *
 * @param state 工作流状态
 * @returns 最近的分析结果，如果没有则返回 null
 */
export function getLastAnalysisResult(state: CaseAnalysisState): AnalysisResult | null {
    if (!state.lastExecutedModule) return null

    return {
        nodeId: 0, // 从状态中无法获取 nodeId
        moduleName: state.lastExecutedModule,
        moduleTitle: state.lastExecutedTitle,
        content: state.lastExecutedResult,
        analyzedAt: new Date().toISOString(),
    }
}

/**
 * 获取所有分析结果（用于外部调用）
 *
 * @param state 工作流状态
 * @returns 分析结果列表
 */
export function getAllAnalysisResults(state: CaseAnalysisState): AnalysisResult[] {
    return state.analysisResults
}
