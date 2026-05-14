/**
 * 离婚财产分割计算 Agent 工具
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolModule, ToolContext } from '#shared/types/agentTools'
import { calculateDivorceProperty } from '#shared/utils/tools/divorcePropertyService'

const schema = z.object({
    house: z.number().min(0).default(0).describe('房产价值（元）'),
    car: z.number().min(0).default(0).describe('车辆价值（元）'),
    savings: z.number().min(0).default(0).describe('存款金额（元）'),
    investments: z.number().min(0).default(0).describe('投资理财金额（元）'),
    otherAssets: z.number().min(0).default(0).describe('其他财产价值（元）'),
    mortgage: z.number().min(0).default(0).describe('房贷余额（元）'),
    carLoan: z.number().min(0).default(0).describe('车贷余额（元）'),
    creditCard: z.number().min(0).default(0).describe('信用卡债务（元）'),
    otherDebts: z.number().min(0).default(0).describe('其他债务（元）'),
    husbandRatio: z.number().min(0).max(1).default(0.5).describe('丈夫分得比例（0-1，默认0.5）'),
    wifeRatio: z.number().min(0).max(1).default(0.5).describe('妻子分得比例（0-1，默认0.5）'),
    hasChildren: z.boolean().default(false).describe('是否有子女'),
    childCustody: z.enum(['husband', 'wife', 'shared']).default('shared').describe('子女抚养权归属：husband（丈夫）、wife（妻子）、shared（共同）'),
})

export const divorcePropertyCalculatorTool: ToolModule = {
    toolDefinition: {
        name: 'calculate_divorce_property',
        description: '离婚财产分割计算：根据双方共同财产（房产、车辆、存款等）和共同债务，按照指定分割比例计算各方所得净资产及子女抚养费',
        schema,
    },
    createTool: (_ctx: ToolContext) =>
        tool(
            async (input) => {
                const assets = {
                    house: input.house,
                    car: input.car,
                    savings: input.savings,
                    investments: input.investments,
                    other: input.otherAssets,
                }
                const debts = {
                    mortgage: input.mortgage,
                    carLoan: input.carLoan,
                    creditCard: input.creditCard,
                    other: input.otherDebts,
                }
                const options = {
                    husbandRatio: input.husbandRatio,
                    wifeRatio: input.wifeRatio,
                    hasChildren: input.hasChildren,
                    childCustody: input.childCustody,
                }
                const result = calculateDivorceProperty(assets, debts, options)
                return JSON.stringify(result)
            },
            {
                name: 'calculate_divorce_property',
                description: '离婚财产分割计算：根据双方共同财产（房产、车辆、存款等）和共同债务，按照指定分割比例计算各方所得净资产及子女抚养费',
                schema,
            },
        ) as any,
}
