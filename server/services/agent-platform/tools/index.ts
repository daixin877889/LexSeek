/**
 * 通用工作流工具注册表
 *
 * 统一管理所有通用工作流工具，提供工具元信息查询和实例创建
 * Requirements: 12.1.1-12.1.5
 */

import type { StructuredTool } from '@langchain/core/tools'
import type { ToolMeta, ToolContext, ToolModule } from './types'
import { getToolMetaFromDefinition } from './types'

// 导入所有通用工具模块
import * as searchCaseMaterialsTool from './searchCaseMaterials.tool'
import * as searchLawTool from './searchLaw.tool'
import * as processMaterialsTool from './processMaterials.tool'
import * as reservePointsTool from './reservePoints.tool'
import * as confirmPointsTool from './confirmPoints.tool'
import * as rollbackPointsTool from './rollbackPoints.tool'
import * as readSkillFileTool from './readSkillFile.tool'
import * as runSkillScriptTool from './runSkillScript.tool'
import * as runSkillCommandTool from './runSkillCommand.tool'
import * as writeSkillFileTool from './writeSkillFile.tool'
import * as uploadWorkspaceFileTool from './uploadWorkspaceFile.tool'
import * as searchCaseMemoryTool from './search_case_memory.tool'
import * as writeCaseMemoryTool from './write_case_memory.tool'
import * as updateCaseMemoryTool from './update_case_memory.tool'
import * as searchCaseAnalysisTool from './search_case_analysis.tool'
import * as reviewContractTool from './reviewContract.tool'
import * as recommendTemplateTool from './recommendTemplate.tool'
import * as saveDocumentDraftTool from './saveDocumentDraft.tool'
import * as updateDocumentDraftTool from './updateDocumentDraft.tool'
import * as compensationCalculatorTool from '#shared/utils/tools/agentTools/compensationCalculator.tool'
import * as interestCalculatorTool from '#shared/utils/tools/agentTools/interestCalculator.tool'
import * as delayInterestCalculatorTool from '#shared/utils/tools/agentTools/delayInterestCalculator.tool'
import * as courtFeeCalculatorTool from '#shared/utils/tools/agentTools/courtFeeCalculator.tool'
import * as lawyerFeeCalculatorTool from '#shared/utils/tools/agentTools/lawyerFeeCalculator.tool'
import * as overtimePayCalculatorTool from '#shared/utils/tools/agentTools/overtimePayCalculator.tool'
import * as socialInsuranceCalculatorTool from '#shared/utils/tools/agentTools/socialInsuranceCalculator.tool'
import * as divorcePropertyCalculatorTool from '#shared/utils/tools/agentTools/divorcePropertyCalculator.tool'
import * as dateCalculatorTool from '#shared/utils/tools/agentTools/dateCalculator.tool'
import * as bankRateQueryTool from '#shared/utils/tools/agentTools/bankRateQuery.tool'

/** 通用工具模块映射 */
const toolModules: Record<string, ToolModule> = {
    search_case_materials: searchCaseMaterialsTool,
    search_law: searchLawTool,
    process_materials: processMaterialsTool,
    reserve_points: reservePointsTool,
    confirm_points: confirmPointsTool,
    rollback_points: rollbackPointsTool,
    read_skill_file: readSkillFileTool,
    run_skill_script: runSkillScriptTool,
    run_skill_command: runSkillCommandTool,
    write_skill_file: writeSkillFileTool,
    upload_workspace_file: uploadWorkspaceFileTool,
    search_case_memory: searchCaseMemoryTool,
    write_case_memory: writeCaseMemoryTool,
    update_case_memory: updateCaseMemoryTool,
    search_case_analysis: searchCaseAnalysisTool,
    // 文书工具(无会话纯函数,2026-05-05 取代旧的 draft_document 反模式)
    recommend_template: recommendTemplateTool,
    save_document_draft: saveDocumentDraftTool,
    update_document_draft: updateDocumentDraftTool,
    review_contract: reviewContractTool,
    // 办案计算器工具
    calculate_compensation: compensationCalculatorTool,
    calculate_interest: interestCalculatorTool,
    calculate_delay_interest: delayInterestCalculatorTool,
    calculate_court_fee: courtFeeCalculatorTool,
    calculate_lawyer_fee: lawyerFeeCalculatorTool,
    calculate_overtime_pay: overtimePayCalculatorTool,
    calculate_social_insurance_backpay: socialInsuranceCalculatorTool,
    calculate_divorce_property: divorcePropertyCalculatorTool,
    calculate_date: dateCalculatorTool,
    query_bank_rate: bankRateQueryTool,
}

/**
 * 获取所有已注册工具的元信息
 *
 * @returns 工具元信息列表
 */
export function getAllToolsService(): ToolMeta[] {
    return Object.values(toolModules).map(module =>
        getToolMetaFromDefinition(module.toolDefinition)
    )
}

/**
 * 根据名称获取工具元信息
 *
 * @param name 工具名称
 * @returns 工具元信息，不存在则返回 null
 */
export function getToolMetaService(name: string): ToolMeta | null {
    const module = toolModules[name]
    return module ? getToolMetaFromDefinition(module.toolDefinition) : null
}

/**
 * 根据名称列表获取工具实例
 *
 * @param names 工具名称列表
 * @param context 工具上下文
 * @returns 工具实例列表
 */
export function getToolInstancesService(
    names: string[],
    context: ToolContext
): StructuredTool[] {
    const tools: StructuredTool[] = []

    for (const name of names) {
        const module = toolModules[name]
        if (module) {
            tools.push(module.createTool(context))
        } else {
            logger.warn(`工具 ${name} 不存在，已跳过`)
        }
    }

    return tools
}

/**
 * 检查工具是否存在
 *
 * @param name 工具名称
 * @returns 是否存在
 */
export function hasToolService(name: string): boolean {
    return name in toolModules
}

/**
 * 获取所有工具名称
 *
 * @returns 工具名称列表
 */
export function getAllToolNamesService(): string[] {
    return Object.keys(toolModules)
}

// 导出类型
export type { ToolMeta, ToolContext, ToolModule, ToolParameter } from './types'
