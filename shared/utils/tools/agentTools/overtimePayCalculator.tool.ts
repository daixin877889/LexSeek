/**
 * 加班费计算 Agent 工具
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolModule, ToolContext } from '#shared/types/agentTools'
import { calculateOvertimePay } from '#shared/utils/tools/overtimePayService'

const schema = z.object({
    baseSalary: z.number().positive().describe('月基本工资（元）'),
    workdayOvertimeHours: z.number().min(0).default(0).describe('工作日加班时间（小时）'),
    weekendOvertimeHours: z.number().min(0).default(0).describe('休息日加班时间（小时）'),
    holidayOvertimeHours: z.number().min(0).default(0).describe('法定节假日加班时间（小时）'),
    workdaysPerMonth: z.number().positive().default(21.75).describe('月工作日天数，默认21.75天'),
    hoursPerDay: z.number().positive().default(8).describe('每天工作时间（小时），默认8小时'),
})

export const overtimePayCalculatorTool: ToolModule = {
    toolDefinition: {
        name: 'calculate_overtime_pay',
        description: '加班费计算：依据《劳动法》规定，按工作日（1.5倍）、休息日（2倍）、法定节假日（3倍）分别计算加班报酬，自动按小时工资换算',
        schema,
    },
    createTool: (_ctx: ToolContext) =>
        tool(
            async (input) => {
                const result = calculateOvertimePay(
                    input.baseSalary,
                    input.workdayOvertimeHours,
                    input.weekendOvertimeHours,
                    input.holidayOvertimeHours,
                    input.workdaysPerMonth,
                    input.hoursPerDay,
                )
                return JSON.stringify(result)
            },
            {
                name: 'calculate_overtime_pay',
                description: '加班费计算：依据《劳动法》规定，按工作日（1.5倍）、休息日（2倍）、法定节假日（3倍）分别计算加班报酬，自动按小时工资换算',
                schema,
            },
        ) as any,
}
