/**
 * MinerU 批量上传链接申请 API
 *
 * POST /api/v1/recognition/mineru/upload-url
 *
 * 申请 MinerU 文件上传链接，用于浏览器直传 doc/pdf 文件
 * 上传链接有效期 24 小时，文件上传后系统自动提交解析任务
 *
 * @requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { z } from 'zod'
import crypto from 'crypto'
import { $fetch } from 'ofetch'
import {
    createMineruTaskService,
} from '~~/server/services/material/mineruTask.service'
import {
    getActiveTokenValueService,
    hasActiveTokenService,
} from '~~/server/services/material/mineruToken.service'
import { DocRecognitionStatus, MineruTaskStatus } from '#shared/types/recognition'
import type { ossFiles } from '~~/generated/prisma/client'
import { createDocRecognitionRecordDao, findDocRecognitionByOssFileIdDao, updateDocRecognitionRecordDao } from '~~/server/services/material/mineru.dao'

/** 文件信息验证 Schema */
const fileInfoSchema = z.object({
    /** OSS 文件 ID */
    ossFileId: z.number().int().positive('ossFileId 必须是正整数'),
    /** 文件名（包含扩展名） */
    fileName: z.string().min(1, '文件名不能为空'),
})

/** 请求体验证 Schema */
const bodySchema = z.object({
    /** 文件列表（单次最多 200 个） */
    files: z.array(fileInfoSchema).min(1, '至少需要一个文件').max(200, '单次最多 200 个文件'),
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

/** 申请上传链接响应 */
interface ApplyUploadUrlResponse {
    /** 批量任务 ID */
    batchId: string
    /** 上传链接列表（与请求文件顺序对应） */
    fileUrls: string[]
    /** 文件信息列表（包含 ossFileId 和 dataId） */
    files: Array<{
        ossFileId: number
        dataId: string
        uploadUrl: string
    }>
}

/**
 * 生成 data_id
 * 格式：ossFileId_userId
 * 用于回调时关联业务数据
 */
const generateDataId = (ossFileId: number, userId: number): string => {
    return `${ossFileId}_${userId}`
}

/**
 * 生成回调签名种子
 * 使用随机字符串，用于验证回调请求
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

    const { files, modelVersion, enableOcr, enableFormula, enableTable } = bodyResult.data

    try {
        // 1. 检查是否有可用的 MinerU Token
        const hasToken = await hasActiveTokenService()
        if (!hasToken) {
            return resError(event, 500, '没有可用的 MinerU Token，请联系管理员配置')
        }

        const token = await getActiveTokenValueService()
        if (!token) {
            return resError(event, 500, '获取 MinerU Token 失败')
        }

        // 2. 验证所有 OSS 文件存在
        const ossFileIds = files.map(f => f.ossFileId)
        const ossFiles = await prisma.ossFiles.findMany({
            where: {
                id: { in: ossFileIds },
                deletedAt: null,
            },
        })

        if (ossFiles.length !== files.length) {
            const foundIds = new Set(ossFiles.map(f => f.id))
            const missingIds = ossFileIds.filter(id => !foundIds.has(id))
            return resError(event, 404, `文件不存在: ${missingIds.join(', ')}`)
        }

        // 3. 生成 seed 用于回调签名验证
        const seed = generateSeed()

        // 4. 构建 MinerU 批量上传请求
        const baseUrl = useRuntimeConfig().public.baseUrl
        const callbackUrl = `${baseUrl}/api/v1/callback/mineru-batch`

        const mineruFiles = files.map(f => ({
            name: f.fileName,
            data_id: generateDataId(f.ossFileId, user.id),
            is_ocr: enableOcr,
        }))

        const requestBody: Record<string, any> = {
            files: mineruFiles,
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

        // 6. 验证返回的链接数量与请求文件数量一致
        if (fileUrls.length !== files.length) {
            logger.error('MinerU 返回的链接数量不匹配', {
                expected: files.length,
                actual: fileUrls.length,
            })
            return resError(event, 500, '申请上传链接失败：返回链接数量不匹配')
        }

        // 7. 创建 MinerU 任务记录和文档识别记录
        const fileResults: ApplyUploadUrlResponse['files'] = []

        for (let i = 0; i < files.length; i++) {
            const file = files[i]!
            const uploadUrl = fileUrls[i]!
            const dataId = generateDataId(file.ossFileId, user.id)

            // 创建 MinerU 任务记录
            await createMineruTaskService({
                ossFileId: file.ossFileId,
                userId: user.id,
                status: MineruTaskStatus.PROCESSING,
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

            // 创建或更新文档识别记录
            const existingRecord = await findDocRecognitionByOssFileIdDao(file.ossFileId)
            if (existingRecord) {
                // 更新现有记录状态为处理中
                await updateDocRecognitionRecordDao(existingRecord.id, {
                    status: DocRecognitionStatus.PROCESSING,
                })
            } else {
                // 创建新记录
                await createDocRecognitionRecordDao({
                    userId: user.id,
                    ossFileId: file.ossFileId,
                    status: DocRecognitionStatus.PROCESSING,
                })
            }

            fileResults.push({
                ossFileId: file.ossFileId,
                dataId,
                uploadUrl,
            })
        }

        logger.info(`MinerU 批量上传链接申请成功`, {
            userId: user.id,
            batchId,
            fileCount: files.length,
        })

        const responseData: ApplyUploadUrlResponse = {
            batchId,
            fileUrls,
            files: fileResults,
        }

        return resSuccess(event, '申请上传链接成功', responseData)
    } catch (error) {
        logger.error('申请 MinerU 上传链接失败:', error)
        return resError(event, 500, '申请上传链接失败')
    }
})
