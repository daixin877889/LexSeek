/**
 * 积分预扣工具
 *
 * 为选定的分析模块批量预扣积分
 */

import { z } from 'zod'
import {
    preDeductPointsService,
    checkPointsService,
} from '~~/server/services/point/pointConsumption.service'
import { createSimpleTool, type ToolDefinition } from './types'

const schema = z.object({
    modules: z.array(z.string()).describe(
        '需要预扣积分的分析模块标识列表，如 ["analysis_summary", "analysis_defense"]'
    ),
    // LLM 偶尔会把数字 ID 当字符串回传，coerce 自动转 number 增强鲁棒性
    sourceId: z.coerce.number().optional().describe('关联的案件分析记录 ID'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'reserve_points',
    description: '为选定的分析模块批量预扣积分。每个模块独立预扣，各自获得独立的 batchId。各模块完成后需调用 confirm_points（传入对应 batchId）确认或 rollback_points 回滚。返回每个模块的 batchId 映射。',
    schema,
}

export const createTool = createSimpleTool(
    toolDefinition,
    async ({ modules, sourceId }, ctx) => {
        const { userId } = ctx
        logger.info('执行积分预扣', { userId, modules })

        const results: Array<{ module: string; batchId: string; amount: number; itemName: string }> = []
        const errors: Array<{ module: string; error: string }> = []

        // 内层 try/catch 保留：每个模块独立隔离，单条失败不影响其他模块
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

                const result = await preDeductPointsService(userId, moduleKey, 1, { sourceId })
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

        return {
            success: errors.length === 0,
            totalAmount,
            reservations: results,
            errors: errors.length > 0 ? errors : undefined,
        }
    },
    { errorLabel: '积分预扣' },
)
