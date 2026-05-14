/**
 * 加班费计算 Agent 工具（交互式版本）
 *
 * 信息充足时直接计算并写入案件记忆；
 * 信息不足时通过 interrupt() 让用户在 inline 卡片补全参数。
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { consola as logger } from 'consola'
import { InterruptType } from '#shared/types/case'
import type { ToolContext, ToolDefinition } from '#shared/types/agentTools'
import { calculateOvertimePay } from '#shared/utils/tools/overtimePayService'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

const schema = z.object({
    baseSalary: z.number().positive().optional().describe('月基本工资（元），必填'),
    workdayOvertimeHours: z.number().min(0).default(0).describe('工作日加班时间（小时）'),
    weekendOvertimeHours: z.number().min(0).default(0).describe('休息日加班时间（小时）'),
    holidayOvertimeHours: z.number().min(0).default(0).describe('法定节假日加班时间（小时）'),
    workdaysPerMonth: z.number().positive().default(21.75).describe('月工作日天数，默认21.75天'),
    hoursPerDay: z.number().positive().default(8).describe('每天工作时间（小时），默认8小时'),
})

const REQUIRED_FIELDS = ['baseSalary']

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'calculate_overtime_pay',
    description: '加班费计算：依据《劳动法》规定，按工作日（1.5倍）、休息日（2倍）、法定节假日（3倍）分别计算加班报酬，自动按小时工资换算。必填字段缺失时通过 interrupt 让用户补全。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input) => {
        // ① L2 兜底：从案件记忆查上次同工具计算结果预填
        const memoryCalc = ctx.caseId
            ? await findLastCalculationByCase(ctx.caseId, 'calculate_overtime_pay')
            : null
        let merged = { ...(memoryCalc?.input ?? {}), ...input } as Record<string, unknown>

        // ② 必填校验
        const missing = REQUIRED_FIELDS.filter(
            (f) => merged[f] === undefined || merged[f] === null || merged[f] === '',
        )

        // ③ 信息不足 → interrupt
        if (missing.length > 0) {
            const resumed = interrupt({
                type: InterruptType.CALCULATOR_INPUT,
                toolName: 'calculate_overtime_pay',
                prefilled: merged,
                missing,
            }) as unknown

            if (resumed === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumed || typeof resumed !== 'object') {
                throw new Error(`calculate_overtime_pay: resume payload 非法 (${typeof resumed})`)
            }
            merged = { ...merged, ...(resumed as Record<string, unknown>) }
        }

        // ④ 调 service 算结果
        let result: Record<string, unknown>
        try {
            result = calculateOvertimePay(
                merged.baseSalary as number,
                (merged.workdayOvertimeHours as number) ?? 0,
                (merged.weekendOvertimeHours as number) ?? 0,
                (merged.holidayOvertimeHours as number) ?? 0,
                (merged.workdaysPerMonth as number) ?? 21.75,
                (merged.hoursPerDay as number) ?? 8,
            ) as unknown as Record<string, unknown>
        } catch (err) {
            logger.error('[calculate_overtime_pay] 计算失败', err)
            return JSON.stringify({
                error: '计算失败，请检查输入参数',
                message: (err as Error).message,
            })
        }

        // ⑤ 写入案件记忆（失败不阻塞结果返回）
        if (ctx.caseId) {
            writeMemoryService({
                caseId: ctx.caseId,
                kind: 'calculation',
                text: `[计算] 加班费 · 总额 ${result.totalOvertimePay ?? '-'} 元`,
                subjectKey: 'calculation:calculate_overtime_pay',
                source: 'manual',
                extraMetadata: {
                    calculation: {
                        tool: 'calculate_overtime_pay',
                        input: merged,
                        output: result,
                        calculatedAt: new Date().toISOString(),
                    },
                },
            }).catch((err: Error) => {
                logger.error('[calculate_overtime_pay] 写入案件记忆失败（不阻塞结果）', err)
            })
        }

        return JSON.stringify(result)
    }, toolDefinition)
}
