/**
 * 批量获取图片签名 URL API
 *
 * POST /api/v1/oss/image-signed-urls
 *
 * 根据 bucket 和 ossFileId 批量获取图片的签名访问 URL
 * 用于渲染识别结果中的图片占位符
 *
 * @requirements 3.3, 7.2
 */

import { z } from 'zod'
import { generateOssDownloadSignaturesService } from '~~/server/services/files/files.service'

// 请求体验证
const bodySchema = z.object({
    /** 图片列表 */
    images: z.array(z.object({
        /** bucket 名称 */
        bucket: z.string().min(1, 'bucket 不能为空'),
        /** OSS 文件 ID */
        ossFileId: z.number().int().positive('ossFileId 必须是正整数'),
    })).min(1, '图片列表不能为空').max(100, '单次最多处理 100 张图片'),
    /** URL 过期时间（秒），默认 3600 */
    expires: z.number().int().positive().default(3600).optional(),
})

/**
 * 批量图片签名 URL 响应
 */
interface BatchImageSignedUrlResponse {
    /** 签名 URL 映射：key 为 "bucket:ossFileId" */
    urls: Record<string, string>
    /** 失败的图片列表 */
    failed: Array<{
        bucket: string
        ossFileId: number
        error: string
    }>
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

    const { images, expires = 3600 } = bodyResult.data

    try {
        // 提取所有 ossFileId
        const ossFileIds = images.map(img => img.ossFileId)

        // 批量查询 OSS 文件记录
        const ossFiles = await prisma.ossFiles.findMany({
            where: {
                id: { in: ossFileIds },
                deletedAt: null,
            },
        })

        // 创建 ossFileId 到文件记录的映射
        const fileMap = new Map(ossFiles.map(f => [f.id, f]))

        // 过滤出存在的文件
        const validFiles = ossFiles.filter(f => {
            const requestedImage = images.find(img => img.ossFileId === f.id)
            // 验证 bucket 是否匹配
            return requestedImage && f.bucketName === requestedImage.bucket
        })

        // 生成签名 URL
        const signatureResults = await generateOssDownloadSignaturesService({
            ossFiles: validFiles,
            expires,
        })

        // 构建响应
        const urls: Record<string, string> = {}
        const failed: Array<{ bucket: string; ossFileId: number; error: string }> = []

        // 处理成功的签名
        for (const result of signatureResults) {
            const file = fileMap.get(result.ossFileId)
            if (file) {
                const key = `${file.bucketName}:${result.ossFileId}`
                urls[key] = result.downloadUrl
            }
        }

        // 处理失败的图片
        for (const image of images) {
            const key = `${image.bucket}:${image.ossFileId}`
            if (!urls[key]) {
                const file = fileMap.get(image.ossFileId)
                if (!file) {
                    failed.push({
                        bucket: image.bucket,
                        ossFileId: image.ossFileId,
                        error: '文件不存在',
                    })
                } else if (file.bucketName !== image.bucket) {
                    failed.push({
                        bucket: image.bucket,
                        ossFileId: image.ossFileId,
                        error: 'bucket 不匹配',
                    })
                } else {
                    failed.push({
                        bucket: image.bucket,
                        ossFileId: image.ossFileId,
                        error: '生成签名失败',
                    })
                }
            }
        }

        const response: BatchImageSignedUrlResponse = {
            urls,
            failed,
        }

        return resSuccess(event, '获取成功', response)
    } catch (error) {
        logger.error('批量获取图片签名 URL 失败:', error)
        return resError(event, 500, '获取签名 URL 失败')
    }
})
