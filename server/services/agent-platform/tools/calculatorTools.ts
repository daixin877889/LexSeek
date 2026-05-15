/**
 * Agent 工具汇总导出
 *
 * 包含 10 个办案计算工具，可通过 allCalculatorTools 数组批量注册到 agent-platform。
 * T5/T11/T12 已将所有工具重构为 namespace 形态（toolDefinition + createTool），
 * 统一使用 * as 整体导出。
 */

export * as compensationCalculatorTool from './compensationCalculator.tool'
export * as divorcePropertyCalculatorTool from './divorcePropertyCalculator.tool'
export * as delayInterestCalculatorTool from './delayInterestCalculator.tool'
export * as overtimePayCalculatorTool from './overtimePayCalculator.tool'
export * as socialInsuranceCalculatorTool from './socialInsuranceCalculator.tool'
export * as interestCalculatorTool from './interestCalculator.tool'
export * as courtFeeCalculatorTool from './courtFeeCalculator.tool'
export * as lawyerFeeCalculatorTool from './lawyerFeeCalculator.tool'
export * as bankRateQueryTool from './bankRateQuery.tool'
export * as dateCalculatorTool from './dateCalculator.tool'

import * as compensationCalculatorTool from './compensationCalculator.tool'
import * as divorcePropertyCalculatorTool from './divorcePropertyCalculator.tool'
import * as delayInterestCalculatorTool from './delayInterestCalculator.tool'
import * as overtimePayCalculatorTool from './overtimePayCalculator.tool'
import * as socialInsuranceCalculatorTool from './socialInsuranceCalculator.tool'
import * as interestCalculatorTool from './interestCalculator.tool'
import * as courtFeeCalculatorTool from './courtFeeCalculator.tool'
import * as lawyerFeeCalculatorTool from './lawyerFeeCalculator.tool'
import * as bankRateQueryTool from './bankRateQuery.tool'
import * as dateCalculatorTool from './dateCalculator.tool'

/** 全部办案计算工具列表，可批量注册到 agent-platform */
export const allCalculatorTools = [
    compensationCalculatorTool,
    divorcePropertyCalculatorTool,
    delayInterestCalculatorTool,
    overtimePayCalculatorTool,
    socialInsuranceCalculatorTool,
    interestCalculatorTool,
    courtFeeCalculatorTool,
    lawyerFeeCalculatorTool,
    bankRateQueryTool,
    dateCalculatorTool,
] as const
