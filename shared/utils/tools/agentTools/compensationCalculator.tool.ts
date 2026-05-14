/**
 * 赔偿金计算 Agent 工具
 * 支持工伤赔偿、交通事故赔偿、死亡赔偿三种场景
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolModule, ToolContext } from '#shared/types/agentTools'
import {
    calculateWorkInjuryCompensation,
    calculateTrafficAccidentCompensation,
    calculateDeathCompensation,
} from '#shared/utils/tools/compensationService'

const schema = z.object({
    type: z.enum(['workInjury', 'trafficAccident', 'death']).describe(
        '赔偿类型：workInjury（工伤赔偿）、trafficAccident（交通事故赔偿）、death（死亡赔偿）'
    ),
    // 工伤赔偿参数
    salary: z.number().min(0).default(0).describe('月工资（元），工伤赔偿必填'),
    disabilityLevel: z.number().int().min(1).max(10).default(10).describe('伤残等级（1-10级），工伤赔偿必填'),
    medicalExpenses: z.number().min(0).default(0).describe('医疗费用（元）'),
    nursingExpenses: z.number().min(0).default(0).describe('护理费用（元）'),
    nutritionExpenses: z.number().min(0).default(0).describe('营养费用（元）'),
    // 交通事故赔偿参数
    disabilityCompensation: z.number().min(0).default(0).describe('伤残赔偿金（元），交通事故赔偿时填写'),
    lostIncome: z.number().min(0).default(0).describe('误工费（元），交通事故赔偿时填写'),
    transportationExpenses: z.number().min(0).default(0).describe('交通费（元），交通事故赔偿时填写'),
    accommodationExpenses: z.number().min(0).default(0).describe('住宿费（元），交通事故赔偿时填写'),
    propertyLoss: z.number().min(0).default(0).describe('财产损失（元），交通事故赔偿时填写'),
    // 死亡赔偿参数
    annualIncome: z.number().min(0).default(0).describe('年收入（元），死亡赔偿必填'),
    deathCompensationYears: z.number().int().min(1).max(20).default(20).describe('死亡赔偿金年限（年），默认20年，死亡赔偿场景适用'),
    funeralExpenses: z.number().min(0).default(0).describe('丧葬费（元），死亡赔偿时填写'),
    dependentCompensation: z.number().min(0).default(0).describe('被抚养人生活费（元），死亡赔偿时填写'),
    emotionalDamages: z.number().min(0).default(0).describe('精神损害赔偿金（元），死亡赔偿时填写'),
})

export const compensationCalculatorTool: ToolModule = {
    toolDefinition: {
        name: 'calculate_compensation',
        description: '赔偿金计算：支持工伤赔偿金（伤残补偿+医疗费）、交通事故赔偿金、死亡赔偿金三种场景，按照法定标准计算各项赔偿金额及汇总',
        schema,
    },
    createTool: (_ctx: ToolContext) =>
        tool(
            async (input) => {
                let result: unknown

                if (input.type === 'workInjury') {
                    result = calculateWorkInjuryCompensation(
                        input.salary,
                        input.disabilityLevel,
                        input.medicalExpenses,
                        input.nursingExpenses,
                        input.nutritionExpenses,
                    )
                } else if (input.type === 'trafficAccident') {
                    result = calculateTrafficAccidentCompensation(
                        input.medicalExpenses,
                        input.disabilityCompensation,
                        input.nursingExpenses,
                        input.lostIncome,
                        input.nutritionExpenses,
                        input.transportationExpenses,
                        input.accommodationExpenses,
                        input.propertyLoss,
                    )
                } else {
                    // death
                    result = calculateDeathCompensation(
                        input.annualIncome,
                        input.deathCompensationYears,
                        input.funeralExpenses,
                        input.dependentCompensation,
                        input.emotionalDamages,
                    )
                }

                return JSON.stringify(result)
            },
            {
                name: 'calculate_compensation',
                description: '赔偿金计算：支持工伤赔偿金（伤残补偿+医疗费）、交通事故赔偿金、死亡赔偿金三种场景，按照法定标准计算各项赔偿金额及汇总',
                schema,
            },
        ) as any,
}
