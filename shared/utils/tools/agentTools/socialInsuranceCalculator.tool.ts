/**
 * 社保追缴计算 Agent 工具（交互式版本）
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
import { calculateSocialInsuranceBackpay } from '#shared/utils/tools/socialInsuranceService'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

const schema = z.object({
    monthlySalary: z.number().positive().optional().describe('月工资基数（元），必填'),
    months: z.number().int().positive().optional().describe('追缴月数，必填'),
    includeEmployerPart: z.boolean().default(true).describe('是否包含单位缴纳部分，默认 true'),
    pensionEmployee: z.number().min(0).optional().describe('养老保险个人缴费比例（小数），留空使用法定默认值'),
    pensionEmployer: z.number().min(0).optional().describe('养老保险单位缴费比例（小数），留空使用法定默认值'),
    medicalEmployee: z.number().min(0).optional().describe('医疗保险个人缴费比例（小数），留空使用法定默认值'),
    medicalEmployer: z.number().min(0).optional().describe('医疗保险单位缴费比例（小数），留空使用法定默认值'),
    housingEmployee: z.number().min(0).optional().describe('住房公积金个人缴存比例（小数），留空使用法定默认值'),
    housingEmployer: z.number().min(0).optional().describe('住房公积金单位缴存比例（小数），留空使用法定默认值'),
})

const REQUIRED_FIELDS = ['monthlySalary', 'months']

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'calculate_social_insurance_backpay',
    description: '社保追缴计算：根据月工资基数和追缴月数，计算养老保险、医疗保险、失业保险、工伤保险、生育保险、住房公积金的个人及单位应缴金额汇总，适用于劳动争议社保补缴场景。必填字段缺失时通过 interrupt 让用户补全。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input, cfg) => {
        // ① L2 兜底：从案件记忆查上次同工具计算结果预填
        const memoryCalc = ctx.caseId
            ? await findLastCalculationByCase(ctx.caseId, 'calculate_social_insurance_backpay')
            : null
        let merged = { ...(memoryCalc?.input ?? {}), ...input } as Record<string, unknown>

        // ② 必填校验
        const missing = REQUIRED_FIELDS.filter(
            (f) => merged[f] === undefined || merged[f] === null || merged[f] === '',
        )

        // ③ 信息不足 → interrupt
        if (missing.length > 0) {
            const resumed = interrupt({
                toolCallId: (cfg as any)?.toolCall?.id ?? "",
                type: InterruptType.CALCULATOR_INPUT,
                toolName: 'calculate_social_insurance_backpay',
                prefilled: merged,
                missing,
            }) as unknown

            if (resumed === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumed || typeof resumed !== 'object') {
                throw new Error(`calculate_social_insurance_backpay: resume payload 非法 (${typeof resumed})`)
            }
            merged = { ...merged, ...(resumed as Record<string, unknown>) }
        }

        // ④ 调 service 算结果（构造可选 rates 参数）
        let result: Record<string, unknown>
        try {
            const rates: Record<string, unknown> = {}
            if (merged.pensionEmployee !== undefined || merged.pensionEmployer !== undefined) {
                rates['pension'] = { employee: merged.pensionEmployee, employer: merged.pensionEmployer }
            }
            if (merged.medicalEmployee !== undefined || merged.medicalEmployer !== undefined) {
                rates['medical'] = { employee: merged.medicalEmployee, employer: merged.medicalEmployer }
            }
            if (merged.housingEmployee !== undefined || merged.housingEmployer !== undefined) {
                rates['housing'] = { employee: merged.housingEmployee, employer: merged.housingEmployer }
            }

            result = calculateSocialInsuranceBackpay(
                merged.monthlySalary as number,
                merged.months as number,
                rates as any,
                (merged.includeEmployerPart as boolean) ?? true,
            ) as unknown as Record<string, unknown>
        } catch (err) {
            logger.error('[calculate_social_insurance_backpay] 计算失败', err)
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
                text: `[计算] 社保追缴 · ${merged.months} 个月 · 总额 ${result.totalBackpay ?? '-'} 元`,
                subjectKey: 'calculation:calculate_social_insurance_backpay',
                source: 'manual',
                extraMetadata: {
                    calculation: {
                        tool: 'calculate_social_insurance_backpay',
                        input: merged,
                        output: result,
                        calculatedAt: new Date().toISOString(),
                    },
                },
            }).catch((err: Error) => {
                logger.error('[calculate_social_insurance_backpay] 写入案件记忆失败（不阻塞结果）', err)
            })
        }

        return JSON.stringify(result)
    }, toolDefinition)
}
