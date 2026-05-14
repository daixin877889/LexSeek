/**
 * 律师费用计算 Agent 工具
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolModule, ToolContext } from '#shared/types/agentTools'
import { calculateLawyerFee } from '#shared/utils/tools/lawyerFeeService'

const schema = z.object({
    caseType: z.enum(['civil', 'criminal', 'administrative', 'commercial', 'consultation', 'document']).describe(
        '案件类型：civil（民事）、criminal（刑事）、administrative（行政）、commercial（商事）、consultation（法律咨询）、document（文书制作）'
    ),
    disputeAmount: z.number().min(0).default(0).describe('争议金额（元），民事/商事案件必填'),
    complexity: z.enum(['simple', 'medium', 'complex']).default('medium').describe('案件复杂程度：simple（简单）、medium（一般）、complex（复杂）'),
    region: z.enum(['tier1', 'tier2', 'tier3']).default('tier2').describe('地区档次：tier1（一线城市）、tier2（二线城市）、tier3（三线及以下城市）'),
    hasAppeal: z.boolean().default(false).describe('是否包含上诉阶段'),
    hasExecution: z.boolean().default(false).describe('是否包含执行阶段'),
    consultationHours: z.number().min(0).default(0).describe('法律咨询小时数，caseType=consultation 时填写'),
    caseDuration: z.number().min(1).default(1).describe('案件预计持续时间（月），刑事案件适用'),
})

export const lawyerFeeCalculatorTool: ToolModule = {
    toolDefinition: {
        name: 'calculate_lawyer_fee',
        description: '律师费用计算：根据《律师服务收费管理办法》及地方律师协会指导标准，按案件类型、争议金额、地区档次计算律师代理费参考区间，支持民事、刑事、行政、商事、咨询等类型',
        schema,
    },
    createTool: (_ctx: ToolContext) =>
        tool(
            async (input) => {
                const options = {
                    disputeAmount: input.disputeAmount,
                    complexity: input.complexity as any,
                    region: input.region as any,
                    hasAppeal: input.hasAppeal,
                    hasExecution: input.hasExecution,
                    consultationHours: input.consultationHours,
                    caseDuration: input.caseDuration,
                }
                const result = calculateLawyerFee(input.caseType as any, options)
                return JSON.stringify(result)
            },
            {
                name: 'calculate_lawyer_fee',
                description: '律师费用计算：根据《律师服务收费管理办法》及地方律师协会指导标准，按案件类型、争议金额、地区档次计算律师代理费参考区间，支持民事、刑事、行政、商事、咨询等类型',
                schema,
            },
        ) as any,
}
