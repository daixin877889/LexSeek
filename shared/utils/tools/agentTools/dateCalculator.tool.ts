/**
 * 法律日期计算 Agent 工具
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolModule, ToolContext } from '#shared/types/agentTools'
import {
    calculateDateAfterDays,
    calculateDateAfterMonths,
    calculateDateAfterYears,
    calculateWorkingDays,
    calculateLegalDeadline,
    calculateLimitationPeriod,
} from '#shared/utils/tools/dateCalculatorService'

const schema = z.object({
    mode: z.enum(['addDays', 'addMonths', 'addYears', 'workingDays', 'legalDeadline', 'limitation']).describe(
        '计算模式：addDays（加减天数）、addMonths（加减月数）、addYears（加减年数）、workingDays（两日期间工作日天数）、legalDeadline（法定期限截止日）、limitation（诉讼时效期限）'
    ),
    startDate: z.string().describe('起始日期，格式 YYYY-MM-DD'),
    endDate: z.string().optional().describe('结束日期，格式 YYYY-MM-DD，mode=workingDays 时必填'),
    days: z.number().int().optional().describe('天数（可为负数表示向前），mode=addDays / legalDeadline 时必填'),
    months: z.number().int().optional().describe('月数（可为负数），mode=addMonths 时必填'),
    years: z.number().int().optional().describe('年数（可为负数），mode=addYears 时必填'),
    excludeHolidays: z.boolean().default(true).describe('是否排除节假日，mode=legalDeadline 时生效，默认 true'),
    limitationType: z.enum(['general', 'contract', 'personal']).default('general').describe(
        '诉讼时效类型，mode=limitation 时生效：general（一般民事3年）、contract（合同纠纷3年）、personal（人身伤害1年）'
    ),
})

export const dateCalculatorTool: ToolModule = {
    toolDefinition: {
        name: 'calculate_date',
        description: '法律日期计算：支持从起始日期加减天数/月数/年数推算目标日期、计算两日期间工作日天数、计算法定期限截止日、计算诉讼时效到期日，适用于起诉期限、合同履行期、证据保全期等场景',
        schema,
    },
    createTool: (_ctx: ToolContext) =>
        tool(
            async (input) => {
                let result: unknown

                switch (input.mode) {
                    case 'addDays':
                        result = calculateDateAfterDays(input.startDate, input.days ?? 0)
                        break
                    case 'addMonths':
                        result = calculateDateAfterMonths(input.startDate, input.months ?? 0)
                        break
                    case 'addYears':
                        result = calculateDateAfterYears(input.startDate, input.years ?? 0)
                        break
                    case 'workingDays':
                        result = calculateWorkingDays(input.startDate, input.endDate ?? input.startDate)
                        break
                    case 'legalDeadline':
                        result = calculateLegalDeadline(input.startDate, input.days ?? 0, input.excludeHolidays)
                        break
                    case 'limitation':
                        result = calculateLimitationPeriod(input.startDate, input.limitationType)
                        break
                    default:
                        result = { error: '未知的计算模式' }
                }

                return JSON.stringify(result)
            },
            {
                name: 'calculate_date',
                description: '法律日期计算：支持从起始日期加减天数/月数/年数推算目标日期、计算两日期间工作日天数、计算法定期限截止日、计算诉讼时效到期日，适用于起诉期限、合同履行期、证据保全期等场景',
                schema,
            },
        ) as any,
}
