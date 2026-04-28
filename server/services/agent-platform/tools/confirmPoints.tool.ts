/**
 * 积分确认工具
 *
 * 确认单个分析模块的积分实扣
 */

import { z } from 'zod'
import { createSimpleTool, type ToolDefinition } from './types'
import { settlePointsService } from '~~/server/services/point/pointConsumption.service'

const schema = z.object({
    batchId: z.string().describe('预扣批次 ID'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'confirm_points',
    description: '确认单个分析模块的积分实扣。在子代理成功完成分析后调用，将预扣积分转为已消耗。',
    schema,
}

export const createTool = createSimpleTool(
    toolDefinition,
    async ({ batchId }) => {
        logger.info('执行积分确认', { batchId })
        const result = await settlePointsService(batchId)
        return {
            success: true,
            batchId,
            consumedAmount: result.consumedAmount,
        }
    },
    { errorLabel: '积分确认' },
)
