/**
 * 社保追缴计算 Agent 工具
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolModule, ToolContext } from '#shared/types/agentTools'
import { calculateSocialInsuranceBackpay } from '#shared/utils/tools/socialInsuranceService'

const schema = z.object({
    monthlySalary: z.number().positive().describe('月工资基数（元）'),
    months: z.number().int().positive().describe('追缴月数'),
    includeEmployerPart: z.boolean().default(true).describe('是否包含单位缴纳部分，默认 true（包含）'),
    pensionEmployee: z.number().min(0).optional().describe('养老保险个人缴费比例（小数，如0.08表示8%），留空使用法定默认值'),
    pensionEmployer: z.number().min(0).optional().describe('养老保险单位缴费比例（小数），留空使用法定默认值'),
    medicalEmployee: z.number().min(0).optional().describe('医疗保险个人缴费比例（小数），留空使用法定默认值'),
    medicalEmployer: z.number().min(0).optional().describe('医疗保险单位缴费比例（小数），留空使用法定默认值'),
    housingEmployee: z.number().min(0).optional().describe('住房公积金个人缴存比例（小数），留空使用法定默认值'),
    housingEmployer: z.number().min(0).optional().describe('住房公积金单位缴存比例（小数），留空使用法定默认值'),
})

export const socialInsuranceCalculatorTool: ToolModule = {
    toolDefinition: {
        name: 'calculate_social_insurance_backpay',
        description: '社保追缴计算：根据月工资基数和追缴月数，计算养老保险、医疗保险、失业保险、工伤保险、生育保险、住房公积金的个人及单位应缴金额汇总，适用于劳动争议社保补缴场景',
        schema,
    },
    createTool: (_ctx: ToolContext) =>
        tool(
            async (input) => {
                const rates: Record<string, unknown> = {}

                if (input.pensionEmployee !== undefined || input.pensionEmployer !== undefined) {
                    rates['pension'] = {
                        employee: input.pensionEmployee,
                        employer: input.pensionEmployer,
                    }
                }
                if (input.medicalEmployee !== undefined || input.medicalEmployer !== undefined) {
                    rates['medical'] = {
                        employee: input.medicalEmployee,
                        employer: input.medicalEmployer,
                    }
                }
                if (input.housingEmployee !== undefined || input.housingEmployer !== undefined) {
                    rates['housing'] = {
                        employee: input.housingEmployee,
                        employer: input.housingEmployer,
                    }
                }

                const result = calculateSocialInsuranceBackpay(
                    input.monthlySalary,
                    input.months,
                    rates as any,
                    input.includeEmployerPart,
                )
                return JSON.stringify(result)
            },
            {
                name: 'calculate_social_insurance_backpay',
                description: '社保追缴计算：根据月工资基数和追缴月数，计算养老保险、医疗保险、失业保险、工伤保险、生育保险、住房公积金的个人及单位应缴金额汇总，适用于劳动争议社保补缴场景',
                schema,
            },
        ) as any,
}
