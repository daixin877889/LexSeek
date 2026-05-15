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
    caseFeeType: z.enum(['property', 'nonProperty', 'intellectualProperty', 'labor', 'administrative', 'jurisdiction']).optional().describe(
        '受理费案件类型，feeTypeLevel1=caseFee 时必填：property（财产案件）、nonProperty（非财产案件）、' +
        'intellectualProperty（知识产权案件）、labor（劳动争议案件）、administrative（行政案件）、jurisdiction（管辖权异议）'
    ),
    applicationFeeType: z.enum(['execution', 'preservation', 'paymentOrder', 'publicNotice', 'arbitration', 'bankruptcy', 'maritime']).optional().describe(
        '申请费类型，feeTypeLevel1=applicationFee 时必填：execution（申请执行）、preservation（财产保全）、' +
        'paymentOrder（支付令）、publicNotice（公示催告）、arbitration（仲裁裁决）、bankruptcy（破产）、maritime（海事申请）'
    ),
    amount: z.number().min(0).optional().describe('案件标的额或争议金额（元），财产案件/知识产权按金额计费时必填'),
    nonPropertyType: z.enum(['divorce', 'personality', 'other']).optional().describe(
        '非财产案件细分，caseFeeType=nonProperty 时必填：divorce（离婚）、personality（人格权）、other（其他非财产）'
    ),
    hasProperty: z.boolean().optional().describe('离婚案件是否涉及财产分割'),
    hasDamages: z.boolean().optional().describe('人格权案件是否涉及损害赔偿'),
    hasDisputeAmount: z.boolean().optional().describe('知识产权案件是否含具体争议金额'),
    administrativeType: z.enum(['general', 'special']).optional().describe(
        '行政案件子类型：general（一般行政案件）、special（特殊行政案件）'
    ),
    hasExecutionAmount: z.boolean().optional().describe('执行申请是否含金额（按金额计费）'),
    hasPreservationProperty: z.boolean().optional().describe('保全申请是否含财产价值'),
    maritimeType: z.enum(['fund', 'order', 'notice', 'register', 'average']).optional().describe(
        '海事申请类型：fund（设立责任限制基金）、order（海事强制令）、notice（船舶优先权催告）、register（债权登记）、average（共同海损）'
    ),
})

/**
 * 计算当前分支的缺失字段（受理费按 caseFeeType / 申请费按 applicationFeeType）
 */
function getMissingFields(merged: Record<string, unknown>): string[] {
    const missing: string[] = []
    const level1 = merged.feeTypeLevel1 as string

    if (level1 === 'caseFee') {
        // 受理费：先确定案件类型
        if (!merged.caseFeeType) {
            missing.push('caseFeeType')
            return missing
        }
        // 非财产案件：必须细分（离婚/人格权/其他）
        if (merged.caseFeeType === 'nonProperty' && !merged.nonPropertyType) {
            missing.push('nonPropertyType')
        }
        // 财产案件：amount 必须 > 0
        if (merged.caseFeeType === 'property' && !((merged.amount as number) > 0)) {
            missing.push('amount')
        }
    } else if (level1 === 'applicationFee') {
        // 申请费：先确定申请类型
        if (!merged.applicationFeeType) {
            missing.push('applicationFeeType')
        }
    }

    return missing
}

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'calculate_court_fee',
    description:
        '诉讼费用计算：根据《诉讼费用交纳办法》计算各类案件受理费、申请费，' +
        '支持财产案件、非财产案件（离婚、人格权）、知识产权、海事、执行申请等类型。' +
        '数值参数（金额、时长、数量、档位枚举等）必须由用户在自然语言里明确告知；用户未告知时该字段必须留空，工具会自动弹 inline 卡片让用户补全；严禁猜测、估算或套用默认值。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input, cfg) => {
        // ① L2 兜底：从案件记忆查上次同工具计算结果预填
        const memoryCalc = ctx.caseId
            ? await findLastCalculationByCase(ctx.caseId, 'calculate_court_fee')
            : null
        let merged = { ...(memoryCalc?.input ?? {}), ...input } as Record<string, unknown>

        // ② 必填校验（含嵌套逻辑）
        const missing = getMissingFields(merged)

        // ③ 信息不足 → interrupt
        if (missing.length > 0) {
            const resumedRaw = interrupt({
                toolCallId: (cfg as any)?.toolCall?.id ?? "",
                type: InterruptType.CALCULATOR_INPUT,
                toolName: 'calculate_court_fee',
                prefilled: merged,
                missing,
            }) as unknown

            if (resumedRaw === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumedRaw || typeof resumedRaw !== 'object') {
                throw new Error(`calculate_court_fee: resume payload 非法 (${typeof resumedRaw})`)
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

        // ④ 调 service 算结果：受理费用 caseFeeType、申请费用 applicationFeeType 作为二级类型
        let result: Record<string, unknown>
        try {
            const serviceLevel2 = merged.feeTypeLevel1 === 'caseFee'
                ? (merged.caseFeeType as string)
                : (merged.applicationFeeType as string)
            const options = {
                nonPropertyType: merged.nonPropertyType as any,
                hasProperty: merged.hasProperty as boolean | undefined,
                hasDamages: merged.hasDamages as boolean | undefined,
                hasDisputeAmount: merged.hasDisputeAmount as boolean | undefined,
                administrativeType: merged.administrativeType as any,
                hasExecutionAmount: merged.hasExecutionAmount as boolean | undefined,
                hasPreservationProperty: merged.hasPreservationProperty as boolean | undefined,
                maritimeType: merged.maritimeType as any,
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

        return JSON.stringify({ ...merged, ...(result as Record<string, unknown>) })
    }, toolDefinition)
}
