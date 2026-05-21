/**
 * 银行利率查询 Agent 工具
 *
 * 纯查询工具，不调用 interrupt 也不写案件记忆。
 * 支持 LPR / 存款基准利率 / 贷款基准利率 / 全部最新利率四种查询类型。
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolContext, ToolDefinition } from '#shared/types/agentTools'
import {
    queryLPRRate,
    queryDepositRate,
    queryLoanRate,
    getLatestLPR,
    getLatestDepositRate,
    getLatestLoanRate,
} from '#shared/utils/tools/bankRateService'

const schema = z.object({
    queryType: z.enum(['lpr', 'deposit', 'loan', 'all']).describe(
        '查询类型：lpr（LPR贷款市场报价利率）、deposit（存款基准利率）、loan（贷款基准利率）、all（查询全部最新利率）'
    ),
    date: z.string().optional().describe('查询日期，格式 YYYY-MM-DD，不填则返回最新利率'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'query_bank_rate',
    description:
        '银行利率查询：查询指定日期的 LPR 贷款市场报价利率、央行存款基准利率或贷款基准利率，' +
        '也可一次性查询全部最新利率，适用于利息计算前的利率查询',
    schema,
}

export function createTool(_ctx: ToolContext) {
    return tool(async (input, cfg) => {
        if (input.queryType === 'all') {
            const result = {
                lpr: getLatestLPR(),
                depositRate: getLatestDepositRate(),
                loanRate: getLatestLoanRate(),
            }
            return JSON.stringify({ ...input, ...result })
        }

        if (input.queryType === 'lpr') {
            return JSON.stringify(queryLPRRate(input.date))
        }

        if (input.queryType === 'deposit') {
            return JSON.stringify(queryDepositRate(input.date))
        }

        // loan
        return JSON.stringify(queryLoanRate(input.date))
    }, toolDefinition)
}
