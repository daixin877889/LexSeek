/**
 * 法律日期计算 Agent 工具（交互式版本）
 *
 * 支持加减天数/月数/年数、工作日统计、法定期限截止日、诉讼时效计算六种模式。
 * 信息充足时直接计算并写入案件记忆；
 * 信息不足时通过 interrupt() 让用户在 inline 卡片补全参数。
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { consola as logger } from 'consola'
import { InterruptType } from '#shared/types/case'
import type { ToolContext, ToolDefinition } from '#shared/types/agentTools'
import {
    calculateDateAfterDays,
    calculateDateAfterMonths,
    calculateDateAfterYears,
    calculateWorkingDays,
    calculateLegalDeadline,
    calculateLimitationPeriod,
} from '#shared/utils/tools/dateCalculatorService'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

const schema = z.object({
    mode: z.enum(['addDays', 'addMonths', 'addYears', 'workingDays', 'legalDeadline', 'limitation']).describe(
        '计算模式：addDays（加减天数）、addMonths（加减月数）、addYears（加减年数）、workingDays（两日期间工作日天数）、legalDeadline（法定期限截止日）、limitation（诉讼时效期限）'
    ),
    startDate: z.string().optional().describe('起始日期，格式 YYYY-MM-DD，必填'),
    endDate: z.string().optional().describe('结束日期，格式 YYYY-MM-DD，mode=workingDays 时必填'),
    days: z.number().int().optional().describe('天数（可为负数表示向前），mode=addDays / legalDeadline 时必填'),
    months: z.number().int().optional().describe('月数（可为负数），mode=addMonths 时必填'),
    years: z.number().int().optional().describe('年数（可为负数），mode=addYears 时必填'),
    excludeHolidays: z.boolean().default(true).describe('是否排除节假日，mode=legalDeadline 时生效，默认 true'),
    limitationType: z.enum(['general', 'contract', 'personal']).default('general').describe(
        '诉讼时效类型，mode=limitation 时生效：general（一般民事3年）、contract（合同纠纷3年）、personal（人身伤害1年）'
    ),
})

/** 各分支必填字段 */
const REQUIRED_FIELDS_BY_BRANCH: Record<string, string[]> = {
    addDays: ['startDate', 'days'],
    addMonths: ['startDate', 'months'],
    addYears: ['startDate', 'years'],
    workingDays: ['startDate', 'endDate'],
    legalDeadline: ['startDate', 'days'],
    limitation: ['startDate'],
}

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'calculate_date',
    description:
        '法律日期计算：支持从起始日期加减天数/月数/年数推算目标日期、计算两日期间工作日天数、' +
        '计算法定期限截止日、计算诉讼时效到期日，适用于起诉期限、合同履行期、证据保全期等场景。' +
        '必填字段缺失时通过 interrupt 让用户补全。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input, cfg) => {
        // ① L2 兜底：从案件记忆查上次同工具计算结果预填
        const memoryCalc = ctx.caseId
            ? await findLastCalculationByCase(ctx.caseId, 'calculate_date')
            : null
        let merged = { ...(memoryCalc?.input ?? {}), ...input } as Record<string, unknown>

        // ② 必填校验：按当前分支找缺失字段
        const required = REQUIRED_FIELDS_BY_BRANCH[merged.mode as string] ?? []
        const missing = required.filter(
            (f) => merged[f] === undefined || merged[f] === null || merged[f] === '',
        )

        // ③ 信息不足 → interrupt
        if (missing.length > 0) {
            const resumed = interrupt({
                toolCallId: (cfg as any)?.toolCall?.id ?? "",
                type: InterruptType.CALCULATOR_INPUT,
                toolName: 'calculate_date',
                prefilled: merged,
                missing,
            }) as unknown

            if (resumed === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumed || typeof resumed !== 'object') {
                throw new Error(`calculate_date: resume payload 非法 (${typeof resumed})`)
            }
            merged = { ...merged, ...(resumed as Record<string, unknown>) }
        }

        // ④ 调 service 算结果
        let result: unknown
        try {
            switch (merged.mode) {
                case 'addDays':
                    result = calculateDateAfterDays(merged.startDate as string, merged.days as number)
                    break
                case 'addMonths':
                    result = calculateDateAfterMonths(merged.startDate as string, merged.months as number)
                    break
                case 'addYears':
                    result = calculateDateAfterYears(merged.startDate as string, merged.years as number)
                    break
                case 'workingDays':
                    result = calculateWorkingDays(merged.startDate as string, (merged.endDate as string) ?? merged.startDate as string)
                    break
                case 'legalDeadline':
                    result = calculateLegalDeadline(
                        merged.startDate as string,
                        merged.days as number,
                        (merged.excludeHolidays as boolean) ?? true,
                    )
                    break
                case 'limitation':
                    result = calculateLimitationPeriod(
                        merged.startDate as string,
                        (merged.limitationType as any) ?? 'general',
                    )
                    break
                default:
                    result = { error: '未知的计算模式' }
            }
        } catch (err) {
            logger.error('[calculate_date] 计算失败', err)
            return JSON.stringify({
                error: '计算失败，请检查输入参数',
                message: (err as Error).message,
            })
        }

        const resultObj = result as Record<string, unknown>

        // ⑤ 写入案件记忆（失败不阻塞结果返回）
        if (ctx.caseId) {
            writeMemoryService({
                caseId: ctx.caseId,
                kind: 'calculation',
                text: `[计算] 法律日期 · ${merged.mode} · 结果 ${resultObj.resultDate ?? resultObj.workingDays ?? '-'}`,
                subjectKey: 'calculation:calculate_date',
                source: 'manual',
                extraMetadata: {
                    calculation: {
                        tool: 'calculate_date',
                        input: merged,
                        output: result as Record<string, unknown>,
                        calculatedAt: new Date().toISOString(),
                    },
                },
            }).catch((err: Error) => {
                logger.error('[calculate_date] 写入案件记忆失败（不阻塞结果）', err)
            })
        }

        return JSON.stringify(result)
    }, toolDefinition)
}
