/**
 * 诉讼费用计算 Agent 工具（交互式版本）
 *
 * 支持受理费（caseFee）、申请费（applicationFee）两种类型。
 * 受理费含嵌套 nonPropertyType 校验逻辑：
 *   caseFee 时 nonPropertyType 必填；nonPropertyType='property' 时 amount 必填。
 * 信息充足时直接计算并写入案件记忆；
 * 信息不足时通过 interrupt() 让用户在 inline 卡片补全参数。
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { consola as logger } from 'consola'
import { InterruptType } from '#shared/types/case'
import type { ToolContext, ToolDefinition } from '#shared/types/agentTools'
import { calculateCourtFee } from '#shared/utils/tools/courtFeeService'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

const schema = z.object({
    feeTypeLevel1: z.enum(['caseFee', 'applicationFee']).describe(
        '费用一级类型：caseFee（受理费）、applicationFee（申请费）'
    ),
    feeTypeLevel2: z.string().optional().describe(
        '费用二级类型。受理费可填：property/nonProperty/intellectual/maritime/administrative/appeal/small；' +
        '申请费可填：preservation/execution/arbitration'
    ),
    amount: z.number().min(0).optional().describe('案件标的金额或争议金额（元），财产案件/申请费必填'),
    nonPropertyType: z.enum(['property', 'personality', 'other']).optional().describe(
        '案件子类型：property（财产案件）、personality（人格权案件）、other（其他非财产），caseFee 时必填'
    ),
    hasProperty: z.boolean().optional().describe('非财产案件是否涉及财产分割'),
    hasDamages: z.boolean().optional().describe('人格权案件是否涉及损害赔偿'),
})

/**
 * 计算当前分支的缺失字段（含 caseFee 嵌套逻辑）
 */
function getMissingFields(merged: Record<string, unknown>): string[] {
    const missing: string[] = []
    const level1 = merged.feeTypeLevel1 as string

    if (level1 === 'caseFee') {
        // 受理费：nonPropertyType 必填（告知是财产还是非财产）
        if (!merged.nonPropertyType) {
            missing.push('nonPropertyType')
        }
        // 财产案件：amount 必须 > 0
        if (merged.nonPropertyType === 'property' && !((merged.amount as number) > 0)) {
            missing.push('amount')
        }
    } else if (level1 === 'applicationFee') {
        // 申请费：amount 必填（> 0）
        if (!((merged.amount as number) > 0)) {
            missing.push('amount')
        }
    }

    return missing
}

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'calculate_court_fee',
    description:
        '诉讼费用计算：根据《诉讼费用交纳办法》计算各类案件受理费、申请费，' +
        '支持财产案件、非财产案件（离婚、人格权）、知识产权、海事、执行申请等类型。' +
        '必填字段缺失时通过 interrupt 让用户补全。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input) => {
        // ① L2 兜底：从案件记忆查上次同工具计算结果预填
        const memoryCalc = ctx.caseId
            ? await findLastCalculationByCase(ctx.caseId, 'calculate_court_fee')
            : null
        let merged = { ...(memoryCalc?.input ?? {}), ...input } as Record<string, unknown>

        // ② 必填校验（含嵌套逻辑）
        const missing = getMissingFields(merged)

        // ③ 信息不足 → interrupt
        if (missing.length > 0) {
            const resumed = interrupt({
                type: InterruptType.CALCULATOR_INPUT,
                toolName: 'calculate_court_fee',
                prefilled: merged,
                missing,
            }) as unknown

            if (resumed === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumed || typeof resumed !== 'object') {
                throw new Error(`calculate_court_fee: resume payload 非法 (${typeof resumed})`)
            }
            merged = { ...merged, ...(resumed as Record<string, unknown>) }
        }

        // ④ 调 service 算结果
        // 将 nonPropertyType 映射到 service 的 feeTypeLevel2 + options
        let result: Record<string, unknown>
        try {
            const caseSubType = merged.nonPropertyType as string | undefined
            // 'property' 表示财产案件，直接用 feeTypeLevel2='property'；否则用 'nonProperty'
            const serviceLevel2 = (merged.feeTypeLevel2 as string)
                ?? (caseSubType === 'property' ? 'property' : 'nonProperty')
            const options = {
                // personality/other 传给 service 做非财产子类判断；property 无需传
                nonPropertyType: caseSubType !== 'property' ? (caseSubType as any) : undefined,
                hasProperty: merged.hasProperty as boolean | undefined,
                hasDamages: merged.hasDamages as boolean | undefined,
            }
            result = calculateCourtFee(
                merged.feeTypeLevel1 as any,
                serviceLevel2 as any,
                (merged.amount as number) ?? 0,
                options,
            ) as unknown as Record<string, unknown>
        } catch (err) {
            logger.error('[calculate_court_fee] 计算失败', err)
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
                text: `[计算] 诉讼费 · ${merged.feeTypeLevel1} · 总额 ${result.totalFee ?? '-'} 元`,
                subjectKey: 'calculation:calculate_court_fee',
                source: 'manual',
                extraMetadata: {
                    calculation: {
                        tool: 'calculate_court_fee',
                        input: merged,
                        output: result,
                        calculatedAt: new Date().toISOString(),
                    },
                },
            }).catch((err: Error) => {
                logger.error('[calculate_court_fee] 写入案件记忆失败（不阻塞结果）', err)
            })
        }

        return JSON.stringify(result)
    }, toolDefinition)
}
