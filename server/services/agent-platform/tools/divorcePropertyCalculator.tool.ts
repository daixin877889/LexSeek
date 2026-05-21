/**
 * 离婚财产分割计算 Agent 工具（交互式版本）
 *
 * 信息充足时直接计算并写入案件记忆；
 * 信息不足时（所有资产/负债均为 0）通过 interrupt() 让用户在 inline 卡片补全参数。
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { consola as logger } from 'consola'
import { InterruptType } from '#shared/types/case'
import type { ToolContext, ToolDefinition } from '#shared/types/agentTools'
import { calculateDivorceProperty } from '#shared/utils/tools/divorcePropertyService'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

const schema = z.object({
    house: z.number().min(0).default(0).describe('房产价值（元）'),
    car: z.number().min(0).default(0).describe('车辆价值（元）'),
    savings: z.number().min(0).default(0).describe('存款金额（元）'),
    investments: z.number().min(0).default(0).describe('投资理财金额（元）'),
    otherAssets: z.number().min(0).default(0).describe('其他财产价值（元）'),
    mortgage: z.number().min(0).default(0).describe('房贷余额（元）'),
    carLoan: z.number().min(0).default(0).describe('车贷余额（元）'),
    creditCard: z.number().min(0).default(0).describe('信用卡债务（元）'),
    otherDebts: z.number().min(0).default(0).describe('其他债务（元）'),
    husbandRatio: z.number().min(0).max(1).default(0.5).describe('丈夫分得比例（0-1，默认0.5）'),
    wifeRatio: z.number().min(0).max(1).default(0.5).describe('妻子分得比例（0-1，默认0.5）'),
    hasChildren: z.boolean().default(false).describe('是否有子女'),
    childCustody: z.enum(['husband', 'wife', 'shared']).default('shared').describe('子女抚养权归属'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'calculate_divorce_property',
    description: '离婚财产分割计算：根据双方共同财产（房产、车辆、存款等）和共同债务，按照指定分割比例计算各方所得净资产及子女抚养费。数值参数（金额、时长、数量、档位枚举等）必须由用户在自然语言里明确告知；用户未告知时该字段必须留空，工具会自动弹 inline 卡片让用户补全；严禁猜测、估算或套用默认值。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input, cfg) => {
        // ① L2 兜底：从案件记忆查上次同工具计算结果预填
        const memoryCalc = ctx.caseId
            ? await findLastCalculationByCase(ctx.caseId, 'calculate_divorce_property')
            : null
        let merged = { ...(memoryCalc?.input ?? {}), ...input } as Record<string, unknown>

        // ② 校验：至少有一项资产或负债数据（全为 0 视为未填写）
        const totalAssets = ((merged.house as number) ?? 0) + ((merged.car as number) ?? 0)
            + ((merged.savings as number) ?? 0) + ((merged.investments as number) ?? 0)
            + ((merged.otherAssets as number) ?? 0)
        const totalDebts = ((merged.mortgage as number) ?? 0) + ((merged.carLoan as number) ?? 0)
            + ((merged.creditCard as number) ?? 0) + ((merged.otherDebts as number) ?? 0)
        const missing = totalAssets + totalDebts === 0 ? ['house'] : []

        // ③ 信息不足 → interrupt
        if (missing.length > 0) {
            const resumedRaw = interrupt({
                toolCallId: (cfg as any)?.toolCall?.id ?? "",
                type: InterruptType.CALCULATOR_INPUT,
                toolName: 'calculate_divorce_property',
                prefilled: merged,
                missing,
            }) as unknown

            if (resumedRaw === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumedRaw || typeof resumedRaw !== 'object') {
                throw new Error(`calculate_divorce_property: resume payload 非法 (${typeof resumedRaw})`)
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
            const assets = {
                house: (merged.house as number) ?? 0,
                car: (merged.car as number) ?? 0,
                savings: (merged.savings as number) ?? 0,
                investments: (merged.investments as number) ?? 0,
                other: (merged.otherAssets as number) ?? 0,
            }
            const debts = {
                mortgage: (merged.mortgage as number) ?? 0,
                carLoan: (merged.carLoan as number) ?? 0,
                creditCard: (merged.creditCard as number) ?? 0,
                other: (merged.otherDebts as number) ?? 0,
            }
            const options = {
                husbandRatio: (merged.husbandRatio as number) ?? 0.5,
                wifeRatio: (merged.wifeRatio as number) ?? 0.5,
                hasChildren: (merged.hasChildren as boolean) ?? false,
                childCustody: (merged.childCustody as string) ?? 'shared',
            }
            result = calculateDivorceProperty(assets, debts, options as any) as unknown as Record<string, unknown>
        } catch (err) {
            logger.error('[calculate_divorce_property] 计算失败', err)
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
                text: `[计算] 离婚财产分割 · 净资产 ${result.netAssets ?? '-'} 元`,
                subjectKey: 'calculation:calculate_divorce_property',
                source: 'manual',
                extraMetadata: {
                    calculation: {
                        tool: 'calculate_divorce_property',
                        input: merged,
                        output: result,
                        calculatedAt: new Date().toISOString(),
                    },
                },
            }).catch((err: Error) => {
                logger.error('[calculate_divorce_property] 写入案件记忆失败（不阻塞结果）', err)
            })
        }

        return JSON.stringify({ ...merged, ...(result as Record<string, unknown>) })
    }, toolDefinition)
}
