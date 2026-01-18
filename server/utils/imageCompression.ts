/**
 * 图片压缩工具
 *
 * 用于压缩大尺寸图片，确保符合 AI 服务的大小限制
 */

import sharp from 'sharp'

/** 图片压缩选项 */
export interface ImageCompressionOptions {
    /** 最大文件大小（字节），默认 10MB */
    maxSizeBytes?: number
    /** 最大宽度（像素），默认 2048 */
    maxWidth?: number
    /** 最大高度（像素），默认 2048 */
    maxHeight?: number
    /** 压缩质量（1-100），默认 85 */
    quality?: number
}

/** 默认压缩选项 */
const DEFAULT_OPTIONS: Required<ImageCompressionOptions> = {
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    maxWidth: 2048,
    maxHeight: 2048,
    quality: 85,
}

/**
 * 获取 logger 实例（兼容测试环境）
 */
function getLogger() {
    // 在服务端环境使用 logger，测试环境使用 console
    if (typeof logger !== 'undefined') {
        return logger
    }
    return console
}

/**
 * 压缩图片
 * @param buffer 原始图片 Buffer
 * @param mimeType 图片 MIME 类型
 * @param options 压缩选项
 * @returns 压缩后的图片 Buffer 和 MIME 类型
 */
export async function compressImage(
    buffer: Buffer,
    mimeType: string,
    options: ImageCompressionOptions = {}
): Promise<{ buffer: Buffer; mimeType: string }> {
    const opts = { ...DEFAULT_OPTIONS, ...options }

    try {
        // 使用 sharp 处理图片
        let image = sharp(buffer)

        // 获取图片元数据（用于验证格式和获取尺寸）
        let metadata
        try {
            metadata = await image.metadata()
        } catch (metadataError: any) {
            // 如果无法读取元数据，尝试强制转换为 JPEG
            getLogger().warn('无法读取图片元数据，尝试强制转换', {
                error: metadataError.message,
                mimeType,
                bufferSize: buffer.length,
                // 输出 buffer 的前几个字节用于调试
                bufferHeader: buffer.slice(0, 16).toString('hex'),
            })

            // 对于 HEIC/HEIF 或其他特殊格式，先转换为 JPEG
            try {
                const convertedBuffer = await sharp(buffer)
                    .jpeg({ quality: 90 })
                    .toBuffer()

                getLogger().info('图片格式转换成功', {
                    originalSize: buffer.length,
                    convertedSize: convertedBuffer.length,
                })

                // 递归调用，使用转换后的 JPEG
                return await compressImage(convertedBuffer, 'image/jpeg', options)
            } catch (convertError: any) {
                getLogger().error('图片格式转换失败', {
                    error: convertError.message,
                    mimeType,
                    bufferSize: buffer.length,
                    bufferHeader: buffer.slice(0, 16).toString('hex'),
                })
                throw new Error(`不支持的图片格式 (${mimeType}): ${convertError.message}`)
            }
        }

        // 计算缩放比例
        let needsResize = false
        if (metadata.width && metadata.height) {
            if (metadata.width > opts.maxWidth || metadata.height > opts.maxHeight) {
                needsResize = true
            }
        }

        // 应用缩放
        if (needsResize) {
            image = image.resize({
                width: opts.maxWidth,
                height: opts.maxHeight,
                fit: 'inside', // 保持宽高比
                withoutEnlargement: true, // 不放大小图
            })
        }

        // 根据原始格式选择输出格式
        let outputBuffer: Buffer
        let outputMimeType: string

        if (mimeType === 'image/png') {
            // PNG 格式
            outputBuffer = await image
                .png({
                    quality: opts.quality,
                    compressionLevel: 9,
                })
                .toBuffer()
            outputMimeType = 'image/png'
        } else if (mimeType === 'image/webp') {
            // WebP 格式
            outputBuffer = await image
                .webp({
                    quality: opts.quality,
                })
                .toBuffer()
            outputMimeType = 'image/webp'
        } else {
            // 其他格式转为 JPEG
            outputBuffer = await image
                .jpeg({
                    quality: opts.quality,
                    mozjpeg: true, // 使用 mozjpeg 获得更好的压缩
                })
                .toBuffer()
            outputMimeType = 'image/jpeg'
        }

        // 如果图片已经小于限制，直接返回
        if (buffer.length <= opts.maxSizeBytes && !needsResize) {
            return { buffer, mimeType }
        }

        // 如果压缩后仍然超过限制，降低质量重试
        if (outputBuffer.length > opts.maxSizeBytes && opts.quality > 50) {
            getLogger().info('首次压缩后仍超限，降低质量重试', {
                currentSize: outputBuffer.length,
                currentQuality: opts.quality,
            })

            return compressImage(buffer, mimeType, {
                ...options,
                quality: Math.max(50, opts.quality - 15),
            })
        }

        getLogger().info('图片压缩完成', {
            originalSize: buffer.length,
            compressedSize: outputBuffer.length,
            compressionRatio: ((1 - outputBuffer.length / buffer.length) * 100).toFixed(2) + '%',
            outputMimeType,
        })

        return {
            buffer: outputBuffer,
            mimeType: outputMimeType,
        }
    } catch (error: any) {
        getLogger().error('图片压缩失败', {
            error: error.message,
            originalSize: buffer.length,
        })
        throw new Error(`图片压缩失败: ${error.message}`)
    }
}

/**
 * 从 base64 字符串压缩图片
 * @param base64Data base64 图片数据（不含前缀）
 * @param mimeType 图片 MIME 类型
 * @param options 压缩选项
 * @returns 压缩后的 base64 数据和 MIME 类型
 */
export async function compressImageFromBase64(
    base64Data: string,
    mimeType: string,
    options: ImageCompressionOptions = {}
): Promise<{ base64Data: string; mimeType: string }> {
    try {
        // 检查 base64 数据是否包含 data URL 前缀
        if (base64Data.startsWith('data:')) {
            throw new Error('base64Data 不应包含 data URL 前缀，请只传递纯 base64 字符串')
        }

        // 清理 base64 数据（移除可能的空格、换行等）
        const cleanBase64 = base64Data.replace(/\s/g, '')

        // 验证 base64 格式
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleanBase64)) {
            throw new Error('无效的 base64 格式')
        }

        // 将 base64 转换为 Buffer
        const buffer = Buffer.from(cleanBase64, 'base64')

        // 验证解码后的数据大小是否合理
        if (buffer.length === 0) {
            throw new Error('base64 解码后数据为空')
        }

        getLogger().info('开始压缩 base64 图片', {
            originalBase64Length: base64Data.length,
            cleanBase64Length: cleanBase64.length,
            bufferSize: buffer.length,
            mimeType,
        })

        // 压缩图片
        const result = await compressImage(buffer, mimeType, options)

        // 转回 base64
        return {
            base64Data: result.buffer.toString('base64'),
            mimeType: result.mimeType,
        }
    } catch (error: any) {
        getLogger().error('从 base64 压缩图片失败', {
            error: error.message,
            mimeType,
            base64Length: base64Data?.length || 0,
            base64Preview: base64Data?.substring(0, 100) || '',
        })
        throw error
    }
}

/**
 * 从 URL 下载并压缩图片
 * @param url 图片 URL
 * @param options 压缩选项
 * @returns 压缩后的 Buffer 和 MIME 类型
 */
export async function compressImageFromUrl(
    url: string,
    options: ImageCompressionOptions = {}
): Promise<{ buffer: Buffer; mimeType: string }> {
    try {
        // 下载图片
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`下载图片失败: ${response.status}`)
        }

        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const mimeType = response.headers.get('content-type') || 'image/jpeg'

        // 压缩图片
        return await compressImage(buffer, mimeType, options)
    } catch (error: any) {
        getLogger().error('从 URL 下载并压缩图片失败', {
            url: url.substring(0, 100),
            error: error.message,
        })
        throw new Error(`从 URL 下载并压缩图片失败: ${error.message}`)
    }
}
