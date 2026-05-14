/**
 * 利息计算 Agent 工具
 * 支持 LPR 利息、央行基准利率利息、自定义利率利息、简单/复利等多种模式
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolModule, ToolContext } from '#shared/types/agentTools'
import {
    calculateLPRInterest,
    calculatePBOCInterest,
    calculateSimpleInterest,
} from '#shared/utils/tools/interestService'

const schema = z.object({
    mode: z.enum(['lpr', 'pboc', 'simple']).describe(
        '计算模式：lpr（LPR贷款市场报价利率）、pboc（央行基准利率）、simple（简单年化利率）'
    ),
    amount: z.number().positive().describe('本金金额（元）'),
    startDate: z.string().describe('计息开始日期，格式 YYYY-MM-DD'),
    endDate: z.string().describe('计息结束日期，格式 YYYY-MM-DD'),
    annualRate: z.number().min(0).optional().describe('年化利率（%），mode=simple 时必填，其他模式忽略'),
    adjustmentMethod: z.enum(['无', '上浮', '下浮', '倍率', '倍数', '加点', '减点']).default('无').describe('利率调整方式：无（直接用基准利率）、倍率（乘以指定倍数）、加点（加上浮动点数）等'),
    adjustmentValue: z.number().default(0).describe('调整值：当 adjustmentMethod 为倍率时填倍数（如 1.5），加点时填点数，无时填 0'),
    lprPeriod: z.number().int().min(1).max(2).default(1).describe('LPR 期限档：1=一年期，2=五年期以上，仅 mode=lpr 时生效'),
    pbocPeriod: z.number().int().min(1).max(5).default(2).describe('央行基准贷款期限档：1=六个月以内, 2=六个月至一年, 3=一至三年, 4=三至五年, 5=五年以上，仅 mode=pboc 时生效'),
})

export const interestCalculatorTool: ToolModule = {
    toolDefinition: {
        name: 'calculate_interest',
        description: '利息计算：支持 LPR 贷款市场报价利率利息、央行基准利率利息、自定义年化利率利息三种模式，可设置利率倍数，适用于合同违约金、借款利息等场景',
        schema,
    },
    createTool: (_ctx: ToolContext) =>
        tool(
            async (input) => {
                let result: unknown

                if (input.mode === 'lpr') {
                    result = calculateLPRInterest(
                        input.amount,
                        input.startDate,
                        input.endDate,
                        input.lprPeriod,
                        input.adjustmentMethod,
                        input.adjustmentValue,
                    )
                } else if (input.mode === 'pboc') {
                    result = calculatePBOCInterest(
                        input.amount,
                        input.startDate,
                        input.endDate,
                        input.pbocPeriod,
                        input.adjustmentMethod,
                        input.adjustmentValue,
                    )
                } else {
                    // simple 模式
                    const rate = input.annualRate ?? 0
                    result = calculateSimpleInterest(input.amount, rate, input.startDate, input.endDate)
                }

                return JSON.stringify(result)
            },
            {
                name: 'calculate_interest',
                description: '利息计算：支持 LPR 贷款市场报价利率利息、央行基准利率利息、自定义年化利率利息三种模式，可设置利率倍数，适用于合同违约金、借款利息等场景',
                schema,
            },
        ) as any,
}
