/**
 * MinerU 识别任务提交 API
 *
 * POST /api/v1/recognition/mineru/submit
 *
 * 统一的 MinerU 任务提交接口，整合上传链接申请和任务创建
 * 返回 taskId 供前端轮询使用
 *
 * @requirements 2.1, 2.2, 2.3
 */

import { z } from 'zod'
import crypto from 'crypto'
import { $fetch } from 'ofetch'
import {
    createMineruTaskService,
} from '~~/server/services/material/mineruTask.service'
import { pickTokenForNewTaskService } from '~~/server/services/material/mineruToken.service'
import { MineruTaskStatus } from '#shared/types/recognition'

/** 请求体验证 Schema */
const bodySchema = z.object({
    /** OSS 文件 ID */
    ossFileId: z.number().int().positive('ossFileId 必须是正整数'),
    /** 文件名（包含扩展名） */
    fileName: z.string().min(1, '文件名不能为空'),
    /** 是否加密 */
    encrypted: z.boolean().optional().default(false),
    /** 模型版本：pipeline 或 vlm，默认 vlm */
    modelVersion: z.enum(['pipeline', 'vlm']).optional().default('vlm'),
    /** 是否启用 OCR，默认 true */
    enableOcr: z.boolean().optional().default(true),
    /** 是否启用公式识别，默认 true */
    enableFormula: z.boolean().optional().default(true),
    /** 是否启用表格识别，默认 true */
    enableTable: z.boolean().optional().default(true),
})

/** MinerU 批量上传 API 响应 */
interface MineruBatchResponse {
    code: number
    msg: string
    trace_id?: string
    data?: {
        batch_id: string
        file_urls: string[]
    }
}

/** 提交响应 */
interface SubmitResponse {
    /** 任务 ID */
    taskId: string
    /** 任务状态 */
    taskStatus: number
    /** 上传 URL */
    uploadUrl: string
    /** 批量任务 ID */
    batchId: string
}

/**
 * 生成 data_id
 * 格式：ossFileId_userId
 */
const generateDataId = (ossFileId: number, userId: number): string => {
    return `${ossFileId}_${userId}`
}

/**
 * 生成回调签名种子
 */
const generateSeed = (): string => {
    return crypto.randomBytes(16).toString('hex')
}

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 验证请求体
    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body)
    if (!bodyResult.success) {
        return resError(event, 400, bodyResult.error.issues[0]!?.message || '参数错误')
    }

    const { ossFileId, fileName, encrypted, modelVersion, enableOcr, enableFormula, enableTable } = bodyResult.data

    try {
        // 1. 验证 OSS 文件存在
        const ossFile = await prisma.ossFiles.findFirst({
            where: {
                id: ossFileId,
                deletedAt: null,
            },
        })

        if (!ossFile) {
            return resError(event, 404, '文件不存在')
        }

        // 2. LRU 选取一个可用 token（启用 + 未过期），并记录 id 供轮询时复用
        const picked = await pickTokenForNewTaskService()
        if (!picked) {
            return resError(event, 500, '没有可用的 MinerU Token，请联系管理员配置')
        }
        const { id: mineruTokenId, token } = picked

        // 3. 生成 seed 用于回调签名验证
        const seed = generateSeed()

        // 4. 构建 MinerU 批量上传请求
        const baseUrl = useRuntimeConfig().public.baseUrl
        const callbackUrl = `${baseUrl}/api/v1/callback/mineru-batch`

        const dataId = generateDataId(ossFileId, user.id)

        const requestBody: Record<string, any> = {
            files: [{
                name: fileName,
                data_id: dataId,
                is_ocr: enableOcr,
            }],
            model_version: modelVersion,
            enable_formula: enableFormula,
            enable_table: enableTable,
            callback: callbackUrl,
            seed,
        }

        // 5. 调用 MinerU 批量上传 API
        const response = (await $fetch(
            'https://mineru.net/api/v4/file-urls/batch',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: requestBody,
            }
        )) as MineruBatchResponse

        if (response.code !== 0 || !response.data) {
            logger.error('MinerU 批量上传链接申请失败：', response)
            return resError(event, 500, response.msg || '申请上传链接失败')
        }

        const { batch_id: batchId, file_urls: fileUrls } = response.data

        if (fileUrls.length === 0) {
            return resError(event, 500, '申请上传链接失败：未返回上传链接')
        }

        const uploadUrl = fileUrls[0]!

        // 6. 创建 MinerU 任务记录
        const task = await createMineruTaskService({
            ossFileId,
            userId: user.id,
            mineruTokenId,
            status: MineruTaskStatus.PROCESSING,
            isEncrypted: encrypted,
            taskRawData: {
                batchId,
                dataId,
                uploadUrl,
                seed,
                modelVersion,
                options: {
                    enableOcr,
                    enableFormula,
                    enableTable,
                },
                submittedAt: new Date().toISOString(),
            },
        })

        logger.info(`MinerU 任务提交成功`, {
            userId: user.id,
            taskId: task.id,
            ossFileId,
            batchId,
        })

        const responseData: SubmitResponse = {
            taskId: task.id.toString(),
            taskStatus: task.status,
            uploadUrl,
            batchId,
        }

        return resSuccess(event, '任务提交成功', responseData)
    } catch (error) {
        logger.error('提交 MinerU 任务失败:', error)
        return resError(event, 500, '提交任务失败')
    }
})
