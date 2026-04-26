/**
 * 积分确认工具
 *
 * 确认单个分析模块的积分实扣
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ToolDefinition, ToolContext } from './types'
import { settlePointsService } from '~~/server/services/point/pointConsumption.service'

const schema = z.object({
    batchId: z.string().describe('预扣批次 ID'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'confirm_points',
    description: '确认单个分析模块的积分实扣。在子代理成功完成分析后调用，将预扣积分转为已消耗。',
    schema,
}

export function createTool(context: ToolContext) {
    return tool(
        async (input) => {
            const { batchId } = input

            logger.info('执行积分确认', { batchId })

            try {
                const result = await settlePointsService(batchId)
                return JSON.stringify({
                    success: true,
                    batchId,
                    consumedAmount: result.consumedAmount,
                })
            } catch (error) {
                logger.error('积分确认失败:', error)
                return JSON.stringify({
                    error: '积分确认失败',
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
