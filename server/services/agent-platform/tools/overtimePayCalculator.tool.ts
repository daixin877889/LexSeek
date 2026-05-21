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
    workdayOvertimeHours: z.number().min(0).optional().describe('工作日加班时间（小时）'),
    weekendOvertimeHours: z.number().min(0).optional().describe('休息日加班时间（小时）'),
    holidayOvertimeHours: z.number().min(0).optional().describe('法定节假日加班时间（小时）'),
    workdaysPerMonth: z.number().positive().default(21.75).describe('月工作日天数，默认21.75天'),
    hoursPerDay: z.number().positive().default(8).describe('每天工作时间（小时），默认8小时'),
})

const REQUIRED_FIELDS = ['baseSalary']

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'calculate_overtime_pay',
    description: '加班费计算：依据《劳动法》规定，按工作日（1.5倍）、休息日（2倍）、法定节假日（3倍）分别计算加班报酬，自动按小时工资换算。数值参数（金额、时长、数量、档位枚举等）必须由用户在自然语言里明确告知；用户未告知时该字段必须留空，工具会自动弹 inline 卡片让用户补全；严禁猜测、估算或套用默认值。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input, cfg) => {
        // ① L2 兜底：从案件记忆查上次同工具计算结果预填
        const memoryCalc = ctx.caseId
            ? await findLastCalculationByCase(ctx.caseId, 'calculate_overtime_pay')
            : null
        let merged = { ...(memoryCalc?.input ?? {}), ...input } as Record<string, unknown>

        // ② 必填校验：baseSalary 必填；至少要有一种加班小时数
        const missing = REQUIRED_FIELDS.filter(
            (f) => merged[f] === undefined || merged[f] === null || merged[f] === '',
        )
        const hasAnyOvertimeHours =
            (merged.workdayOvertimeHours as number) > 0 ||
            (merged.weekendOvertimeHours as number) > 0 ||
            (merged.holidayOvertimeHours as number) > 0
        if (!hasAnyOvertimeHours) {
            missing.push('overtimeHours')
        }

        // ③ 信息不足 → interrupt
        if (missing.length > 0) {
            const resumedRaw = interrupt({
                toolCallId: (cfg as any)?.toolCall?.id ?? "",
                type: InterruptType.CALCULATOR_INPUT,
                toolName: 'calculate_overtime_pay',
                prefilled: merged,
                missing,
            }) as unknown

            if (resumedRaw === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumedRaw || typeof resumedRaw !== 'object') {
                throw new Error(`calculate_overtime_pay: resume payload 非法 (${typeof resumedRaw})`)
            }
            // LangGraph Command resume payload 形如 { resume: { [toolCallId]: realValue } } 双层包装；
            // 与 reviewContract.tool.ts 对齐做两层 unwrap，缺一层会导致 merged.* 全部 undefined。
            const tcId = (cfg as any)?.toolCall?.id ?? ''
            const layer1 = (resumedRaw as { resume?: unknown }).resume ?? resumedRaw
            const resumed = (layer1 && typeof layer1 === 'object' && tcId && tcId in (layer1 as Record<string, unknown>)
                ? (layer1 as Record<string, unknown>)[tcId]
                : layer1) as Record<string, unknown> | null
            if (resumed === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumed || typeof resumed !== 'object') {
                throw new Error(`resume payload 解包后非对象 (${typeof resumed})`)
            }
            merged = { ...merged, ...resumed }
        }

        // ④ 调 service 算结果
        let result: Record<string, unknown>
        try {
            result = calculateOvertimePay(
                merged.baseSalary as number,
                typeof merged.workdayOvertimeHours === 'number' ? merged.workdayOvertimeHours : 0,
                typeof merged.weekendOvertimeHours === 'number' ? merged.weekendOvertimeHours : 0,
                typeof merged.holidayOvertimeHours === 'number' ? merged.holidayOvertimeHours : 0,
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

        return JSON.stringify({ ...merged, ...(result as Record<string, unknown>) })
    }, toolDefinition)
}
