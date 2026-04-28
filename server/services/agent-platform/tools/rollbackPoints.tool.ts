/**
 * 积分回滚工具
 *
 * 回滚单个分析模块的积分预扣
 */

import { z } from 'zod'
import { createSimpleTool, type ToolDefinition } from './types'
import { rollbackPreDeductService } from '~~/server/services/point/pointConsumption.service'

const schema = z.object({
    batchId: z.string().describe('预扣批次 ID'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'rollback_points',
    description: '回滚单个分析模块的积分预扣。在子代理执行失败时调用，将预扣的积分返还给用户。',
    schema,
}

export const createTool = createSimpleTool(
    toolDefinition,
    async ({ batchId }) => {
        logger.info('执行积分回滚', { batchId })
        const result = await rollbackPreDeductService(batchId)
        return {
            success: true,
            batchId,
            releasedAmount: result.releasedAmount,
        }
    },
    { errorLabel: '积分回滚' },
)
