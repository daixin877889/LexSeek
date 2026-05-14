/**
 * 银行利率查询 Agent 工具
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolModule, ToolContext } from '#shared/types/agentTools'
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

export const bankRateQueryTool: ToolModule = {
    toolDefinition: {
        name: 'query_bank_rate',
        description: '银行利率查询：查询指定日期的 LPR 贷款市场报价利率、央行存款基准利率或贷款基准利率，也可一次性查询全部最新利率，适用于利息计算前的利率查询',
        schema,
    },
    createTool: (_ctx: ToolContext) =>
        tool(
            async (input) => {
                if (input.queryType === 'all') {
                    const result = {
                        lpr: getLatestLPR(),
                        depositRate: getLatestDepositRate(),
                        loanRate: getLatestLoanRate(),
                    }
                    return JSON.stringify(result)
                }

                if (input.queryType === 'lpr') {
                    const result = queryLPRRate(input.date)
                    return JSON.stringify(result)
                }

                if (input.queryType === 'deposit') {
                    const result = queryDepositRate(input.date)
                    return JSON.stringify(result)
                }

                // loan
                const result = queryLoanRate(input.date)
                return JSON.stringify(result)
            },
            {
                name: 'query_bank_rate',
                description: '银行利率查询：查询指定日期的 LPR 贷款市场报价利率、央行存款基准利率或贷款基准利率，也可一次性查询全部最新利率，适用于利息计算前的利率查询',
                schema,
            },
        ) as any,
}
