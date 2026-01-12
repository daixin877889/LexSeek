/**
 * 模块选择节点（中断点3）
 *
 * LangGraph 工作流中的模块选择节点，负责：
 * 1. 获取用户可用的分析模块列表（根据会员权限）
 * 2. 获取每个模块的积分消耗信息
 * 3. 调用 interrupt() 暂停等待用户选择分析模块
 * 4. 用户选择后继续执行分析任务节点
 *
 * @see Requirements 6.1, 6.2, 6.3, 6.4
 * @see design.md - LangGraph 工作流架构
 */

import { interrupt, Command } from '@langchain/langgraph'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import {
    type CaseAnalysisState,
    type CaseAnalysisStateUpdate,
} from '../state'
import {
    type AnalysisModuleInfo,
    InterruptType,
    WorkflowPhase,
} from '#shared/types/case'
import { getUserAvailableNodesService } from '../../node/access.service'
import { getPointConsumptionItemsService } from '../../point/pointConsumptionItems.service'
import { getUserPointSummary } from '../../point/pointRecords.service'
import { decimalToNumberUtils } from '#shared/utils/decimalToNumber'
import { logger } from '#shared/utils/logger'

/** 模块选择节点名称（LangGraph 工作流中使用） */
export const MODULE_SELECT_NODE_NAME = 'module_select'

/** 分析模块积分消耗项目分组名称 */
const ANALYSIS_MODULES_GROUP = 'analysisModules'

/** 中断数据接口 */
export interface ModuleSelectInterruptData {
    /** 中断类型 */
    type: InterruptType.MODULE_SELECT
    /** 提示消息 */
    message: string
    /** 可用的分析模块列表 */
    availableModules: AnalysisModuleInfo[]
    /** 用户当前可用积分 */
    userAvailablePoints: number
    /** 用户是否有足够积分 */
    hasEnoughPoints: boolean
}

/** 用户选择的模块接口 */
export interface SelectedModulesInput {
    /** 选择的模块名称列表 */
    modules: string[]
}

/**
 * 模块选择节点
 *
 * 该节点在基本信息确认后执行，负责：
 * 1. 获取用户可用的分析模块列表
 * 2. 获取每个模块的积分消耗信息
 * 3. 调用 interrupt() 暂停等待用户选择
 * 4. 用户选择后继续执行分析任务节点
 *
 * @param state 当前工作流状态
 * @returns 状态更新或 Command
 */
export async function moduleSelectNode(
    state: CaseAnalysisState
): Promise<CaseAnalysisStateUpdate | Command> {
    const { caseId, sessionId, userId, selectedModules } = state

    logger.info('模块选择节点开始执行', {
        caseId,
        sessionId,
        userId,
        phase: state.currentPhase,
        hasSelectedModules: selectedModules.length > 0,
    })

    try {
        // 如果用户已选择模块，直接进入分析任务阶段
        // Requirements 6.4: 用户选择模块并确认后继续执行分析任务节点
        if (selectedModules.length > 0) {
            logger.info('用户已选择模块，进入分析任务阶段', {
                caseId,
                selectedModules,
            })
            return {
                currentPhase: WorkflowPhase.ANALYSIS_TASK,
                currentModuleIndex: 0,
                messages: [
                    new AIMessage({
                        content: `已选择 ${selectedModules.length} 个分析模块，开始执行分析任务...`,
                    }),
                ],
            }
        }

        // Requirements 6.1: 获取用户可用的分析模块列表
        const availableModules = await getAvailableModulesWithPointInfo(userId)

        logger.info('获取可用模块列表完成', {
            caseId,
            userId,
            totalModules: availableModules.length,
            accessibleModules: availableModules.filter((m) => m.hasAccess).length,
        })

        // 获取用户积分信息
        // Requirements 6.2: 检查用户积分是否足够
        const pointSummary = await getUserPointSummary(userId)
        const userAvailablePoints = pointSummary.remaining

        // 计算用户是否有足够积分执行至少一个模块
        const minPointCost = Math.min(
            ...availableModules.filter((m) => m.hasAccess).map((m) => m.pointCost)
        )
        const hasEnoughPoints = userAvailablePoints >= minPointCost

        // Requirements 6.2, 6.3: 调用 interrupt() 返回可用模块列表
        // 构建中断数据
        const interruptData: ModuleSelectInterruptData = {
            type: InterruptType.MODULE_SELECT,
            message: formatInterruptMessage(availableModules, userAvailablePoints, hasEnoughPoints),
            availableModules,
            userAvailablePoints,
            hasEnoughPoints,
        }

        // 调用 interrupt 暂停工作流
        const userInput = interrupt(interruptData)

        // 解析用户选择的模块
        const selectedModuleNames = parseUserSelection(
            userInput as string | SelectedModulesInput,
            availableModules
        )

        // 验证用户选择的模块
        const validationResult = validateSelectedModules(
            selectedModuleNames,
            availableModules,
            userAvailablePoints
        )

        if (!validationResult.valid) {
            logger.warn('用户选择的模块验证失败', {
                caseId,
                userId,
                selectedModuleNames,
                error: validationResult.error,
            })

            // 返回错误信息，重新进入模块选择
            return new Command({
                update: {
                    messages: [
                        new HumanMessage({
                            content: `用户选择模块：${selectedModuleNames.join('、')}`,
                        }),
                        new AIMessage({
                            content: `选择验证失败：${validationResult.error}\n\n请重新选择分析模块。`,
                        }),
                    ],
                },
                // 重新执行模块选择节点
                goto: MODULE_SELECT_NODE_NAME,
            })
        }

        logger.info('用户选择模块验证通过', {
            caseId,
            userId,
            selectedModuleNames,
            totalPointCost: validationResult.totalPointCost,
        })

        // 返回 Command 更新状态并继续执行
        // Requirements 6.4: 继续执行分析任务节点
        return new Command({
            update: {
                availableModules,
                selectedModules: selectedModuleNames,
                currentModuleIndex: 0,
                currentPhase: WorkflowPhase.ANALYSIS_TASK,
                messages: [
                    new HumanMessage({
                        content: `用户选择分析模块：${selectedModuleNames.join('、')}`,
                    }),
                    new AIMessage({
                        content: `已选择 ${selectedModuleNames.length} 个分析模块，预计消耗 ${validationResult.totalPointCost} 积分。开始执行分析任务...`,
                    }),
                ],
            },
            // 继续执行分析任务节点
            goto: 'analysis_task',
        })
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误'
        logger.error('模块选择节点执行异常', {
            caseId,
            userId,
            error: errorMessage,
        })

        return {
            error: `模块选择异常: ${errorMessage}`,
            currentPhase: WorkflowPhase.MODULE_SELECT,
            messages: [
                new AIMessage({
                    content: `获取分析模块列表时发生异常：${errorMessage}。请稍后重试或联系管理员。`,
                }),
            ],
        }
    }
}

/**
 * 获取用户可用的分析模块列表（包含积分信息）
 *
 * @param userId 用户 ID
 * @returns 带积分信息的模块列表
 */
async function getAvailableModulesWithPointInfo(userId: number): Promise<AnalysisModuleInfo[]> {
    // 获取用户可用的节点列表（根据会员权限）
    const userNodes = await getUserAvailableNodesService(userId)

    // 只获取分析类型的节点（analysis 和 document）
    const analysisNodes = userNodes.filter(
        (node) => node.type === 'analysis' || node.type === 'document'
    )

    // 获取分析模块的积分消耗项目
    const { list: pointItems } = await getPointConsumptionItemsService({
        group: ANALYSIS_MODULES_GROUP,
        status: 1, // 只获取启用的项目
    })

    // 构建积分消耗映射（按节点名称）
    const pointItemMap = new Map<string, { pointAmount: number; discount: number }>()
    for (const item of pointItems) {
        // 使用 decimalToNumberUtils 转换 Decimal 类型
        const discount = item.discount !== null && item.discount !== undefined
            ? decimalToNumberUtils(item.discount)
            : 1
        pointItemMap.set(item.name, {
            pointAmount: item.pointAmount,
            discount,
        })
    }

    // 构建模块信息列表
    const modules: AnalysisModuleInfo[] = analysisNodes.map((node) => {
        const pointInfo = pointItemMap.get(node.name)
        const pointAmount = pointInfo?.pointAmount ?? 0
        const discount = pointInfo?.discount ?? 1

        return {
            nodeId: node.id,
            name: node.name,
            title: node.title || node.name,
            type: node.type,
            pointCost: Math.ceil(pointAmount * discount),
            discount: discount < 1 ? discount : undefined,
            hasAccess: node.available,
        }
    })

    return modules
}

/**
 * 格式化中断消息
 *
 * @param modules 可用模块列表
 * @param userPoints 用户可用积分
 * @param hasEnoughPoints 是否有足够积分
 * @returns 格式化的消息
 */
function formatInterruptMessage(
    modules: AnalysisModuleInfo[],
    userPoints: number,
    hasEnoughPoints: boolean
): string {
    let message = '请选择要执行的分析模块：\n\n'

    // 按类型分组显示模块
    const analysisModules = modules.filter((m) => m.type === 'analysis')
    const documentModules = modules.filter((m) => m.type === 'document')

    if (analysisModules.length > 0) {
        message += '**分析模块**：\n'
        for (const module of analysisModules) {
            message += formatModuleItem(module)
        }
        message += '\n'
    }

    if (documentModules.length > 0) {
        message += '**文书模块**：\n'
        for (const module of documentModules) {
            message += formatModuleItem(module)
        }
        message += '\n'
    }

    message += '---\n\n'
    message += `**您的可用积分**：${userPoints}\n\n`

    if (!hasEnoughPoints) {
        message += '⚠️ 您的积分不足以执行任何分析模块，请先充值积分。\n\n'
    }

    message += '请选择要执行的分析模块（可多选）。'

    return message
}

/**
 * 格式化单个模块项
 *
 * @param module 模块信息
 * @returns 格式化的模块项
 */
function formatModuleItem(module: AnalysisModuleInfo): string {
    let item = `- ${module.title}`

    // 显示积分消耗
    if (module.discount && module.discount < 1) {
        item += ` (${module.pointCost} 积分，${Math.round(module.discount * 100)}% 折扣)`
    } else {
        item += ` (${module.pointCost} 积分)`
    }

    // 显示权限状态
    if (!module.hasAccess) {
        item += ' 🔒 需升级会员'
    }

    item += '\n'
    return item
}

/**
 * 解析用户选择的模块
 *
 * @param userInput 用户输入
 * @param availableModules 可用模块列表
 * @returns 选择的模块名称列表
 */
function parseUserSelection(
    userInput: string | SelectedModulesInput,
    availableModules: AnalysisModuleInfo[]
): string[] {
    // 如果用户输入是对象，直接使用
    if (typeof userInput === 'object' && userInput !== null && Array.isArray(userInput.modules)) {
        return userInput.modules
    }

    // 如果用户输入是字符串
    const inputStr = String(userInput).trim()

    // 尝试解析 JSON 格式
    try {
        const parsed = JSON.parse(inputStr)
        if (Array.isArray(parsed)) {
            return parsed
        }
        if (parsed.modules && Array.isArray(parsed.modules)) {
            return parsed.modules
        }
    } catch {
        // 不是 JSON，继续处理
    }

    // 尝试按分隔符分割
    const separators = /[,，、\n]/
    const parts = inputStr.split(separators).map((s) => s.trim()).filter(Boolean)

    // 尝试匹配模块名称或标题
    const selectedModules: string[] = []
    for (const part of parts) {
        const matchedModule = availableModules.find(
            (m) =>
                m.name.toLowerCase() === part.toLowerCase() ||
                m.title.toLowerCase() === part.toLowerCase()
        )
        if (matchedModule) {
            selectedModules.push(matchedModule.name)
        }
    }

    // 如果没有匹配到任何模块，尝试使用原始输入
    if (selectedModules.length === 0 && parts.length > 0) {
        return parts
    }

    return selectedModules
}

/**
 * 验证用户选择的模块
 *
 * @param selectedModules 选择的模块名称列表
 * @param availableModules 可用模块列表
 * @param userPoints 用户可用积分
 * @returns 验证结果
 */
function validateSelectedModules(
    selectedModules: string[],
    availableModules: AnalysisModuleInfo[],
    userPoints: number
): { valid: boolean; error?: string; totalPointCost: number } {
    // 检查是否选择了模块
    if (selectedModules.length === 0) {
        return { valid: false, error: '请至少选择一个分析模块', totalPointCost: 0 }
    }

    // 构建模块映射
    const moduleMap = new Map<string, AnalysisModuleInfo>()
    for (const module of availableModules) {
        moduleMap.set(module.name, module)
    }

    // 验证每个选择的模块
    let totalPointCost = 0
    const invalidModules: string[] = []
    const noAccessModules: string[] = []

    for (const moduleName of selectedModules) {
        const module = moduleMap.get(moduleName)

        if (!module) {
            invalidModules.push(moduleName)
            continue
        }

        if (!module.hasAccess) {
            noAccessModules.push(module.title)
            continue
        }

        totalPointCost += module.pointCost
    }

    // 检查无效模块
    if (invalidModules.length > 0) {
        return {
            valid: false,
            error: `以下模块不存在：${invalidModules.join('、')}`,
            totalPointCost,
        }
    }

    // 检查无权限模块
    // Requirements 6.3: 如果用户会员等级不足，提示用户升级会员
    if (noAccessModules.length > 0) {
        return {
            valid: false,
            error: `您的会员等级无法使用以下模块：${noAccessModules.join('、')}。请升级会员后再试。`,
            totalPointCost,
        }
    }

    // 检查积分是否足够
    // Requirements 6.2: 如果用户积分不足，提示用户充值
    if (totalPointCost > userPoints) {
        return {
            valid: false,
            error: `积分不足。所选模块需要 ${totalPointCost} 积分，您当前可用积分为 ${userPoints}。请充值后再试。`,
            totalPointCost,
        }
    }

    return { valid: true, totalPointCost }
}

/**
 * 检查是否已选择模块（用于外部调用）
 *
 * @param state 工作流状态
 * @returns 是否已选择模块
 */
export function hasSelectedModules(state: CaseAnalysisState): boolean {
    return state.selectedModules.length > 0
}

/**
 * 获取选择的模块列表（用于外部调用）
 *
 * @param state 工作流状态
 * @returns 选择的模块名称列表
 */
export function getSelectedModules(state: CaseAnalysisState): string[] {
    return state.selectedModules
}

/**
 * 获取可用模块列表（用于外部调用）
 *
 * @param state 工作流状态
 * @returns 可用模块列表
 */
export function getAvailableModules(state: CaseAnalysisState): AnalysisModuleInfo[] {
    return state.availableModules
}
