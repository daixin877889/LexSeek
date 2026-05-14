/**
 * Agent 工具汇总导出
 *
 * 包含 10 个办案计算工具，可通过 allCalculatorTools 数组批量注册到 agent-platform。
 */

export { divorcePropertyCalculatorTool } from './divorcePropertyCalculator.tool'
export { delayInterestCalculatorTool } from './delayInterestCalculator.tool'
export { interestCalculatorTool } from './interestCalculator.tool'
export { courtFeeCalculatorTool } from './courtFeeCalculator.tool'
export { lawyerFeeCalculatorTool } from './lawyerFeeCalculator.tool'
export { compensationCalculatorTool } from './compensationCalculator.tool'
export { overtimePayCalculatorTool } from './overtimePayCalculator.tool'
export { socialInsuranceCalculatorTool } from './socialInsuranceCalculator.tool'
export { bankRateQueryTool } from './bankRateQuery.tool'
export { dateCalculatorTool } from './dateCalculator.tool'

import { divorcePropertyCalculatorTool } from './divorcePropertyCalculator.tool'
import { delayInterestCalculatorTool } from './delayInterestCalculator.tool'
import { interestCalculatorTool } from './interestCalculator.tool'
import { courtFeeCalculatorTool } from './courtFeeCalculator.tool'
import { lawyerFeeCalculatorTool } from './lawyerFeeCalculator.tool'
import { compensationCalculatorTool } from './compensationCalculator.tool'
import { overtimePayCalculatorTool } from './overtimePayCalculator.tool'
import { socialInsuranceCalculatorTool } from './socialInsuranceCalculator.tool'
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
