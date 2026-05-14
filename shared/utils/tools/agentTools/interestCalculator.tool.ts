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
} from '#shared/utils/tools/interestService'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

const schema = z.object({
    mode: z.enum(['lpr', 'pboc', 'simple']).describe(
        '计算模式：lpr（LPR贷款市场报价利率）、pboc（央行基准利率）、simple（简单年化利率）'
    ),
    amount: z.number().positive().optional().describe('本金金额（元），必填'),
    startDate: z.string().optional().describe('计息开始日期，格式 YYYY-MM-DD，必填'),
    endDate: z.string().optional().describe('计息结束日期，格式 YYYY-MM-DD，必填'),
    annualRate: z.number().min(0).optional().describe('年化利率（%），mode=simple 时必填，其他模式忽略'),
    adjustmentMethod: z.enum(['无', '上浮', '下浮', '倍率', '倍数', '加点', '减点']).default('无').describe(
        '利率调整方式：无（直接用基准利率）、倍率（乘以指定倍数）、加点（加上浮动点数）等'
    ),
    adjustmentValue: z.number().default(0).describe('调整值：倍率时填倍数（如 1.5），加点时填点数，无时填 0'),
    lprPeriod: z.number().int().min(1).max(2).default(1).describe('LPR 期限档：1=一年期，2=五年期以上，仅 mode=lpr 时生效'),
    pbocPeriod: z.number().int().min(1).max(5).default(2).describe('央行基准贷款期限档：1=六个月以内, 2=六个月至一年, 3=一至三年, 4=三至五年, 5=五年以上，仅 mode=pboc 时生效'),
})

/** 各分支必填字段（均需显式传入，不能缺省） */
const REQUIRED_FIELDS_BY_BRANCH: Record<string, string[]> = {
    lpr: ['amount', 'startDate', 'endDate'],
    pboc: ['amount', 'startDate', 'endDate'],
    simple: ['amount', 'startDate', 'endDate', 'annualRate'],
}

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'calculate_interest',
    description:
        '利息计算：支持 LPR 贷款市场报价利率利息、央行基准利率利息、自定义年化利率利息三种模式，' +
        '可设置利率倍数，适用于合同违约金、借款利息等场景。必填字段缺失时通过 interrupt 让用户补全。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input) => {
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
            const resumed = interrupt({
                type: InterruptType.CALCULATOR_INPUT,
                toolName: 'calculate_interest',
                prefilled: merged,
                missing,
            }) as unknown

            if (resumed === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumed || typeof resumed !== 'object') {
                throw new Error(`calculate_interest: resume payload 非法 (${typeof resumed})`)
            }
            merged = { ...merged, ...(resumed as Record<string, unknown>) }
        }

        // ④ 调 service 算结果
        let result: Record<string, unknown>
        try {
            if (merged.mode === 'lpr') {
                result = calculateLPRInterest(
                    merged.amount as number,
                    merged.startDate as string,
                    merged.endDate as string,
                    (merged.lprPeriod as number) ?? 1,
                    ((merged.adjustmentMethod as AdjustmentMethod) ?? '无') as AdjustmentMethod,
                    (merged.adjustmentValue as number) ?? 0,
                ) as unknown as Record<string, unknown>
            } else if (merged.mode === 'pboc') {
                result = calculatePBOCInterest(
                    merged.amount as number,
                    merged.startDate as string,
                    merged.endDate as string,
                    (merged.pbocPeriod as number) ?? 2,
                    ((merged.adjustmentMethod as AdjustmentMethod) ?? '无') as AdjustmentMethod,
                    (merged.adjustmentValue as number) ?? 0,
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

        return JSON.stringify(result)
    }, toolDefinition)
}
