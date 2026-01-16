/**
 * 基本信息提取节点（中断点2）
 *
 * LangGraph 工作流中的基本信息提取节点，负责：
 * 1. 从案件材料中自动提取案件基本信息（标题、原告、被告等）
 * 2. 调用 interrupt() 暂停等待用户确认或修改
 * 3. 用户确认后更新案件记录并继续执行
 *
 * @see Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9
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
import { getCaseTypeByIdService } from '../../case/caseType.service'
import { logger } from '#shared/utils/logger'

/** 基本信息提取节点名称（LangGraph 工作流中使用） */
export const EXTRACT_INFO_NODE_NAME = 'extract_info'

/** 基本信息提取节点配置名称（数据库中的节点名称，必须在后台配置） */
export const EXTRACT_INFO_NODE_CONFIG_NAME = 'extractInfo'

/** 提取的基本信息 Schema */
const ExtractedInfoSchema = z.object({
    /** 案件标题 */
    title: z.string().describe('案件标题'),
    /** 原告列表 */
    plaintiff: z.array(z.string()).describe('原告列表'),
    /** 被告列表 */
    defendant: z.array(z.string()).describe('被告列表'),
    /** 案件摘要 */
    summary: z.string().describe('案件摘要'),
    /** 案件类型名称（可选，AI 推断） */
    caseTypeName: z.string().optional().describe('案件类型名称'),
    /** 案由（可选） */
    causeOfAction: z.string().optional().describe('案由'),
    /** 诉讼标的金额（可选） */
    amount: z.string().optional().describe('诉讼标的金额'),
    /** 案件发生时间（可选） */
    caseDate: z.string().optional().describe('案件发生时间'),
    /** 案件发生地点（可选） */
    caseLocation: z.string().optional().describe('案件发生地点'),
})

export type ExtractedInfo = z.infer<typeof ExtractedInfoSchema>

/** 中断数据接口 */
export interface ExtractInfoInterruptData {
    /** 中断类型 */
    type: InterruptType.BASIC_INFO_CONFIRM
    /** 提示消息 */
    message: string
    /** 提取的基本信息 */
    extractedInfo: ExtractedInfo
    /** 案件类型 ID */
    caseTypeId: number
    /** 案件类型名称 */
    caseTypeName: string
}

/** 用户确认的信息接口 */
export interface ConfirmedInfo {
    /** 案件标题 */
    title: string
    /** 原告列表 */
    plaintiff: string[]
    /** 被告列表 */
    defendant: string[]
    /** 案件摘要 */
    summary: string
    /** 案件类型名称 */
    caseTypeName?: string
}

/**
 * 基本信息提取节点
 *
 * 该节点在案情信息检查通过后执行，负责：
 * 1. 使用 AI 从材料中提取案件基本信息
 * 2. 调用 interrupt() 暂停等待用户确认或修改
 * 3. 用户确认后更新状态并继续执行模块选择节点
 *
 * @param state 当前工作流状态
 * @returns 状态更新或 Command
 */
export async function extractInfoNode(
    state: CaseAnalysisState
): Promise<CaseAnalysisStateUpdate | Command> {
    const { caseId, sessionId, aggregatedContent, caseTypeId, basicInfoConfirmed } = state

    logger.info('基本信息提取节点开始执行', {
        caseId,
        sessionId,
        phase: state.currentPhase,
        basicInfoConfirmed,
    })

    try {
        // 如果用户已确认基本信息，直接进入下一阶段
        // Requirements 5.8: 案件记录更新完成后继续执行模块选择节点
        if (basicInfoConfirmed) {
            logger.info('基本信息已确认，进入模块选择阶段', { caseId })
            return {
                currentPhase: WorkflowPhase.MODULE_SELECT,
                messages: [
                    new AIMessage({
                        content: '基本信息已确认，正在获取可用的分析模块...',
                    }),
                ],
            }
        }

        // 检查是否有材料内容
        if (!aggregatedContent || aggregatedContent.trim() === '') {
            logger.warn('没有可用的材料内容', { caseId })
            return {
                error: '没有可用的材料内容，请先上传案件材料',
                currentPhase: WorkflowPhase.EXTRACT_INFO,
                messages: [
                    new AIMessage({
                        content: '没有可用的材料内容，无法提取基本信息。请先上传案件材料。',
                    }),
                ],
            }
        }

        // 获取案件类型信息
        const caseType = await getCaseTypeByIdService(caseTypeId)
        const caseTypeName = caseType?.name || '未知类型'

        // Requirements 5.1, 5.9: 执行基本信息提取，通过流式输出展示推理过程
        const extractedInfo = await extractBasicInfo(aggregatedContent, caseTypeName)

        logger.info('基本信息提取完成', {
            caseId,
            title: extractedInfo.title,
            plaintiffCount: extractedInfo.plaintiff.length,
            defendantCount: extractedInfo.defendant.length,
        })

        // Requirements 5.2, 5.3: 调用 interrupt() 暂停并返回提取结果
        // 构建中断数据
        const interruptData: ExtractInfoInterruptData = {
            type: InterruptType.BASIC_INFO_CONFIRM,
            message: formatInterruptMessage(extractedInfo),
            extractedInfo,
            caseTypeId,
            caseTypeName,
        }

        // 调用 interrupt 暂停工作流
        // Requirements 5.4, 5.5: 用户可以查看和修改提取结果
        const userInput = interrupt(interruptData)

        // Requirements 5.6, 5.7: 用户确认后使用修改后的数据更新案件记录
        const confirmedInfo = parseUserConfirmation(userInput as string | ConfirmedInfo, extractedInfo)

        logger.info('用户确认基本信息', {
            caseId,
            title: confirmedInfo.title,
        })

        // 返回 Command 更新状态并继续执行
        // Requirements 5.8: 继续执行模块选择节点
        return new Command({
            update: {
                title: confirmedInfo.title,
                plaintiff: confirmedInfo.plaintiff,
                defendant: confirmedInfo.defendant,
                summary: confirmedInfo.summary,
                caseTypeName: confirmedInfo.caseTypeName || caseTypeName,
                basicInfoConfirmed: true,
                currentPhase: WorkflowPhase.MODULE_SELECT,
                messages: [
                    new HumanMessage({
                        content: `用户确认基本信息：\n标题：${confirmedInfo.title}\n原告：${confirmedInfo.plaintiff.join('、')}\n被告：${confirmedInfo.defendant.join('、')}`,
                    }),
                    new AIMessage({
                        content: '基本信息已确认保存，正在获取可用的分析模块...',
                    }),
                ],
            },
            // 继续执行模块选择节点
            goto: 'module_select',
        })
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误'
        logger.error('基本信息提取节点执行异常', {
            caseId,
            error: errorMessage,
        })

        return {
            error: `基本信息提取异常: ${errorMessage}`,
            currentPhase: WorkflowPhase.EXTRACT_INFO,
            messages: [
                new AIMessage({
                    content: `基本信息提取过程中发生异常：${errorMessage}。请稍后重试或联系管理员。`,
                }),
            ],
        }
    }
}

/**
 * 执行基本信息提取
 *
 * @param materials 材料内容
 * @param caseTypeName 案件类型名称
 * @returns 提取的基本信息
 */
async function extractBasicInfo(
    materials: string,
    caseTypeName: string
): Promise<ExtractedInfo> {
    // 获取节点配置（必须在后台配置）
    const nodeConfig = await getNodeConfigService(EXTRACT_INFO_NODE_CONFIG_NAME)

    if (!nodeConfig) {
        throw new Error(`节点配置不存在：${EXTRACT_INFO_NODE_CONFIG_NAME}，请在后台管理中配置该节点`)
    }

    // 验证节点配置完整性
    validateNodeConfig(nodeConfig)

    // 构建提示词
    const { systemPrompt, userPrompt } = buildPrompts(nodeConfig, materials, caseTypeName)

    // 创建 AI 模型
    const model = createChatModelFromConfig(nodeConfig)

    // 调用 AI 进行信息提取
    const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
    ])

    // 解析响应
    const content = typeof response.content === 'string' ? response.content : ''
    return parseExtractedInfo(content, caseTypeName)
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
        throw new Error(`节点 ${EXTRACT_INFO_NODE_CONFIG_NAME} 缺少生效的系统提示词，请在后台管理中配置`)
    }

    // 检查是否有生效的用户提示词
    const userPrompt = nodeConfig.prompts.find((p) => p.type === 'user' && p.status === 1)
    if (!userPrompt) {
        throw new Error(`节点 ${EXTRACT_INFO_NODE_CONFIG_NAME} 缺少生效的用户提示词，请在后台管理中配置`)
    }

    // 检查是否有可用的 API 密钥
    const activeApiKey = nodeConfig.modelApiKeys.find((k) => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`节点 ${EXTRACT_INFO_NODE_CONFIG_NAME} 关联的模型没有可用的 API 密钥，请在后台管理中配置`)
    }
}

/**
 * 构建提示词
 *
 * @param nodeConfig 节点配置
 * @param materials 材料内容
 * @param caseTypeName 案件类型名称
 * @returns 系统提示词和用户提示词
 */
function buildPrompts(
    nodeConfig: NodeConfig,
    materials: string,
    caseTypeName: string
): { systemPrompt: string; userPrompt: string } {
    // 获取生效的提示词（已在 validateNodeConfig 中验证存在）
    const systemPromptConfig = nodeConfig.prompts.find((p) => p.type === 'system' && p.status === 1)!
    const userPromptConfig = nodeConfig.prompts.find((p) => p.type === 'user' && p.status === 1)!

    // 渲染用户提示词
    const userPrompt = renderContent(userPromptConfig.content, {
        materials,
        caseTypeName,
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
 * 解析提取的信息
 *
 * @param content AI 响应内容
 * @param caseTypeName 案件类型名称
 * @returns 解析后的基本信息
 */
function parseExtractedInfo(content: string, caseTypeName: string): ExtractedInfo {
    try {
        // 尝试从响应中提取 JSON
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            const result = ExtractedInfoSchema.safeParse(parsed)
            if (result.success) {
                return {
                    ...result.data,
                    caseTypeName: result.data.caseTypeName || caseTypeName,
                }
            }
        }

        // 如果无法解析 JSON，尝试从文本中提取关键信息
        return extractFromText(content, caseTypeName)
    } catch (error) {
        logger.warn('解析基本信息失败，使用默认值', { error })
        return {
            title: '未能提取案件标题',
            plaintiff: [],
            defendant: [],
            summary: content.slice(0, 500),
            caseTypeName,
        }
    }
}

/**
 * 从文本中提取基本信息
 *
 * @param content 文本内容
 * @param caseTypeName 案件类型名称
 * @returns 提取的基本信息
 */
function extractFromText(content: string, caseTypeName: string): ExtractedInfo {
    // 尝试提取标题
    const titleMatch = content.match(/标题[：:]\s*(.+?)(?:\n|$)/)
    const title = titleMatch ? titleMatch[1].trim() : '未能提取案件标题'

    // 尝试提取原告
    const plaintiffMatch = content.match(/原告[：:]\s*(.+?)(?:\n|$)/)
    const plaintiffStr = plaintiffMatch ? plaintiffMatch[1].trim() : ''
    const plaintiff = plaintiffStr ? plaintiffStr.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) : []

    // 尝试提取被告
    const defendantMatch = content.match(/被告[：:]\s*(.+?)(?:\n|$)/)
    const defendantStr = defendantMatch ? defendantMatch[1].trim() : ''
    const defendant = defendantStr ? defendantStr.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) : []

    // 尝试提取摘要
    const summaryMatch = content.match(/摘要[：:]\s*([\s\S]+?)(?:\n\n|$)/)
    const summary = summaryMatch ? summaryMatch[1].trim() : content.slice(0, 500)

    return {
        title,
        plaintiff,
        defendant,
        summary,
        caseTypeName,
    }
}

/**
 * 格式化中断消息
 *
 * @param extractedInfo 提取的信息
 * @returns 格式化的消息
 */
function formatInterruptMessage(extractedInfo: ExtractedInfo): string {
    let message = '已从案件材料中提取以下基本信息，请确认或修改：\n\n'

    message += `**案件标题**：${extractedInfo.title}\n\n`

    if (extractedInfo.plaintiff.length > 0) {
        message += `**原告**：${extractedInfo.plaintiff.join('、')}\n\n`
    } else {
        message += '**原告**：未识别到原告信息\n\n'
    }

    if (extractedInfo.defendant.length > 0) {
        message += `**被告**：${extractedInfo.defendant.join('、')}\n\n`
    } else {
        message += '**被告**：未识别到被告信息\n\n'
    }

    if (extractedInfo.caseTypeName) {
        message += `**案件类型**：${extractedInfo.caseTypeName}\n\n`
    }

    if (extractedInfo.causeOfAction) {
        message += `**案由**：${extractedInfo.causeOfAction}\n\n`
    }

    if (extractedInfo.amount) {
        message += `**诉讼标的金额**：${extractedInfo.amount}\n\n`
    }

    if (extractedInfo.caseDate) {
        message += `**案件发生时间**：${extractedInfo.caseDate}\n\n`
    }

    if (extractedInfo.caseLocation) {
        message += `**案件发生地点**：${extractedInfo.caseLocation}\n\n`
    }

    message += `**案件摘要**：\n${extractedInfo.summary}\n\n`

    message += '---\n\n'
    message += '请检查以上信息是否正确。您可以：\n'
    message += '1. 直接确认信息\n'
    message += '2. 修改后确认'

    return message
}

/**
 * 解析用户确认的信息
 *
 * @param userInput 用户输入（可能是字符串或对象）
 * @param defaultInfo 默认信息（提取的原始信息）
 * @returns 确认后的信息
 */
function parseUserConfirmation(
    userInput: string | ConfirmedInfo,
    defaultInfo: ExtractedInfo
): ConfirmedInfo {
    // 如果用户输入是对象，直接使用
    if (typeof userInput === 'object' && userInput !== null) {
        return {
            title: userInput.title || defaultInfo.title,
            plaintiff: userInput.plaintiff || defaultInfo.plaintiff,
            defendant: userInput.defendant || defaultInfo.defendant,
            summary: userInput.summary || defaultInfo.summary,
            caseTypeName: userInput.caseTypeName || defaultInfo.caseTypeName,
        }
    }

    // 如果用户输入是字符串
    const inputStr = String(userInput).trim()

    // 如果是简单确认（如 "确认"、"ok"、"是" 等），使用默认值
    const confirmPatterns = /^(确认|确定|ok|yes|是|好的|可以|没问题)$/i
    if (confirmPatterns.test(inputStr)) {
        return {
            title: defaultInfo.title,
            plaintiff: defaultInfo.plaintiff,
            defendant: defaultInfo.defendant,
            summary: defaultInfo.summary,
            caseTypeName: defaultInfo.caseTypeName,
        }
    }

    // 尝试解析 JSON 格式的输入
    try {
        const parsed = JSON.parse(inputStr)
        return {
            title: parsed.title || defaultInfo.title,
            plaintiff: parsed.plaintiff || defaultInfo.plaintiff,
            defendant: parsed.defendant || defaultInfo.defendant,
            summary: parsed.summary || defaultInfo.summary,
            caseTypeName: parsed.caseTypeName || defaultInfo.caseTypeName,
        }
    } catch {
        // 不是 JSON，使用默认值
        return {
            title: defaultInfo.title,
            plaintiff: defaultInfo.plaintiff,
            defendant: defaultInfo.defendant,
            summary: defaultInfo.summary,
            caseTypeName: defaultInfo.caseTypeName,
        }
    }
}

/**
 * 检查基本信息是否已确认（用于外部调用）
 *
 * @param state 工作流状态
 * @returns 是否已确认
 */
export function isBasicInfoConfirmed(state: CaseAnalysisState): boolean {
    return state.basicInfoConfirmed
}

/**
 * 获取提取的基本信息（用于外部调用）
 *
 * @param state 工作流状态
 * @returns 基本信息
 */
export function getExtractedBasicInfo(state: CaseAnalysisState): ExtractedInfo {
    return {
        title: state.title,
        plaintiff: state.plaintiff,
        defendant: state.defendant,
        summary: state.summary,
        caseTypeName: state.caseTypeName,
    }
}
