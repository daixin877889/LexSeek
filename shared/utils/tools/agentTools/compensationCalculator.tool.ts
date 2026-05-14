/**
 * 赔偿金计算 Agent 工具（交互式版本）
 *
 * 支持工伤赔偿、交通事故赔偿、死亡赔偿三种场景。
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
    calculateWorkInjuryCompensation,
    calculateTrafficAccidentCompensation,
    calculateDeathCompensation,
} from '#shared/utils/tools/compensationService'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

const schema = z.object({
    type: z.enum(['workInjury', 'trafficAccident', 'death']).describe(
        '赔偿类型：workInjury（工伤赔偿）、trafficAccident（交通事故赔偿）、death（死亡赔偿）'
    ),
    // 工伤赔偿参数
    salary: z.number().min(0).optional().describe('月工资（元），workInjury 必填'),
    disabilityLevel: z.number().int().min(1).max(10).optional().describe('伤残等级（1-10级），workInjury 必填'),
    medicalExpenses: z.number().min(0).optional().describe('医疗费用（元）'),
    nursingExpenses: z.number().min(0).optional().describe('护理费用（元）'),
    nutritionExpenses: z.number().min(0).optional().describe('营养费用（元）'),
    // 交通事故赔偿参数
    disabilityCompensation: z.number().min(0).optional().describe('伤残赔偿金（元），trafficAccident 必填'),
    lostIncome: z.number().min(0).optional().describe('误工费（元）'),
    transportationExpenses: z.number().min(0).optional().describe('交通费（元）'),
    accommodationExpenses: z.number().min(0).optional().describe('住宿费（元）'),
    propertyLoss: z.number().min(0).optional().describe('财产损失（元）'),
    // 死亡赔偿参数
    annualIncome: z.number().min(0).optional().describe('年收入（元），death 必填'),
    deathCompensationYears: z.number().int().min(1).max(20).optional().describe('死亡赔偿金年限（年），默认 20'),
    funeralExpenses: z.number().min(0).optional().describe('丧葬费（元）'),
    dependentCompensation: z.number().min(0).optional().describe('被抚养人生活费（元）'),
    emotionalDamages: z.number().min(0).optional().describe('精神损害赔偿金（元）'),
})

/** 各分支必填字段 */
const REQUIRED_FIELDS: Record<string, string[]> = {
    workInjury: ['salary', 'disabilityLevel'],
    trafficAccident: ['medicalExpenses', 'disabilityCompensation'],
    death: ['annualIncome'],
}

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'calculate_compensation',
    description:
        '赔偿金计算：支持工伤/交通事故/死亡 3 种场景。' +
        '必填字段缺失时通过 interrupt 让用户在 inline 卡片补全，禁用 0 替代真实数据。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input) => {
        // ① L2 兜底：从案件记忆查上次同工具计算结果预填
        const memoryCalc = ctx.caseId
            ? await findLastCalculationByCase(ctx.caseId, 'calculate_compensation')
            : null
        let merged = { ...(memoryCalc?.input ?? {}), ...input } as Record<string, unknown>

        // ② 必填校验：找出当前分支的缺失字段
        const required = REQUIRED_FIELDS[merged.type as string] ?? []
        const missing = required.filter(
            (f) => merged[f] === undefined || merged[f] === null || merged[f] === '',
        )

        // ③ 信息不足 → interrupt（防御性校验：as unknown + null 取消 + object 合并）
        if (missing.length > 0) {
            const resumed = interrupt({
                type: InterruptType.CALCULATOR_INPUT,
                toolName: 'calculate_compensation',
                prefilled: merged,
                missing,
            }) as unknown

            // null 表示用户取消（必须先判 null，再判 typeof object）
            if (resumed === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumed || typeof resumed !== 'object') {
                throw new Error(`calculate_compensation: resume payload 非法 (${typeof resumed})`)
            }
            merged = { ...merged, ...(resumed as Record<string, unknown>) }
        }

        // ④ 调 service 算结果（try-catch 兜底：服务抛错时返回 error JSON 不阻塞流程）
        let result: Record<string, unknown>
        try {
            if (merged.type === 'workInjury') {
                result = calculateWorkInjuryCompensation(
                    merged.salary as number,
                    merged.disabilityLevel as number,
                    (merged.medicalExpenses as number) ?? 0,
                    (merged.nursingExpenses as number) ?? 0,
                    (merged.nutritionExpenses as number) ?? 0,
                ) as unknown as Record<string, unknown>
            } else if (merged.type === 'trafficAccident') {
                result = calculateTrafficAccidentCompensation(
                    (merged.medicalExpenses as number) ?? 0,
                    (merged.disabilityCompensation as number) ?? 0,
                    (merged.nursingExpenses as number) ?? 0,
                    (merged.lostIncome as number) ?? 0,
                    (merged.nutritionExpenses as number) ?? 0,
                    (merged.transportationExpenses as number) ?? 0,
                    (merged.accommodationExpenses as number) ?? 0,
                    (merged.propertyLoss as number) ?? 0,
                ) as unknown as Record<string, unknown>
            } else {
                result = calculateDeathCompensation(
                    merged.annualIncome as number,
                    (merged.deathCompensationYears as number) ?? 20,
                    (merged.funeralExpenses as number) ?? 0,
                    (merged.dependentCompensation as number) ?? 0,
                    (merged.emotionalDamages as number) ?? 0,
                ) as unknown as Record<string, unknown>
            }
        } catch (err) {
            logger.error('[calculate_compensation] 计算失败', err)
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
                text: `[计算] 赔偿金 · ${merged.type} · 总额 ${result.totalCompensation ?? '-'} 元`,
                subjectKey: 'calculation:calculate_compensation',
                source: 'manual',
                extraMetadata: {
                    calculation: {
                        tool: 'calculate_compensation',
                        input: merged,
                        output: result,
                        calculatedAt: new Date().toISOString(),
                    },
                },
            }).catch((err: Error) => {
                logger.error('[calculate_compensation] 写入案件记忆失败（不阻塞结果）', err)
            })
        }

        return JSON.stringify(result)
    }, toolDefinition)
}
