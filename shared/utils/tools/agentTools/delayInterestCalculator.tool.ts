/**
 * 迟延履行利息计算 Agent 工具
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolModule, ToolContext } from '#shared/types/agentTools'
import { calculateDelayInterest } from '#shared/utils/tools/delayInterestService'

const schema = z.object({
    amount: z.number().positive().describe('本金金额（元）'),
    startDate: z.string().describe('迟延履行开始日期，格式 YYYY-MM-DD'),
    endDate: z.string().describe('迟延履行结束日期，格式 YYYY-MM-DD'),
})

export const delayInterestCalculatorTool: ToolModule = {
    toolDefinition: {
        name: 'calculate_delay_interest',
        description: '迟延履行利息计算：根据判决确定的本金、迟延期间起止日期，依据司法解释规则（2019年8月20日前用央行基准利率1.5倍，之后用LPR 4倍）计算迟延履行利息',
        schema,
    },
    createTool: (_ctx: ToolContext) =>
        tool(
            async (input) => {
                const result = calculateDelayInterest(input.amount, input.startDate, input.endDate)
                return JSON.stringify(result)
            },
            {
                name: 'calculate_delay_interest',
                description: '迟延履行利息计算：根据判决确定的本金、迟延期间起止日期，依据司法解释规则（2019年8月20日前用央行基准利率1.5倍，之后用LPR 4倍）计算迟延履行利息',
                schema,
            },
        ) as any,
}
