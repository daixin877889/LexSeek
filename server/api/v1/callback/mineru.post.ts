/**
 * MinerU 回调接口
 *
 * POST /api/v1/callback/mineru
 *
 * 接收 MinerU PDF 转换完成的回调通知
 * Requirements: 3.1.3.1-3.1.3.11
 */

import { z } from 'zod'
import {
    getMineruTaskByTaskIdService,
    isMineruTaskProcessedService,
} from '~~/server/services/material/mineruTask.service'
import {
    processConversionResultService,
    completeConversionService,
    failConversionService,
} from '~~/server/services/material/mineru.service'

/** MinerU 回调请求体验证 Schema */
const callbackBodySchema = z.object({
    /** 任务ID */
    task_id: z.string().min(1, '任务ID不能为空'),
    /** 任务状态：done-成功，failed-失败 */
    state: z.enum(['done', 'failed']),
    /** 转换结果（成功时返回） */
    result: z.object({
        /** 结果文件下载 URL */
        download_url: z.string().optional(),
    }).catchall(z.any()).optional(),
    /** 错误信息（失败时返回） */
    err_msg: z.string().optional(),
    /** 进度（0-100） */
    progress: z.number().optional(),
})

/** 回调响应格式 */
interface CallbackResponse {
    code: string
    message: string
}


export default defineEventHandler(async (event): Promise<CallbackResponse> => {
    try {
        // 获取请求体
        const body = await readBody(event)

        // 验证请求体
        const parseResult = callbackBodySchema.safeParse(body)
        if (!parseResult.success) {
            logger.error('MinerU 回调：请求体验证失败', parseResult.error.issues)
            return { code: 'FAIL', message: '请求参数无效' }
        }

        const { task_id, state, result, err_msg } = parseResult.data

        logger.info(`MinerU 回调：收到任务 ${task_id} 的回调通知，状态: ${state}`)

        // 幂等检查：检查任务是否已处理
        // Requirements: 3.1.3.10
        const isProcessed = await isMineruTaskProcessedService(task_id)
        if (isProcessed) {
            logger.info(`MinerU 回调：任务 ${task_id} 已处理，跳过`)
            return { code: 'SUCCESS', message: '任务已处理' }
        }

        // 查找本地任务记录
        // Requirements: 3.1.3.3
        const task = await getMineruTaskByTaskIdService(task_id)
        if (!task) {
            // Requirements: 3.1.3.4
            logger.error(`MinerU 回调：任务 ${task_id} 不存在`)
            return { code: 'FAIL', message: '任务不存在' }
        }

        // 根据状态处理
        if (state === 'done') {
            // 转换成功
            // Requirements: 3.1.3.5, 3.1.3.6, 3.1.3.7, 3.1.3.8
            const downloadUrl = result?.download_url
            if (!downloadUrl) {
                logger.error(`MinerU 回调：任务 ${task_id} 成功但未返回下载链接`)
                await failConversionService(task_id, '转换成功但未返回下载链接')
                return { code: 'FAIL', message: '未返回下载链接' }
            }

            try {
                // 下载并处理转换结果
                const conversionResult = await processConversionResultService(task_id, downloadUrl, task.userId)

                if (conversionResult.success && conversionResult.markdownContent && conversionResult.htmlContent) {
                    // 完成转换并保存结果（包括积分扣减和保存到 docRecognitionRecords）
                    await completeConversionService(
                        task_id,
                        conversionResult.markdownContent,
                        conversionResult.htmlContent
                    )
                    logger.info(`MinerU 回调：任务 ${task_id} 处理成功`)
                    return { code: 'SUCCESS', message: '处理成功' }
                } else {
                    await failConversionService(task_id, conversionResult.error || '处理转换结果失败')
                    return { code: 'FAIL', message: conversionResult.error || '处理转换结果失败' }
                }
            } catch (error) {
                // Requirements: 3.1.3.9
                const errorMessage = error instanceof Error ? error.message : '处理转换结果失败'
                logger.error(`MinerU 回调：任务 ${task_id} 处理失败`, error)
                await failConversionService(task_id, errorMessage)
                return { code: 'FAIL', message: errorMessage }
            }
        } else {
            // 转换失败
            // Requirements: 3.1.3.9
            const errorMessage = err_msg || '转换失败'
            logger.error(`MinerU 回调：任务 ${task_id} 转换失败: ${errorMessage}`)
            await failConversionService(task_id, errorMessage)
            return { code: 'SUCCESS', message: '已记录失败状态' }
        }
    } catch (error) {
        logger.error('MinerU 回调异常：', error)
        return { code: 'FAIL', message: '处理异常' }
    }
})
