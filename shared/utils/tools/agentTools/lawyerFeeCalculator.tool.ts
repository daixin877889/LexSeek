/**
 * 律师费用计算 Agent 工具（交互式版本）
 *
 * 支持民事、刑事、行政、商事、法律咨询、文书制作六种案件类型。
 * 信息充足时直接计算并写入案件记忆；
 * 信息不足时通过 interrupt() 让用户在 inline 卡片补全参数。
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { consola as logger } from 'consola'
import { InterruptType } from '#shared/types/case'
import type { ToolContext, ToolDefinition } from '#shared/types/agentTools'
import { calculateLawyerFee } from '#shared/utils/tools/lawyerFeeService'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

const schema = z.object({
    caseType: z.enum(['civil', 'criminal', 'administrative', 'commercial', 'consultation', 'document']).describe(
        '案件类型：civil（民事）、criminal（刑事）、administrative（行政）、commercial（商事）、consultation（法律咨询）、document（文书制作）'
    ),
    disputeAmount: z.number().min(0).optional().describe('争议金额（元），民事/商事案件必填'),
    complexity: z.enum(['simple', 'medium', 'complex']).default('medium').describe('案件复杂程度：simple（简单）、medium（一般）、complex（复杂）'),
    region: z.enum(['tier1', 'tier2', 'tier3']).default('tier2').describe('地区档次：tier1（一线城市）、tier2（二线城市）、tier3（三线及以下城市）'),
    hasAppeal: z.boolean().default(false).describe('是否包含上诉阶段'),
    hasExecution: z.boolean().default(false).describe('是否包含执行阶段'),
    consultationHours: z.number().min(0).optional().describe('法律咨询小时数，caseType=consultation 时必填'),
    caseDuration: z.number().min(1).optional().describe('案件预计持续时间（月），caseType=criminal 时必填'),
    documentType: z.enum(['contract', 'lawsuit', 'opinion', 'will', 'corporate']).optional().describe(
        '文书类型，caseType=document 时必填：contract（合同）、lawsuit（起诉书）、opinion（法律意见书）、will（遗嘱）、corporate（公司章程）'
    ),
})

/** 各分支必填字段 */
const REQUIRED_FIELDS_BY_BRANCH: Record<string, string[]> = {
    civil: ['disputeAmount'],
    commercial: ['disputeAmount'],
    criminal: ['caseDuration'],
    consultation: ['consultationHours'],
    document: ['documentType'],
    administrative: [],
}

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'calculate_lawyer_fee',
    description:
        '律师费用计算：根据《律师服务收费管理办法》及地方律师协会指导标准，' +
        '按案件类型、争议金额、地区档次计算律师代理费参考区间，' +
        '支持民事、刑事、行政、商事、咨询等类型。必填字段缺失时通过 interrupt 让用户补全。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input) => {
        // ① L2 兜底：从案件记忆查上次同工具计算结果预填
        const memoryCalc = ctx.caseId
            ? await findLastCalculationByCase(ctx.caseId, 'calculate_lawyer_fee')
            : null
        let merged = { ...(memoryCalc?.input ?? {}), ...input } as Record<string, unknown>

        // ② 必填校验：按当前分支找缺失字段
        const required = REQUIRED_FIELDS_BY_BRANCH[merged.caseType as string] ?? []
        const missing = required.filter(
            (f) => merged[f] === undefined || merged[f] === null || merged[f] === '',
        )

        // ③ 信息不足 → interrupt
        if (missing.length > 0) {
            const resumed = interrupt({
                type: InterruptType.CALCULATOR_INPUT,
                toolName: 'calculate_lawyer_fee',
                prefilled: merged,
                missing,
            }) as unknown

            if (resumed === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumed || typeof resumed !== 'object') {
                throw new Error(`calculate_lawyer_fee: resume payload 非法 (${typeof resumed})`)
            }
            merged = { ...merged, ...(resumed as Record<string, unknown>) }
        }

        // ④ 调 service 算结果
        let result: Record<string, unknown>
        try {
            const options = {
                disputeAmount: (merged.disputeAmount as number) ?? 0,
                complexity: (merged.complexity as any) ?? 'medium',
                region: (merged.region as any) ?? 'tier2',
                hasAppeal: (merged.hasAppeal as boolean) ?? false,
                hasExecution: (merged.hasExecution as boolean) ?? false,
                consultationHours: (merged.consultationHours as number) ?? 0,
                caseDuration: (merged.caseDuration as number) ?? 1,
                documentType: merged.documentType as any,
            }
            result = calculateLawyerFee(merged.caseType as any, options) as unknown as Record<string, unknown>
        } catch (err) {
            logger.error('[calculate_lawyer_fee] 计算失败', err)
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
                text: `[计算] 律师费 · ${merged.caseType} · 参考费用 ${result.fee ?? '-'} 元`,
                subjectKey: 'calculation:calculate_lawyer_fee',
                source: 'manual',
                extraMetadata: {
                    calculation: {
                        tool: 'calculate_lawyer_fee',
                        input: merged,
                        output: result,
                        calculatedAt: new Date().toISOString(),
                    },
                },
            }).catch((err: Error) => {
                logger.error('[calculate_lawyer_fee] 写入案件记忆失败（不阻塞结果）', err)
            })
        }

        return JSON.stringify(result)
    }, toolDefinition)
}
