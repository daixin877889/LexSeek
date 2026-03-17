/**
 * 图片处理工具
 *
 * 提供统一的图片处理功能，支持：
 * - base64 图片：解码后上传到 OSS
 * - URL 图片：下载后上传到 OSS
 * 替换为占位符 {{OSS_IMAGE:bucket:ossFileId}}
 */

import { uploadFileService } from '../storage/storage.service'
import { FileSource, OssFileStatus } from '#shared/types/file'
import { v4 as uuidv4 } from 'uuid'
import { $fetch as ofetch } from 'ofetch'

/** 图片上传结果 */
interface ImageUploadResult {
    /** bucket 名称 */
    bucket: string
    /** OSS 文件 ID */
    ossFileId: number
}

/**
 * 从 URL 下载图片
 * @param imageUrl 图片 URL
 * @returns 图片 buffer 和 MIME 类型
 */
async function downloadImageFromUrl(imageUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
    try {
        const response = await ofetch(imageUrl, {
            responseType: 'arrayBuffer',
        })

        const buffer = Buffer.from(response)

        // 从 URL 推断 MIME 类型
        let mimeType = 'image/png'
        const urlLower = imageUrl.toLowerCase()
        if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) {
            mimeType = 'image/jpeg'
        } else if (urlLower.endsWith('.gif')) {
            mimeType = 'image/gif'
        } else if (urlLower.endsWith('.webp')) {
            mimeType = 'image/webp'
        } else if (urlLower.endsWith('.svg')) {
            mimeType = 'image/svg+xml'
        } else if (urlLower.endsWith('.bmp')) {
            mimeType = 'image/bmp'
        } else if (urlLower.endsWith('.ico')) {
            mimeType = 'image/x-icon'
        }

        return {
            buffer,
            mimeType,
        }
    } catch (error) {
        logger.error(`下载图片失败: ${imageUrl}`, error)
        throw error
    }
}

/**
 * 上传图片到 OSS
 * @param imageBuffer 图片 buffer
 * @param mimeType MIME 类型
 * @param userId 用户 ID
 * @param docFileName 文档文件名（用于生成 OSS 文件名）
 * @param customPath 自定义路径（可选）
 * @returns OSS 信息
 */
async function uploadImageToOss(
    imageBuffer: Buffer,
    mimeType: string,
    userId: number,
    docFileName: string,
    customPath?: string
): Promise<ImageUploadResult | null> {
    const config = useRuntimeConfig()
    const storageConfig = config.storage
    const ossConfig = storageConfig.aliyunOss
    const bucket = ossConfig.bucket
    const basePath = storageConfig.basePath

    // 使用自定义路径或生成默认路径
    const dir = customPath || `${basePath}user${userId}/${FileSource.CASE_ANALYSIS}/`

    const ext = mimeType.split('/').pop() || 'png'
    const saveName = `${uuidv4()}.${ext}`

    try {
        // 1. 先创建 OSS 文件记录
        const ossFile = await prisma.ossFiles.create({
            data: {
                userId,
                bucketName: bucket,
                fileName: `${docFileName}_image_${Date.now()}.${ext}`,
                filePath: `${dir}${saveName}`,
                fileSize: imageBuffer.length,
                fileType: mimeType,
                source: FileSource.CASE_ANALYSIS,
                status: OssFileStatus.PENDING,
                encrypted: false,
            },
        })

        // 2. 上传文件
        await uploadFileService(`${dir}${saveName}`, imageBuffer, {
            contentType: mimeType,
        })

        return {
            bucket,
            ossFileId: ossFile.id,
        }
    } catch (error) {
        logger.error(`上传图片到 OSS 失败，buffer大小: ${imageBuffer?.length}, 错误:`, error)
        return null
    }
}

/**
 * 处理 Markdown 中的所有图片（base64 + URL）
 * - base64 图片：解码后上传到 OSS
 * - URL 图片：下载后上传到 OSS
 *
 * @param markdown Markdown 内容
 * @param userId 用户 ID
 * @param docFileName 文档文件名（用于生成 OSS 文件名）
 * @returns 处理后的 Markdown 内容
 */
export async function processAllImagesInMarkdown(
    markdown: string,
    userId: number,
    docFileName: string
): Promise<string> {
    let result = markdown

    // 1. 处理 base64 图片
    const base64ImageRegex = /!\[([^\]]*)\]\(data:([^;]+);base64,([^)]+)\)/g
    let match: RegExpExecArray | null

    base64ImageRegex.lastIndex = 0

    while ((match = base64ImageRegex.exec(markdown)) !== null) {
        const altText = match[1]
        const mimeType = match[2]
        const base64Data = match[3]

        try {
            const imageBuffer = Buffer.from(base64Data, 'base64')
            const ossInfo = await uploadImageToOss(imageBuffer, mimeType, userId, docFileName)

            if (ossInfo) {
                const placeholder = `{{OSS_IMAGE:${ossInfo.bucket}:${ossInfo.ossFileId}}}`
                result = result.replace(match[0], `![${altText}](${placeholder})`)
                logger.debug(`处理 base64 图片成功: ${altText}`)
            }
        } catch (error) {
            logger.error('处理 base64 图片失败', error)
        }
    }

    // 2. 处理 URL 图片
    // 匹配格式: ![alt](http://xxx.com/image.png) 或 ![alt](https://xxx.com/image.png)
    // 排除已处理的 base64 图片和已生成的占位符
    const urlImageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g
    urlImageRegex.lastIndex = 0

    while ((match = urlImageRegex.exec(markdown)) !== null) {
        const altText = match[1]
        const imageUrl = match[ 2]

        //跳过 base64 图片（data:开头）和已处理的占位符
        if (imageUrl.startsWith('data:') || imageUrl.includes('{{OSS_IMAGE:')) {
            continue
        }

        try {
            const { buffer, mimeType } = await downloadImageFromUrl(imageUrl)
            const ossInfo = await uploadImageToOss(buffer, mimeType, userId, docFileName)

            if (ossInfo) {
                const placeholder = `{{OSS_IMAGE:${ossInfo.bucket}:${ossInfo.ossFileId}}}`
                result = result.replace(match[0], `![${altText}](${placeholder})`)
                logger.debug(`处理 URL 图片成功: ${imageUrl}`)
            }
        } catch (error) {
            logger.error(`处理 URL 图片失败: ${imageUrl}`, error)
        }
    }

    return result
}

/**
 * 处理 Markdown 中的 URL 图片（仅 URL，不处理 base64）
 * 用于需要单独处理 URL 场景的场景
 *
 * @param markdown Markdown 内容
 * @param userId 用户 ID
 * @param docFileName 文档文件名
 * @returns 处理后的 Markdown 内容
 */
export async function processUrlImagesInMarkdown(
    markdown: string,
    userId: number,
    docFileName: string
): Promise<string> {
    let result = markdown

    // 匹配 URL 图片
    const urlImageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g
    let match: RegExpExecArray | null

    urlImageRegex.lastIndex = 0

    while ((match = urlImageRegex.exec(markdown)) !== null) {
        const altText = match[1]
        const imageUrl = match[2]

        // 跳过 base64 图片和已处理的占位符
        if (imageUrl.startsWith('data:') || imageUrl.includes('{{OSS_IMAGE:')) {
            continue
        }

        try {
            const { buffer, mimeType } = await downloadImageFromUrl(imageUrl)
            const ossInfo = await uploadImageToOss(buffer, mimeType, userId, docFileName)

            if (ossInfo) {
                const placeholder = `{{OSS_IMAGE:${ossInfo.bucket}:${ossInfo.ossFileId}}}`
                result = result.replace(match[0], `![${altText}](${placeholder})`)
                logger.debug(`处理 URL 图片成功: ${imageUrl}`)
            }
        } catch (error) {
            logger.error(`处理 URL 图片失败: ${imageUrl}`, error)
        }
    }

    return result
}
