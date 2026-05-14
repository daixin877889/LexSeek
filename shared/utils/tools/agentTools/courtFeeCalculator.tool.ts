/**
 * 诉讼费用计算 Agent 工具
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolModule, ToolContext } from '#shared/types/agentTools'
import { calculateCourtFee } from '#shared/utils/tools/courtFeeService'

const schema = z.object({
    feeTypeLevel1: z.enum(['caseFee', 'applicationFee']).describe(
        '费用一级类型：caseFee（受理费）、applicationFee（申请费）'
    ),
    feeTypeLevel2: z.string().describe(
        '费用二级类型。受理费(caseFee)可填：property（财产案件）、nonProperty（非财产案件）、intellectual（知识产权）、maritime（海事）、administrative（行政）、appeal（上诉）、small（小额诉讼）。申请费(applicationFee)可填：preservation（保全申请）、execution（强制执行）、arbitration（仲裁申请）'
    ),
    amount: z.number().min(0).default(0).describe('案件标的金额或争议金额（元），非财产类案件填 0'),
    nonPropertyType: z.enum(['divorce', 'personality', 'other']).optional().describe('非财产案件子类型：divorce（离婚）、personality（人格权）、other（其他）'),
    hasProperty: z.boolean().optional().describe('非财产案件是否涉及财产分割或损害赔偿'),
    hasDamages: z.boolean().optional().describe('人格权案件是否涉及损害赔偿'),
})

export const courtFeeCalculatorTool: ToolModule = {
    toolDefinition: {
        name: 'calculate_court_fee',
        description: '诉讼费用计算：根据《诉讼费用交纳办法》计算各类案件受理费、申请费，支持财产案件、非财产案件（离婚、人格权）、知识产权、海事、执行申请等类型',
        schema,
    },
    createTool: (_ctx: ToolContext) =>
        tool(
            async (input) => {
                const options = {
                    nonPropertyType: input.nonPropertyType,
                    hasProperty: input.hasProperty,
                    hasDamages: input.hasDamages,
                }
                const result = calculateCourtFee(
                    input.feeTypeLevel1 as any,
                    input.feeTypeLevel2 as any,
                    input.amount,
                    options,
                )
                return JSON.stringify(result)
            },
            {
                name: 'calculate_court_fee',
                description: '诉讼费用计算：根据《诉讼费用交纳办法》计算各类案件受理费、申请费，支持财产案件、非财产案件（离婚、人格权）、知识产权、海事、执行申请等类型',
                schema,
            },
        ) as any,
}
