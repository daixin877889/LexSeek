/**
 * Agent 工具汇总导出
 *
 * 包含 10 个办案计算工具，可通过 allCalculatorTools 数组批量注册到 agent-platform。
 */

// T5/T11 重构为 namespace 形态的工具，以 * as 整体导出
export * as compensationCalculatorTool from './compensationCalculator.tool'
export * as divorcePropertyCalculatorTool from './divorcePropertyCalculator.tool'
export * as delayInterestCalculatorTool from './delayInterestCalculator.tool'
export * as overtimePayCalculatorTool from './overtimePayCalculator.tool'
export * as socialInsuranceCalculatorTool from './socialInsuranceCalculator.tool'
// 其他工具保留原格式（T12 重构后同步改为 namespace）
export { interestCalculatorTool } from './interestCalculator.tool'
export { courtFeeCalculatorTool } from './courtFeeCalculator.tool'
export { lawyerFeeCalculatorTool } from './lawyerFeeCalculator.tool'
export { bankRateQueryTool } from './bankRateQuery.tool'
export { dateCalculatorTool } from './dateCalculator.tool'

import * as compensationCalculatorTool from './compensationCalculator.tool'
import * as divorcePropertyCalculatorTool from './divorcePropertyCalculator.tool'
import * as delayInterestCalculatorTool from './delayInterestCalculator.tool'
import * as overtimePayCalculatorTool from './overtimePayCalculator.tool'
import * as socialInsuranceCalculatorTool from './socialInsuranceCalculator.tool'
import { interestCalculatorTool } from './interestCalculator.tool'
import { courtFeeCalculatorTool } from './courtFeeCalculator.tool'
import { lawyerFeeCalculatorTool } from './lawyerFeeCalculator.tool'
import { bankRateQueryTool } from './bankRateQuery.tool'
import { dateCalculatorTool } from './dateCalculator.tool'

/** 全部办案计算工具列表，可批量注册到 agent-platform */
export const allCalculatorTools = [
    divorcePropertyCalculatorTool,
    delayInterestCalculatorTool,
    interestCalculatorTool,
    courtFeeCalculatorTool,
    lawyerFeeCalculatorTool,
    compensationCalculatorTool,
    overtimePayCalculatorTool,
    socialInsuranceCalculatorTool,
    bankRateQueryTool,
    dateCalculatorTool,
] as const
