/**
 * 积分预扣工具
 *
 * 为选定的分析模块批量预扣积分
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ToolDefinition, ToolContext } from './types'
import {
    preDeductPointsService,
    checkPointsService,
} from '../../point/pointConsumption.service'

const schema = z.object({
    modules: z.array(z.string()).describe(
        '需要预扣积分的分析模块标识列表，如 ["analysis_summary", "analysis_defense"]'
    ),
    sourceId: z.number().optional().describe('关联的案件分析记录 ID'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'reserve_points',
    description: '为选定的分析模块批量预扣积分。每个模块独立预扣，各自获得独立的 batchId。各模块完成后需调用 confirm_points（传入对应 batchId）确认或 rollback_points 回滚。返回每个模块的 batchId 映射。',
    schema,
}

export function createTool(context: ToolContext) {
    const { userId } = context

    return tool(
        async (input) => {
            const { modules, sourceId } = input

            logger.info('执行积分预扣', { userId, modules })

            try {
                const results = []
                const errors = []

                for (const moduleKey of modules) {
                    try {
                        const check = await checkPointsService(userId, moduleKey)
                        if (!check.sufficient) {
                            errors.push({
                                module: moduleKey,
                                error: `积分不足，需要 ${check.required}，可用 ${check.available}`,
                            })
                            continue
                        }

                        const result = await preDeductPointsService(
                            userId, moduleKey, 1, { sourceId }
                        )
                        results.push({
                            module: moduleKey,
                            batchId: result.batchId,
                            amount: result.preDeductAmount,
                            itemName: check.itemName,
                        })
                    } catch (error) {
                        errors.push({
                            module: moduleKey,
                            error: error instanceof Error ? error.message : '预扣失败',
                        })
                    }
                }

                const totalAmount = results.reduce((sum, r) => sum + r.amount, 0)

                return JSON.stringify({
                    success: errors.length === 0,
                    totalAmount,
                    reservations: results,
                    errors: errors.length > 0 ? errors : undefined,
                })
            } catch (error) {
                logger.error('积分预扣失败:', error)
                return JSON.stringify({
                    error: '积分预扣失败',
                    message: error instanceof Error ? error.message : '未知错误',
                })
            }
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema: toolDefinition.schema,
        }
    )
}
