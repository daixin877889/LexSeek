/**
 * 利息计算 Agent 工具（交互式版本）
 *
 * 支持 LPR / 央行基准 / 自定义年化利率三种模式。
 * 信息充足时直接计算并写入案件记忆；
 * 信息不足时通过 interrupt() 让用户在 inline 卡片补全参数。
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { consola as logger } from 'consola'
import { InterruptType } from '#shared/types/case'
import type { AdjustmentMethod } from '#shared/types/tools'
import type { ToolContext, ToolDefinition } from '#shared/types/agentTools'
import {
    calculateLPRInterest,
    calculatePBOCInterest,
    calculateSimpleInterest,
    calculateAutoSegmentInterest,
} from '#shared/utils/tools/interestService'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

const schema = z.object({
    mode: z.enum(['lpr', 'pboc', 'simple', 'auto']).describe(
        '计算模式：lpr（LPR贷款市场报价利率）、pboc（央行基准利率）、simple（简单年化利率）、auto（基准利率与 LPR 自动分段，以 2019-08-20 LPR 实施日为分界）'
    ),
    amount: z.number().positive().optional().describe('本金金额（元），必填'),
    startDate: z.string().optional().describe('计息开始日期，格式 YYYY-MM-DD，必填'),
    endDate: z.string().optional().describe('计息结束日期，格式 YYYY-MM-DD，必填'),
    annualRate: z.number().min(0).optional().describe('年化利率（%），mode=simple 时必填，其他模式忽略'),
    adjustmentMethod: z.enum(['无', '上浮', '下浮', '倍率', '倍数', '加点', '减点']).optional().describe(
        '利率调整方式：无（直接用基准利率）、倍率（乘以指定倍数）、加点（加上浮动点数）等；用户未明示时留空'
    ),
    adjustmentValue: z.number().optional().describe('调整值：倍率时填倍数（如 1.5），加点时填点数；用户未明示时留空'),
    lprPeriod: z.number().int().min(1).max(2).optional().describe('LPR 期限档：1=一年期，2=五年期以上；mode=lpr 或 auto 时使用，用户未明示时留空'),
    pbocPeriod: z.number().int().min(1).max(5).optional().describe('央行基准贷款期限档：1=六个月以内, 2=六个月至一年, 3=一至三年, 4=三至五年, 5=五年以上；mode=pboc 或 auto 时使用，用户未明示时留空'),
    yearDays: z.enum(['365', '360']).optional().describe('年计息天数，可选；365 为日历年，360 为商业惯例（按月 30 天）；用户未明示时留空'),
})

/** 各分支必填字段（均需显式传入，不能缺省） */
const REQUIRED_FIELDS_BY_BRANCH: Record<string, string[]> = {
    lpr: ['amount', 'startDate', 'endDate', 'lprPeriod'],
    pboc: ['amount', 'startDate', 'endDate', 'pbocPeriod'],
    simple: ['amount', 'startDate', 'endDate', 'annualRate'],
    auto: ['amount', 'startDate', 'endDate', 'lprPeriod', 'pbocPeriod'],
}

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'calculate_interest',
    description:
        '利息计算：支持 LPR 贷款市场报价利率利息、央行基准利率利息、自定义年化利率利息三种模式，' +
        '可设置利率倍数，适用于合同违约金、借款利息等场景。数值参数（金额、时长、数量、档位枚举等）必须由用户在自然语言里明确告知；用户未告知时该字段必须留空，工具会自动弹 inline 卡片让用户补全；严禁猜测、估算或套用默认值。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input, cfg) => {
        // ① L2 兜底：从案件记忆查上次同工具计算结果预填
        const memoryCalc = ctx.caseId
            ? await findLastCalculationByCase(ctx.caseId, 'calculate_interest')
            : null
        let merged = { ...(memoryCalc?.input ?? {}), ...input } as Record<string, unknown>

        // ② 必填校验：按当前分支找缺失字段
        const required = REQUIRED_FIELDS_BY_BRANCH[merged.mode as string] ?? []
        const missing = required.filter(
            (f) => merged[f] === undefined || merged[f] === null || merged[f] === '',
        )

        // ③ 信息不足 → interrupt（防御性校验：null=取消，非 object 抛错）
        if (missing.length > 0) {
            const resumedRaw = interrupt({
                toolCallId: (cfg as any)?.toolCall?.id ?? "",
                type: InterruptType.CALCULATOR_INPUT,
                toolName: 'calculate_interest',
                prefilled: merged,
                missing,
            }) as unknown

            if (resumedRaw === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumedRaw || typeof resumedRaw !== 'object') {
                throw new Error(`calculate_interest: resume payload 非法 (${typeof resumedRaw})`)
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
            const yd = merged.yearDays as string | undefined
            if (merged.mode === 'lpr') {
                result = calculateLPRInterest(
                    merged.amount as number,
                    merged.startDate as string,
                    merged.endDate as string,
                    (merged.lprPeriod as number) ?? 1,
                    ((merged.adjustmentMethod as AdjustmentMethod) ?? '无') as AdjustmentMethod,
                    (merged.adjustmentValue as number) ?? 0,
                    yd ?? 360,
                ) as unknown as Record<string, unknown>
            } else if (merged.mode === 'pboc') {
                result = calculatePBOCInterest(
                    merged.amount as number,
                    merged.startDate as string,
                    merged.endDate as string,
                    (merged.pbocPeriod as number) ?? 2,
                    ((merged.adjustmentMethod as AdjustmentMethod) ?? '无') as AdjustmentMethod,
                    (merged.adjustmentValue as number) ?? 0,
                    yd ?? 360,
                ) as unknown as Record<string, unknown>
            } else if (merged.mode === 'auto') {
                result = calculateAutoSegmentInterest(
                    merged.amount as number,
                    merged.startDate as string,
                    merged.endDate as string,
                    (merged.lprPeriod as number) ?? 1,
                    (merged.pbocPeriod as number) ?? 2,
                    ((merged.adjustmentMethod as AdjustmentMethod) ?? '无') as AdjustmentMethod,
                    (merged.adjustmentValue as number) ?? 0,
                    yd ?? 360,
                ) as unknown as Record<string, unknown>
            } else {
                result = calculateSimpleInterest(
                    merged.amount as number,
                    (merged.annualRate as number) ?? 0,
                    merged.startDate as string,
                    merged.endDate as string,
                ) as unknown as Record<string, unknown>
            }
        } catch (err) {
            logger.error('[calculate_interest] 计算失败', err)
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
                text: `[计算] 利息 · ${merged.mode} 模式 · 利息 ${result.totalInterest ?? '-'} 元`,
                subjectKey: 'calculation:calculate_interest',
                source: 'manual',
                extraMetadata: {
                    calculation: {
                        tool: 'calculate_interest',
                        input: merged,
                        output: result,
                        calculatedAt: new Date().toISOString(),
                    },
                },
            }).catch((err: Error) => {
                logger.error('[calculate_interest] 写入案件记忆失败（不阻塞结果）', err)
            })
        }

        return JSON.stringify({ ...merged, ...(result as Record<string, unknown>) })
    }, toolDefinition)
}
