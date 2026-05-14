/**
 * 迟延履行利息计算 Agent 工具（交互式版本）
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
import { calculateDelayInterest } from '#shared/utils/tools/delayInterestService'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

const schema = z.object({
    amount: z.number().positive().optional().describe('本金金额（元），必填'),
    startDate: z.string().optional().describe('迟延履行开始日期，格式 YYYY-MM-DD，必填'),
    endDate: z.string().optional().describe('迟延履行结束日期，格式 YYYY-MM-DD，必填'),
})

const REQUIRED_FIELDS = ['amount', 'startDate', 'endDate']

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'calculate_delay_interest',
    description: '迟延履行利息计算：根据判决确定的本金、迟延期间起止日期，依据司法解释规则（2019年8月20日前用央行基准利率1.5倍，之后用LPR 4倍）计算迟延履行利息。必填字段缺失时通过 interrupt 让用户补全。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input) => {
        // ① L2 兜底：从案件记忆查上次同工具计算结果预填
        const memoryCalc = ctx.caseId
            ? await findLastCalculationByCase(ctx.caseId, 'calculate_delay_interest')
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
                toolName: 'calculate_delay_interest',
                prefilled: merged,
                missing,
            }) as unknown

            if (resumed === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumed || typeof resumed !== 'object') {
                throw new Error(`calculate_delay_interest: resume payload 非法 (${typeof resumed})`)
            }
            merged = { ...merged, ...(resumed as Record<string, unknown>) }
        }

        // ④ 调 service 算结果
        let result: Record<string, unknown>
        try {
            result = calculateDelayInterest(
                merged.amount as number,
                merged.startDate as string,
                merged.endDate as string,
            ) as unknown as Record<string, unknown>
        } catch (err) {
            logger.error('[calculate_delay_interest] 计算失败', err)
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
                text: `[计算] 迟延履行利息 · 总额 ${result.totalInterest ?? '-'} 元`,
                subjectKey: 'calculation:calculate_delay_interest',
                source: 'manual',
                extraMetadata: {
                    calculation: {
                        tool: 'calculate_delay_interest',
                        input: merged,
                        output: result,
                        calculatedAt: new Date().toISOString(),
                    },
                },
            }).catch((err: Error) => {
                logger.error('[calculate_delay_interest] 写入案件记忆失败（不阻塞结果）', err)
            })
        }

        return JSON.stringify(result)
    }, toolDefinition)
}
