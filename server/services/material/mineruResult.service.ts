/**
 * MinerU 识别结果处理服务
 *
 * 服务端下载和处理 MinerU 返回的 ZIP 文件
 * 提取 Markdown 内容和图片，上传图片到 OSS
 *
 * @requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

import JSZip from 'jszip'
import { marked } from 'marked'
import { v7 as uuidv7 } from 'uuid'
import { FileSource, OssFileStatus } from '#shared/types/file'
import { StorageProviderType, type AliyunPostSignatureResult } from '~~/server/lib/storage/types'
import { embedDocumentService } from '~~/server/services/material/materialEmbedding.service'

/** ZIP 中提取的图片信息 */
interface ExtractedImage {
    /** 图片在 ZIP 中的相对路径 */
    relativePath: string
    /** 图片文件名 */
    fileName: string
    /** 图片数据 */
    data: Buffer
    /** MIME 类型 */
    mimeType: string
}

/** 图片 OSS 信息 */
interface ImageOssInfo {
    bucket: string
    ossFileId: number
}

/** 处理结果 */
export interface MineruResultProcessResult {
    /** HTML 内容 */
    htmlContent: string
    /** Markdown 内容（图片已替换为占位符） */
    markdownContent: string
    /** 上传的图片数量 */
    imageCount: number
}

/** 支持的图片扩展名 */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']

/** 图片扩展名到 MIME 类型的映射 */
const MIME_TYPE_MAP: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
}

/**
 * 获取文件扩展名（小写）
 */
const getExtension = (filename: string): string => {
    const lastDot = filename.lastIndexOf('.')
    if (lastDot === -1) return ''
    return filename.slice(lastDot + 1).toLowerCase()
}

/**
 * 判断是否为图片文件
 */
const isImageFile = (filename: string): boolean => {
    const ext = getExtension(filename)
    return IMAGE_EXTENSIONS.includes(ext)
}

/**
 * 获取图片 MIME 类型
 */
const getImageMimeType = (filename: string): string => {
    const ext = getExtension(filename)
    return MIME_TYPE_MAP[ext] || 'application/octet-stream'
}

/**
 * 下载 MinerU 识别结果 ZIP 文件
 */
export async function downloadMineruZipService(downloadUrl: string): Promise<Buffer> {
    logger.info('开始下载 MinerU 识别结果', { url: downloadUrl.substring(0, 100) })

    const response = await $fetch<ArrayBuffer>(downloadUrl, {
        responseType: 'arrayBuffer',
        timeout: 60000, // 60 秒超时
    })

    logger.info('MinerU ZIP 文件下载完成', { size: response.byteLength })
    return Buffer.from(response)
}

/**
 * 从 ZIP 文件中提取 Markdown 和图片
 */
export async function extractMineruZipService(
    zipData: Buffer
): Promise<{ markdown: string; images: ExtractedImage[] }> {
    const zip = await JSZip.loadAsync(zipData)

    let markdown = ''
    const images: ExtractedImage[] = []

    for (const [filename, file] of Object.entries(zip.files)) {
        if (file.dir) continue

        // 查找 full.md 文件
        if (filename.endsWith('full.md') || filename === 'full.md') {
            markdown = await file.async('string')
            continue
        }

        // 提取图片文件
        if (isImageFile(filename)) {
            const data = await file.async('nodebuffer')
            const mimeType = getImageMimeType(filename)

            let relativePath = filename
            const imagesIndex = filename.indexOf('images/')
            if (imagesIndex !== -1) {
                relativePath = filename.slice(imagesIndex)
            }

            const lastSlash = filename.lastIndexOf('/')
            const fileName = lastSlash === -1 ? filename : filename.slice(lastSlash + 1)

            images.push({
                relativePath,
                fileName,
                data,
                mimeType,
            })
        }
    }

    if (!markdown) {
        throw new Error('ZIP 文件中未找到 full.md 文件')
    }

    logger.info('ZIP 文件解析完成', { markdownLength: markdown.length, imageCount: images.length })
    return { markdown, images }
}

/**
 * 上传单个图片到 OSS（服务端直传）
 */
async function uploadSingleImageToOssService(
    imageData: Buffer,
    fileName: string,
    mimeType: string,
    userId: number
): Promise<number | null> {
    const config = useRuntimeConfig()
    const storageConfig = config.storage
    const ossConfig = storageConfig.aliyunOss
    const bucket = ossConfig.bucket
    const basePath = storageConfig.basePath
    const dir = `${basePath}user${userId}/${FileSource.CASE_ANALYSIS}/`
    const callbackUrl = storageConfig.callbackUrl

    const saveName = `${uuidv7()}.${getExtension(fileName) || 'png'}`

    try {
        // 创建文件记录
        const ossFile = await prisma.ossFiles.create({
            data: {
                userId,
                bucketName: bucket,
                fileName,
                filePath: `${dir}${saveName}`,
                fileSize: imageData.length,
                fileType: mimeType,
                source: FileSource.CASE_ANALYSIS,
                status: OssFileStatus.PENDING,
                encrypted: false,
            },
        })

        // 生成签名
        const signature = await generatePostSignatureService({
            dir,
            fileKey: {
                originalFileName: fileName,
                strategy: 'custom',
                customFileName: saveName,
            },
            expirationMinutes: 10,
            callback: {
                callbackUrl,
                callbackBody: 'filename=${object}&size=${size}&mimeType=${mimeType}',
                callbackBodyType: 'application/x-www-form-urlencoded',
                callbackVar: {
                    user_id: userId,
                    source: FileSource.CASE_ANALYSIS,
                    original_file_name: fileName,
                    file_id: ossFile.id.toString(),
                    encrypted: '0',
                    original_mime_type: mimeType,
                },
            },
            conditions: {
                contentLengthRange: [0, 50 * 1024 * 1024], // 50MB
                contentType: [mimeType],
            },
            userId,
            type: StorageProviderType.ALIYUN_OSS,
        }) as AliyunPostSignatureResult

        // 构建 FormData
        const formData = new FormData()
        if (signature.key) {
            formData.append('key', signature.key)
        }
        formData.append('policy', signature.policy)
        formData.append('x-oss-signature-version', signature.signatureVersion)
        formData.append('x-oss-credential', signature.credential)
        formData.append('x-oss-date', signature.date)
        formData.append('x-oss-signature', signature.signature)
        if (signature.securityToken) {
            formData.append('x-oss-security-token', signature.securityToken)
        }
        if (signature.callback) {
            formData.append('callback', signature.callback)
        }
        if (signature.callbackVar) {
            for (const [key, value] of Object.entries(signature.callbackVar)) {
                formData.append(key, String(value))
            }
        }

        // 将 Buffer 转换为 Blob
        const blob = new Blob([new Uint8Array(imageData)], { type: mimeType })
        formData.append('file', blob, fileName)

        // 上传到 OSS
        const uploadResponse = await $fetch<{ code: number; data?: { fileId: number }; fileId?: number }>(
            signature.host,
            {
                method: 'POST',
                body: formData,
            }
        )

        const fileId = uploadResponse.data?.fileId || uploadResponse.fileId || ossFile.id
        return fileId
    } catch (error) {
        logger.error('上传图片到 OSS 失败', { fileName, error })
        return null
    }
}

/**
 * 上传图片到 OSS（服务端直传）
 */
export async function uploadImagesToOssService(
    images: ExtractedImage[],
    userId: number,
    docFileName?: string
): Promise<Map<string, ImageOssInfo>> {
    const imageMap = new Map<string, ImageOssInfo>()

    if (images.length === 0) {
        return imageMap
    }

    const filePrefix = docFileName
        ? docFileName.replace(/\.[^.]+$/, '')
        : 'mineru'

    logger.info('开始上传图片到 OSS', { count: images.length, prefix: filePrefix })

    for (let i = 0; i < images.length; i++) {
        const img = images[i]!
        try {
            const ext = getExtension(img.fileName) || 'png'
            const ossFileName = `${filePrefix}_mineru_${i + 1}.${ext}`

            const fileId = await uploadSingleImageToOssService(
                img.data,
                ossFileName,
                img.mimeType,
                userId
            )

            if (fileId) {
                imageMap.set(img.relativePath, {
                    bucket: 'lexseek-files',
                    ossFileId: fileId,
                })
                logger.debug(`图片上传成功: ${img.relativePath} -> ${fileId}`)
            }
        } catch (error) {
            logger.error(`图片上传失败: ${img.relativePath}`, error)
        }
    }

    logger.info('图片上传完成', { successCount: imageMap.size, totalCount: images.length })
    return imageMap
}

/**
 * 替换 Markdown 中的图片路径为 OSS 占位符
 */
export function replaceImagePathsService(
    markdown: string,
    imageMap: Map<string, ImageOssInfo>
): string {
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g

    return markdown.replace(imageRegex, (match, alt, path) => {
        const cleanPath = path.trim().replace(/^["']|["']$/g, '')

        let ossInfo = imageMap.get(cleanPath)

        if (!ossInfo) {
            const fileName = cleanPath.split('/').pop() || cleanPath
            for (const [mapPath, info] of imageMap) {
                const mapFileName = mapPath.split('/').pop() || mapPath
                if (mapFileName === fileName) {
                    ossInfo = info
                    break
                }
            }
        }

        if (ossInfo) {
            const placeholder = `{{OSS_IMAGE:${ossInfo.bucket}:${ossInfo.ossFileId}}}`
            return `![${alt}](${placeholder})`
        }

        return match
    })
}

/**
 * Markdown 转 HTML
 */
export async function markdownToHtmlService(markdown: string): Promise<string> {
    marked.setOptions({
        gfm: true,
        breaks: true,
    })

    return marked.parse(markdown)
}

/**
 * 完整处理 MinerU 识别结果
 * 下载 ZIP -> 解压 -> 上传图片 -> 替换路径 -> 转换 HTML -> 保存结果 -> 向量化嵌入
 */
export async function processMineruResultService(
    downloadUrl: string,
    ossFileId: number,
    userId: number,
    docFileName?: string
): Promise<MineruResultProcessResult> {
    logger.info('开始处理 MinerU 识别结果', { ossFileId, downloadUrl: downloadUrl.substring(0, 100) })

    // 1. 下载 ZIP 文件
    const zipData = await downloadMineruZipService(downloadUrl)

    // 2. 解压并提取内容
    const { markdown, images } = await extractMineruZipService(zipData)

    // 3. 上传图片到 OSS
    const imageMap = await uploadImagesToOssService(images, userId, docFileName)

    // 4. 替换图片路径
    const processedMarkdown = replaceImagePathsService(markdown, imageMap)

    // 5. 转换为 HTML
    const htmlContent = await markdownToHtmlService(processedMarkdown)

    // 6. 保存识别结果并进行向量化嵌入
    await saveDocRecognitionResultService(ossFileId, htmlContent, processedMarkdown, userId, docFileName)

    logger.info('MinerU 识别结果处理完成', { ossFileId, imageCount: imageMap.size })

    return {
        htmlContent,
        markdownContent: processedMarkdown,
        imageCount: imageMap.size,
    }
}

/**
 * 保存文档识别结果并进行向量化嵌入
 */
async function saveDocRecognitionResultService(
    ossFileId: number,
    htmlContent: string,
    markdownContent: string,
    userId: number,
    docFileName?: string
): Promise<void> {
    // 查找或创建识别记录
    const record = await findDocRecognitionByOssFileIdDao(ossFileId)

    let recordId: number

    if (record) {
        // 更新现有记录
        await updateDocRecognitionRecordDao(record.id, {
            htmlContent,
            markdownContent,
            status: 2, // 成功
        })
        recordId = record.id
    } else {
        // 如果没有记录，创建一个新的
        const newRecord = await prisma.docRecognitionRecords.create({
            data: {
                ossFileId,
                htmlContent,
                markdownContent,
                status: 2, // 成功
                userId,
            },
        })
        recordId = newRecord.id
    }

    // 进行向量化嵌入
    try {
        // 获取原始文件名（如果没有传入，则从 OSS 文件记录获取）
        let fileName = docFileName
        if (!fileName) {
            const ossFile = await prisma.ossFiles.findUnique({
                where: { id: ossFileId },
                select: { fileName: true },
            })
            fileName = ossFile?.fileName || `document_${ossFileId}`
        }

        const embeddingResult = await embedDocumentService({
            content: markdownContent,
            userId,
            ossFileId,
            fileName,
        })

        // 更新识别记录的向量 ID 和嵌入时间
        await updateDocRecognitionRecordDao(recordId, {
            vectorIds: embeddingResult.ids,
            lastEmbeddingAt: new Date(embeddingResult.lastEmbeddingAt),
        })

        logger.info('文档向量化嵌入完成', {
            ossFileId,
            chunkCount: embeddingResult.chunkCount,
            vectorIds: embeddingResult.ids.length,
        })

        // 更新 case_materials 表的 embedding_status
        try {
            const { findMaterialsByOssFileIdDAO, updateMaterialEmbeddingStatusDAO } = await import('../case/caseMaterial.dao')
            const materials = await findMaterialsByOssFileIdDAO(ossFileId)
            for (const material of materials) {
                await updateMaterialEmbeddingStatusDAO(material.id, 'completed')
                logger.info(`更新材料 ${material.id} 的 embedding_status 为 completed`)
            }
        } catch (updateError: any) {
            // 更新失败不影响主流程
            logger.warn('更新 case_materials embedding_status 失败', {
                ossFileId,
                error: updateError.message,
            })
        }
    } catch (embeddingError) {
        // 嵌入失败不影响识别结果保存，只记录错误
        logger.error('文档向量化嵌入失败', { ossFileId, error: embeddingError })

        // 更新 case_materials 表的 embedding_status 为 failed
        try {
            const { findMaterialsByOssFileIdDAO, updateMaterialEmbeddingStatusDAO } = await import('../case/caseMaterial.dao')
            const materials = await findMaterialsByOssFileIdDAO(ossFileId)
            for (const material of materials) {
                await updateMaterialEmbeddingStatusDAO(material.id, 'failed')
            }
        } catch (updateError: any) {
            logger.warn('更新 case_materials embedding_status 失败', {
                ossFileId,
                error: updateError.message,
            })
        }
    }
}
