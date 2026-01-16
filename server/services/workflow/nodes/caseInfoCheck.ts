/**
 * 案情信息检查节点（中断点1）
 *
 * LangGraph 工作流中的案情信息检查节点，负责：
 * 1. 检查案件材料中是否包含足够的案情信息
 * 2. 如果信息不足，调用 interrupt() 暂停等待用户补充
 * 3. 支持循环检查-补充流程，直到信息充足
 *
 * @see Requirements 4.1, 4.2, 4.3, 4.7, 4.8, 4.9, 4.10
 * @see design.md - LangGraph 工作流架构
 */

import { interrupt, Command } from '@langchain/langgraph'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createChatModel } from '../../node/chatModelFactory'
import { z } from 'zod'
import {
    type CaseAnalysisState,
    type CaseAnalysisStateUpdate,
} from '../state'
import { InterruptType, WorkflowPhase } from '#shared/types/case'
import { getNodeConfigService, type NodeConfig } from '../../node/node.service'
import { renderContent } from '../../node/prompt.service'
import { logger } from '#shared/utils/logger'

/** 案情信息检查节点名称（LangGraph 工作流中使用） */
export const CASE_INFO_CHECK_NODE_NAME = 'case_info_check'

/** 案情信息检查节点配置名称（数据库中的节点名称，必须在后台配置） */
export const CASE_INFO_CHECK_NODE_CONFIG_NAME = 'caseInfoCheck'

/** 案情信息检查结果 Schema */
const CaseInfoCheckResultSchema = z.object({
    /** 案情信息是否充足 */
    sufficient: z.boolean(),
    /** 检查结果说明 */
    message: z.string(),
    /** 缺失的信息类型列表 */
    missingInfo: z.array(z.string()).optional(),
    /** 建议补充的内容 */
    suggestions: z.array(z.string()).optional(),
})

type CaseInfoCheckResult = z.infer<typeof CaseInfoCheckResultSchema>

/** 中断数据接口 */
interface CaseInfoCheckInterruptData {
    /** 中断类型 */
    type: InterruptType.CASE_INFO_CHECK
    /** 提示消息 */
    message: string
    /** 检查结果 */
    checkResult: CaseInfoCheckResult
    /** 当前材料内容摘要 */
    materialSummary: string
}

/**
 * 案情信息检查节点
 *
 * 该节点在材料处理完成后执行，负责：
 * 1. 使用 AI 检查案情信息是否充足
 * 2. 如果不充足，调用 interrupt() 暂停等待用户补充
 * 3. 用户补充后重新检查，循环直到信息充足
 *
 * @param state 当前工作流状态
 * @returns 状态更新或 Command
 */
export async function caseInfoCheckNode(
    state: CaseAnalysisState
): Promise<CaseAnalysisStateUpdate | Command> {
    const { caseId, sessionId, aggregatedContent, supplementedCaseInfo } = state

    logger.info('案情信息检查节点开始执行', {
        caseId,
        sessionId,
        phase: state.currentPhase,
        hasSupplementedInfo: !!supplementedCaseInfo,
    })

    try {
        // 检查是否有材料内容
        if (!aggregatedContent || aggregatedContent.trim() === '') {
            logger.warn('没有可用的材料内容', { caseId })
            return {
                error: '没有可用的材料内容，请先上传案件材料',
                currentPhase: WorkflowPhase.CASE_INFO_CHECK,
                messages: [
                    new AIMessage({
                        content: '没有可用的材料内容，请先上传案件材料后再开始分析。',
                    }),
                ],
            }
        }

        // 执行案情信息检查
        const checkResult = await checkCaseInfo(aggregatedContent, supplementedCaseInfo)

        logger.info('案情信息检查完成', {
            caseId,
            sufficient: checkResult.sufficient,
            missingInfo: checkResult.missingInfo,
        })

        // 如果信息充足，继续下一阶段
        if (checkResult.sufficient) {
            return {
                caseInfoSufficient: true,
                caseInfoCheckResult: checkResult.message,
                currentPhase: WorkflowPhase.EXTRACT_INFO,
                messages: [
                    new AIMessage({
                        content: `案情信息检查通过：${checkResult.message}\n\n正在提取案件基本信息...`,
                    }),
                ],
            }
        }

        // 信息不足，需要中断等待用户补充
        // Requirements 4.2, 4.3: 调用 interrupt() 暂停并返回提示
        logger.info('案情信息不足，等待用户补充', {
            caseId,
            missingInfo: checkResult.missingInfo,
        })

        // 构建中断数据
        const interruptData: CaseInfoCheckInterruptData = {
            type: InterruptType.CASE_INFO_CHECK,
            message: formatInterruptMessage(checkResult),
            checkResult,
            materialSummary: generateMaterialSummary(aggregatedContent),
        }

        // 调用 interrupt 暂停工作流
        // Requirements 4.7, 4.8: 用户可以输入文本案情或上传文档
        const userInput = interrupt(interruptData)

        // 用户恢复后，将补充的信息存入状态，并重新执行检查
        // Requirements 4.9, 4.10: 循环检查-补充流程
        return new Command({
            update: {
                supplementedCaseInfo: combineSupplementedInfo(supplementedCaseInfo, userInput as string),
                caseInfoCheckResult: checkResult.message,
                messages: [
                    new HumanMessage({
                        content: `用户补充案情信息：${userInput}`,
                    }),
                ],
            },
            // 重新执行案情信息检查节点
            goto: CASE_INFO_CHECK_NODE_NAME,
        })
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误'
        logger.error('案情信息检查节点执行异常', {
            caseId,
            error: errorMessage,
        })

        return {
            error: `案情信息检查异常: ${errorMessage}`,
            currentPhase: WorkflowPhase.CASE_INFO_CHECK,
            messages: [
                new AIMessage({
                    content: `案情信息检查过程中发生异常：${errorMessage}。请稍后重试或联系管理员。`,
                }),
            ],
        }
    }
}

/**
 * 执行案情信息检查
 *
 * @param materials 材料内容
 * @param supplementedInfo 用户补充的信息
 * @returns 检查结果
 */
async function checkCaseInfo(
    materials: string,
    supplementedInfo?: string
): Promise<CaseInfoCheckResult> {
    // 获取节点配置（必须在后台配置）
    const nodeConfig = await getNodeConfigService(CASE_INFO_CHECK_NODE_CONFIG_NAME)

    if (!nodeConfig) {
        throw new Error(`节点配置不存在：${CASE_INFO_CHECK_NODE_CONFIG_NAME}，请在后台管理中配置该节点`)
    }

    // 验证节点配置完整性
    validateNodeConfig(nodeConfig)

    // 构建提示词
    const { systemPrompt, userPrompt } = buildPrompts(nodeConfig, materials, supplementedInfo)

    // 创建 AI 模型
    const model = createChatModelFromConfig(nodeConfig)

    // 调用 AI 进行检查
    const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
    ])

    // 解析响应
    const content = typeof response.content === 'string' ? response.content : ''
    return parseCheckResult(content)
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
        throw new Error(`节点 ${CASE_INFO_CHECK_NODE_CONFIG_NAME} 缺少生效的系统提示词，请在后台管理中配置`)
    }

    // 检查是否有生效的用户提示词
    const userPrompt = nodeConfig.prompts.find((p) => p.type === 'user' && p.status === 1)
    if (!userPrompt) {
        throw new Error(`节点 ${CASE_INFO_CHECK_NODE_CONFIG_NAME} 缺少生效的用户提示词，请在后台管理中配置`)
    }

    // 检查是否有可用的 API 密钥
    const activeApiKey = nodeConfig.modelApiKeys.find((k) => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`节点 ${CASE_INFO_CHECK_NODE_CONFIG_NAME} 关联的模型没有可用的 API 密钥，请在后台管理中配置`)
    }
}

/**
 * 构建提示词
 *
 * @param nodeConfig 节点配置
 * @param materials 材料内容
 * @param supplementedInfo 补充信息
 * @returns 系统提示词和用户提示词
 */
function buildPrompts(
    nodeConfig: NodeConfig,
    materials: string,
    supplementedInfo?: string
): { systemPrompt: string; userPrompt: string } {
    // 获取生效的提示词（已在 validateNodeConfig 中验证存在）
    const systemPromptConfig = nodeConfig.prompts.find((p) => p.type === 'system' && p.status === 1)!
    const userPromptConfig = nodeConfig.prompts.find((p) => p.type === 'user' && p.status === 1)!

    // 渲染用户提示词
    const supplementedSection = supplementedInfo
        ? `\n\n用户补充的案情信息：\n${supplementedInfo}`
        : ''

    const userPrompt = renderContent(userPromptConfig.content, {
        materials,
        supplementedInfo: supplementedSection,
    })

    return {
        systemPrompt: systemPromptConfig.content,
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
        temperature: 0.3,
        streaming: false,
    })
}

/**
 * 解析检查结果
 *
 * @param content AI 响应内容
 * @returns 解析后的检查结果
 */
function parseCheckResult(content: string): CaseInfoCheckResult {
    try {
        // 尝试从响应中提取 JSON
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            const result = CaseInfoCheckResultSchema.safeParse(parsed)
            if (result.success) {
                return result.data
            }
        }

        // 如果无法解析 JSON，根据内容判断
        const lowerContent = content.toLowerCase()
        const isSufficient = lowerContent.includes('充足') ||
            lowerContent.includes('sufficient') ||
            lowerContent.includes('足够')

        return {
            sufficient: isSufficient,
            message: content.slice(0, 500),
            missingInfo: isSufficient ? [] : ['无法解析具体缺失信息'],
            suggestions: isSufficient ? [] : ['请补充更多案情信息'],
        }
    } catch (error) {
        logger.warn('解析案情检查结果失败，使用默认值', { error })
        return {
            sufficient: false,
            message: '无法解析检查结果，请补充更多案情信息',
            missingInfo: ['解析失败'],
            suggestions: ['请补充更详细的案情描述'],
        }
    }
}

/**
 * 格式化中断消息
 *
 * @param checkResult 检查结果
 * @returns 格式化的消息
 */
function formatInterruptMessage(checkResult: CaseInfoCheckResult): string {
    let message = `案情信息检查结果：${checkResult.message}\n\n`

    if (checkResult.missingInfo && checkResult.missingInfo.length > 0) {
        message += '缺失的信息：\n'
        checkResult.missingInfo.forEach((info, index) => {
            message += `${index + 1}. ${info}\n`
        })
        message += '\n'
    }

    if (checkResult.suggestions && checkResult.suggestions.length > 0) {
        message += '建议补充：\n'
        checkResult.suggestions.forEach((suggestion, index) => {
            message += `${index + 1}. ${suggestion}\n`
        })
    }

    message += '\n请补充案情信息后继续分析。您可以：\n'
    message += '1. 直接输入案情描述\n'
    message += '2. 上传案情相关文档'

    return message
}

/**
 * 生成材料摘要
 *
 * @param materials 材料内容
 * @returns 材料摘要
 */
function generateMaterialSummary(materials: string): string {
    // 截取前 500 个字符作为摘要
    const maxLength = 500
    if (materials.length <= maxLength) {
        return materials
    }
    return materials.slice(0, maxLength) + '...'
}

/**
 * 合并补充信息
 *
 * @param existing 已有的补充信息
 * @param newInfo 新的补充信息
 * @returns 合并后的信息
 */
function combineSupplementedInfo(existing: string | undefined, newInfo: string): string {
    if (!existing || existing.trim() === '') {
        return newInfo
    }
    return `${existing}\n\n---\n\n${newInfo}`
}

/**
 * 检查案情信息是否已充足（用于外部调用）
 *
 * @param state 工作流状态
 * @returns 是否充足
 */
export function isCaseInfoSufficient(state: CaseAnalysisState): boolean {
    return state.caseInfoSufficient
}

/**
 * 获取案情检查结果（用于外部调用）
 *
 * @param state 工作流状态
 * @returns 检查结果
 */
export function getCaseInfoCheckResult(state: CaseAnalysisState): string {
    return state.caseInfoCheckResult
}
