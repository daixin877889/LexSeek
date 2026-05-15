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
    complexity: z.enum(['simple', 'medium', 'complex', 'very-complex']).optional().describe(
        '案件复杂程度：simple（简单）、medium（一般）、complex（复杂）、very-complex（特别复杂）；用户未明示时留空'
    ),
    region: z.enum(['tier1', 'tier2', 'tier3']).optional().describe(
        '地区档次：tier1（一线城市）、tier2（二线城市）、tier3（三线及以下城市）；用户未明示时留空'
    ),
    hasAppeal: z.boolean().optional().describe('是否包含上诉阶段；用户未明示时留空'),
    hasExecution: z.boolean().optional().describe('是否包含执行阶段；用户未明示时留空'),
    consultationHours: z.number().min(0).optional().describe('法律咨询小时数，caseType=consultation 时必填'),
    caseDuration: z.number().min(1).optional().describe('案件预计持续时间（月），caseType=criminal 时必填'),
    documentType: z.enum(['contract', 'lawsuit', 'opinion', 'will', 'corporate']).optional().describe(
        '文书类型，caseType=document 时必填：contract（合同）、lawsuit（起诉书）、opinion（法律意见书）、will（遗嘱）、corporate（公司章程）'
    ),
    documentComplexity: z.enum(['simple', 'medium', 'complex']).optional().describe(
        '文书复杂程度，caseType=document 可选：simple（简单）、medium（一般）、complex（复杂）'
    ),
    administrativeType: z.enum(['basic', 'land', 'planning', 'environmental', 'licensing']).optional().describe(
        '行政案件子类型，caseType=administrative 可选：basic（一般）、land（土地）、planning（规划）、environmental（环境）、licensing（行政许可）'
    ),
    commercialType: z.enum(['contract_review', 'negotiation', 'due_diligence', 'ipo_advisory', 'compliance']).optional().describe(
        '商事服务类型，caseType=commercial 时必填：contract_review（合同审查）、negotiation（商务谈判）、due_diligence（尽职调查）、ipo_advisory（上市顾问）、compliance（合规服务）'
    ),
})

/** 各分支必填字段 */
const REQUIRED_FIELDS_BY_BRANCH: Record<string, string[]> = {
    civil: ['disputeAmount'],
    commercial: ['disputeAmount', 'commercialType'],
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
        '支持民事、刑事、行政、商事、咨询等类型。数值参数（金额、时长、数量、档位枚举等）必须由用户在自然语言里明确告知；用户未告知时该字段必须留空，工具会自动弹 inline 卡片让用户补全；严禁猜测、估算或套用默认值。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input, cfg) => {
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
            const resumedRaw = interrupt({
                toolCallId: (cfg as any)?.toolCall?.id ?? "",
                type: InterruptType.CALCULATOR_INPUT,
                toolName: 'calculate_lawyer_fee',
                prefilled: merged,
                missing,
            }) as unknown

            if (resumedRaw === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumedRaw || typeof resumedRaw !== 'object') {
                throw new Error(`calculate_lawyer_fee: resume payload 非法 (${typeof resumedRaw})`)
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
            const options = {
                disputeAmount: (merged.disputeAmount as number) ?? 0,
                complexity: (merged.complexity as any) ?? 'medium',
                region: (merged.region as any) ?? 'tier2',
                hasAppeal: (merged.hasAppeal as boolean) ?? false,
                hasExecution: (merged.hasExecution as boolean) ?? false,
                consultationHours: (merged.consultationHours as number) ?? 0,
                caseDuration: (merged.caseDuration as number) ?? 1,
                documentType: merged.documentType as any,
                documentComplexity: merged.documentComplexity as any,
                administrativeType: merged.administrativeType as any,
                commercialType: merged.commercialType as any,
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

        return JSON.stringify({ ...merged, ...(result as Record<string, unknown>) })
    }, toolDefinition)
}
