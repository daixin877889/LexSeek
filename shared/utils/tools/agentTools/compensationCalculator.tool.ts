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
    calculateSeveranceCompensation,
} from '#shared/utils/tools/compensationService'
import {
    writeMemoryService,
    findLastCalculationByCase,
} from '~~/server/services/memory/memory.service'

const schema = z.object({
    type: z.enum(['workInjury', 'trafficAccident', 'death', 'severance']).describe(
        '赔偿类型：workInjury（工伤赔偿）、trafficAccident（交通事故赔偿）、death（死亡赔偿）、severance（劳动合同解除：经济补偿金 N/N+1 或经济赔偿金 2N）'
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
    // 经济补偿金 / 经济赔偿金（severance）参数
    severanceSubType: z.enum(['compensation', 'damages']).optional().describe(
        '劳动合同解除补偿子类型：compensation（经济补偿金 N/N+1，单位合法解除）、damages（经济赔偿金 2N，单位违法解除），type=severance 必填'
    ),
    monthlyWage: z.number().min(0).optional().describe('离职前 12 个月平均工资（元），type=severance 必填'),
    startDate: z.string().optional().describe('入职日期 YYYY-MM-DD，type=severance 必填'),
    endDate: z.string().optional().describe('离职日期 YYYY-MM-DD，type=severance 必填'),
    isWageExceed: z.boolean().optional().describe('月工资是否超社平 3 倍；用户未明示时留空'),
    socialAverageWage: z.number().min(0).optional().describe('当地上年度职工月平均工资（元），isWageExceed=true 时必填'),
    isArticle40: z.boolean().optional().describe('是否第四十条情形（医疗期满/不胜任工作/客观情况变化，N+1 计算依据）；仅 severanceSubType=compensation 时有效'),
    lastMonthWage: z.number().min(0).optional().describe('离职前最后一个月工资（元），isArticle40=true 时必填（用于 N+1 中的 +1）'),
})

/** 各分支必填字段 */
const REQUIRED_FIELDS: Record<string, string[]> = {
    workInjury: ['salary', 'disabilityLevel'],
    trafficAccident: ['medicalExpenses', 'disabilityCompensation'],
    death: ['annualIncome'],
    severance: ['severanceSubType', 'monthlyWage', 'startDate', 'endDate'],
}

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'calculate_compensation',
    description:
        '赔偿金计算：支持工伤/交通事故/死亡 3 种场景。' +
        '数值参数（金额、时长、数量、档位枚举等）必须由用户在自然语言里明确告知；用户未告知时该字段必须留空，工具会自动弹 inline 卡片让用户补全；严禁猜测、估算或套用默认值。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async (input, cfg) => {
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
            const resumedRaw = interrupt({
                toolCallId: (cfg as any)?.toolCall?.id ?? "",
                type: InterruptType.CALCULATOR_INPUT,
                toolName: 'calculate_compensation',
                prefilled: merged,
                missing,
            }) as unknown

            // null 表示用户取消（必须先判 null，再判 typeof object）
            if (resumedRaw === null) {
                return JSON.stringify({ cancelled: true, reason: '用户取消了本次计算' })
            }
            if (!resumedRaw || typeof resumedRaw !== 'object') {
                throw new Error(`calculate_compensation: resume payload 非法 (${typeof resumedRaw})`)
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
            } else if (merged.type === 'severance') {
                result = calculateSeveranceCompensation(
                    merged.severanceSubType as 'compensation' | 'damages',
                    merged.monthlyWage as number,
                    merged.startDate as string,
                    merged.endDate as string,
                    (merged.isWageExceed as boolean) ?? false,
                    (merged.socialAverageWage as number) ?? 0,
                    (merged.isArticle40 as boolean) ?? false,
                    (merged.lastMonthWage as number) ?? 0,
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

        return JSON.stringify({ ...merged, ...(result as Record<string, unknown>) })
    }, toolDefinition)
}
