/**
 * 检查文档识别状态 API
 *
 * GET /api/v1/recognition/doc/status/:ossFileId
 *
 * 检查指定 OSS 文件的识别状态，返回是否已识别及识别记录详情
 * 返回的 htmlContent 和 markdownContent 中的图片占位符会被替换为 OSS 签名 URL
 *
 * @requirements 1.1, 1.2, 1.3, 1.4
 */

import { z } from 'zod'
import { DocRecognitionStatus } from '~~/server/services/material/mineru.service'
import { generateOssDownloadSignaturesService } from '~~/server/services/files/files.service'

/** 图片占位符正则表达式 */
const IMAGE_PLACEHOLDER_REGEX = /\{\{OSS_IMAGE:([^:}]+):(\d+)\}\}/g

// 路由参数验证
const paramsSchema = z.object({
    ossFileId: z.string().regex(/^\d+$/, 'ossFileId 必须是数字').transform(Number),
})

/**
 * 识别状态响应
 */
interface CheckStatusResponse {
    /** 是否已识别成功 */
    recognized: boolean
    /** 识别状态：0-待处理，1-处理中，2-成功，3-失败 */
    status?: number
    /** 识别记录（如果存在） */
    record?: {
        id: number
        htmlContent?: string | null
        markdownContent?: string | null
        vectorIds?: string[]
        lastEmbeddingAt?: string | null
    }
}

/**
 * 解析内容中的图片占位符
 * @param content 包含占位符的内容
 * @returns 占位符信息列表 { bucket, ossFileId }
 */
function parseImagePlaceholders(content: string): Array<{ bucket: string; ossFileId: number }> {
    const placeholders: Array<{ bucket: string; ossFileId: number }> = []
    const seen = new Set<string>()

    let match
    IMAGE_PLACEHOLDER_REGEX.lastIndex = 0

    while ((match = IMAGE_PLACEHOLDER_REGEX.exec(content)) !== null) {
        const bucket = match[1]!
        const ossFileId = parseInt(match[2]!, 10)
        const key = `${bucket}:${ossFileId}`

        if (!seen.has(key)) {
            seen.add(key)
            placeholders.push({ bucket, ossFileId })
        }
    }

    return placeholders
}

/**
 * 替换内容中的图片占位符为签名 URL
 * @param content 包含占位符的内容
 * @param urlMap bucket:ossFileId 到 URL 的映射
 * @returns 替换后的内容
 */
function replaceImagePlaceholders(content: string, urlMap: Map<string, string>): string {
    return content.replace(IMAGE_PLACEHOLDER_REGEX, (match, bucket, ossFileId) => {
        const key = `${bucket}:${ossFileId}`
        return urlMap.get(key) || match
    })
}

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 验证路由参数
    const params = getRouterParams(event)
    const paramsResult = paramsSchema.safeParse(params)
    if (!paramsResult.success) {
        return resError(event, 400, paramsResult.error.issues[0]?.message || '参数错误')
    }

    const { ossFileId } = paramsResult.data

    try {
        // 查询识别记录
        const record = await findDocRecognitionByOssFileIdDao(ossFileId)

        // 如果不存在记录
        if (!record) {
            return resSuccess(event, '查询成功', {
                recognized: false,
            } as CheckStatusResponse)
        }

        // 根据状态判断是否已识别
        const isRecognized = record.status === DocRecognitionStatus.SUCCESS

        // 构建响应
        const response: CheckStatusResponse = {
            recognized: isRecognized,
            status: record.status,
        }

        // 如果存在记录，返回详情
        if (record) {
            let htmlContent = record.htmlContent || ''
            let markdownContent = record.markdownContent || ''

            // 如果已识别成功且有内容，替换图片占位符为签名 URL
            if (isRecognized && (htmlContent || markdownContent)) {
                // 解析所有占位符
                const allContent = `${htmlContent}${markdownContent}`
                const placeholders = parseImagePlaceholders(allContent)

                if (placeholders.length > 0) {
                    // 查询 OSS 文件记录
                    const ossFileIds = placeholders.map(p => p.ossFileId)
                    const ossFiles = await prisma.ossFiles.findMany({
                        where: {
                            id: { in: ossFileIds },
                            deletedAt: null,
                        },
                    })

                    // 过滤出 bucket 匹配的文件
                    const validFiles = ossFiles.filter(f => {
                        const placeholder = placeholders.find(p => p.ossFileId === f.id)
                        return placeholder && f.bucketName === placeholder.bucket
                    })

                    if (validFiles.length > 0) {
                        // 生成签名 URL
                        const signatureResults = await generateOssDownloadSignaturesService({
                            ossFiles: validFiles,
                            expires: 3600,
                        })

                        // 构建 URL 映射
                        const urlMap = new Map<string, string>()
                        for (const result of signatureResults) {
                            const file = ossFiles.find(f => f.id === result.ossFileId)
                            if (file) {
                                const key = `${file.bucketName}:${result.ossFileId}`
                                urlMap.set(key, result.downloadUrl)
                            }
                        }

                        // 替换占位符
                        if (urlMap.size > 0) {
                            htmlContent = replaceImagePlaceholders(htmlContent, urlMap)
                            markdownContent = replaceImagePlaceholders(markdownContent, urlMap)
                        }
                    }
                }
            }

            response.record = {
                id: record.id,
                htmlContent,
                markdownContent,
                vectorIds: (record.vectorIds as string[]) || [],
                lastEmbeddingAt: record.lastEmbeddingAt?.toISOString() || null,
            }
        }

        return resSuccess(event, '查询成功', response)
    } catch (error) {
        logger.error('查询文档识别状态失败:', error)
        return resError(event, 500, '查询识别状态失败')
    }
})
