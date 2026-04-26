/**
 * 积分回滚工具
 *
 * 回滚单个分析模块的积分预扣
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ToolDefinition, ToolContext } from './types'
import { rollbackPreDeductService } from '~~/server/services/point/pointConsumption.service'

const schema = z.object({
    batchId: z.string().describe('预扣批次 ID'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'rollback_points',
    description: '回滚单个分析模块的积分预扣。在子代理执行失败时调用，将预扣的积分返还给用户。',
    schema,
}

export function createTool(context: ToolContext) {
    return tool(
        async (input) => {
            const { batchId } = input

            logger.info('执行积分回滚', { batchId })

            try {
                const result = await rollbackPreDeductService(batchId)
                return JSON.stringify({
                    success: true,
                    batchId,
                    releasedAmount: result.releasedAmount,
                })
            } catch (error) {
                logger.error('积分回滚失败:', error)
                return JSON.stringify({
                    error: '积分回滚失败',
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
