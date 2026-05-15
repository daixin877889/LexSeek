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
    yearDays: z.enum(['365', '360']).optional().describe('年计息天数，可选；365 为日历年（默认），360 为商业惯例（按月 30 天）'),
})

const REQUIRED_FIELDS = ['amount', 'startDate', 'endDate']

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'calculate_delay_interest',
    description: '迟延履行利息计算：根据判决确定的本金、迟延期间起止日期，依据司法解释规则（2019年8月20日前用央行基准利率1.5倍，之后用LPR 4倍）计算迟延履行利息。数值参数（金额、时长、数量、档位枚举等）必须由用户在自然语言里明确告知；用户未告知时该字段必须留空，工具会自动弹 inline 卡片让用户补全；严禁猜测、估算或套用默认值。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input, cfg) => {
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
            const resumedRaw = interrupt({
                toolCallId: (cfg as any)?.toolCall?.id ?? "",
                type: InterruptType.CALCULATOR_INPUT,
                toolName: 'calculate_delay_interest',
                prefilled: merged,
                missing,
            }) as unknown

            if (resumedRaw === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumedRaw || typeof resumedRaw !== 'object') {
                throw new Error(`calculate_delay_interest: resume payload 非法 (${typeof resumedRaw})`)
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
            result = calculateDelayInterest(
                merged.amount as number,
                merged.startDate as string,
                merged.endDate as string,
                merged.yearDays as string | undefined,
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

        return JSON.stringify({ ...merged, ...(result as Record<string, unknown>) })
    }, toolDefinition)
}
