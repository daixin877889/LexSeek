/**
 * 文档识别 Composable
 *
 * 浏览器端文档文件识别核心逻辑，支持 docx、markdown 和 txt 文件
 * 整合文件读取、图片上传、结果保存
 *
 * @requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 4.1, 6.2, 6.3, 6.4
 */

import type { DocxExtractResult, ExtractedImage, MarkdownExtractResult } from './useFileReader'
import { FileSource } from '#shared/types/file'
import { getExtensionFromFileName } from '~~/shared/utils/file'

/** 识别状态类型 */
export type RecognitionStatusType =
    | 'idle'
    | 'checking'
    | 'downloading'
    | 'decrypting'
    | 'recognizing'
    | 'uploading'
    | 'submitting'
    | 'success'
    | 'error'

/** 识别状态 */
export interface RecognitionStatus {
    /** 状态 */
    status: RecognitionStatusType
    /** 进度百分比 (0-100) */
    progress: number
    /** 错误信息 */
    error?: string
}

/** 识别选项 */
export interface DocxRecognitionOptions {
    /** OSS 文件 ID */
    ossFileId: number
    /** 原始文件名（用于图片命名前缀和文件类型判断） */
    fileName?: string
    /** 本地文件（如果是刚上传的） */
    localFile?: File
    /** 是否加密 */
    encrypted?: boolean
    /** 文件下载 URL（如果需要从 OSS 下载） */
    downloadUrl?: string
    /** 文件 MIME 类型 */
    mimeType?: string
    /** bucket 名称 */
    bucket?: string
}

/** 支持的文档扩展名 */
const DOCX_EXTENSIONS = ['docx', 'doc']
const MARKDOWN_EXTENSIONS = ['md', 'mkd', 'markdown']
const TXT_EXTENSIONS = ['txt']

/**
 * 判断是否为 docx 文件
 */
const isDocxFile = (fileName: string): boolean => {
    const ext = getExtensionFromFileName(fileName)
    return DOCX_EXTENSIONS.includes(ext)
}

/**
 * 判断是否为 markdown 文件
 */
const isMarkdownFile = (fileName: string): boolean => {
    const ext = getExtensionFromFileName(fileName)
    return MARKDOWN_EXTENSIONS.includes(ext)
}

/**
 * 判断是否为 txt 文件
 */
const isTxtFile = (fileName: string): boolean => {
    const ext = getExtensionFromFileName(fileName)
    return TXT_EXTENSIONS.includes(ext)
}

/** 识别结果 */
export interface DocxRecognitionResult {
    /** HTML 内容（图片已替换为占位符） */
    htmlContent: string
    /** Markdown 内容（图片已替换为占位符） */
    markdownContent: string
    /** 上传的图片数量 */
    imageCount: number
}

/** 识别状态检查响应 */
interface CheckStatusResponse {
    recognized: boolean
    status?: number
    record?: {
        id: number
        htmlContent?: string | null
        markdownContent?: string | null
        vectorIds?: string[]
        lastEmbeddingAt?: string | null
    }
}

/** 保存识别结果响应 */
interface SaveRecognitionResponse {
    id: number
    vectorIds: string[]
    lastEmbeddingAt: string | null
}

/**
 * 图片占位符格式
 * {{OSS_IMAGE:bucket:ossFileId}}
 */
const createImagePlaceholder = (bucket: string, ossFileId: number): string => {
    return `{{OSS_IMAGE:${bucket}:${ossFileId}}}`
}

/**
 * 将内部图片占位符转换为 OSS 图片占位符
 * 同时处理普通占位符和各种 URL 编码的占位符（HTML 中的 src 属性可能被部分编码）
 */
const replaceImagePlaceholders = (
    content: string,
    imageMap: Map<string, { bucket: string; ossFileId: number }>
): string => {
    let result = content
    for (const [placeholderId, ossInfo] of imageMap) {
        const internalPlaceholder = `{{IMAGE_PLACEHOLDER:${placeholderId}}}`
        const ossPlaceholder = createImagePlaceholder(ossInfo.bucket, ossInfo.ossFileId)

        // 替换普通占位符（Markdown 中）
        result = result.replaceAll(internalPlaceholder, ossPlaceholder)

        // 替换部分编码的占位符（HTML 中，只有花括号被编码）
        // %7B = {, %7D = }
        const partialEncodedPlaceholder = `%7B%7BIMAGE_PLACEHOLDER:${placeholderId}%7D%7D`
        result = result.replaceAll(partialEncodedPlaceholder, ossPlaceholder)

        // 替换完全编码的占位符（以防万一）
        const fullyEncodedPlaceholder = encodeURIComponent(internalPlaceholder)
        result = result.replaceAll(fullyEncodedPlaceholder, ossPlaceholder)
    }
    return result
}

/**
 * 文档识别 Composable
 */
export const useDocxRecognition = () => {
    const { extractDocx, extractMarkdown } = useFileReader()
    const { cacheFile, getCachedFile } = useLocalFileCache()
    const ageCrypto = useAgeCrypto()
    const fileStore = useFileStore()

    // 识别状态
    const status = ref<RecognitionStatus>({
        status: 'idle',
        progress: 0,
    })

    /**
     * 更新状态
     */
    const updateStatus = (
        newStatus: RecognitionStatusType,
        progress: number,
        error?: string
    ) => {
        status.value = { status: newStatus, progress, error }
    }

    /**
     * 检查文件是否已识别
     * @param ossFileId OSS 文件 ID
     * @returns 识别状态和记录
     */
    const checkRecognitionStatus = async (
        ossFileId: number
    ): Promise<{
        recognized: boolean
        processing: boolean
        record?: CheckStatusResponse['record']
    }> => {
        updateStatus('checking', 10)

        try {
            const response = await useApiFetch<CheckStatusResponse>(
                `/api/v1/recognition/doc/status/${ossFileId}`,
                { showError: false }
            )

            if (!response) {
                return { recognized: false, processing: false }
            }

            // 状态 1 表示处理中
            const processing = response.status === 1

            return {
                recognized: response.recognized,
                processing,
                record: response.record,
            }
        } catch (error) {
            console.error('检查识别状态失败:', error)
            return { recognized: false, processing: false }
        }
    }

    /**
     * 获取文件内容
     * 优先从缓存读取，否则从 OSS 下载
     * @returns ArrayBuffer 格式的文件内容
     */
    const getFileContent = async (
        options: DocxRecognitionOptions
    ): Promise<ArrayBuffer> => {
        const { ossFileId, localFile, encrypted, downloadUrl, mimeType } = options

        // 1. 如果有本地文件，直接使用
        if (localFile) {
            // 缓存本地文件
            await cacheFile(ossFileId, localFile)
            return localFile.arrayBuffer()
        }

        // 2. 尝试从缓存读取
        updateStatus('downloading', 20)
        const cached = await getCachedFile(ossFileId)
        if (cached) {
            return cached
        }

        // 3. 从 OSS 下载
        if (!downloadUrl) {
            throw new Error('无法获取文件：缺少下载 URL')
        }

        const response = await fetch(downloadUrl)
        if (!response.ok) {
            throw new Error(`下载文件失败: ${response.status}`)
        }

        let content = await response.arrayBuffer()

        // 4. 如果文件加密，需要解密
        if (encrypted) {
            updateStatus('decrypting', 30)

            // 先尝试恢复私钥状态（从 IndexedDB）
            await ageCrypto.restoreIdentity()

            // 检查解锁状态
            if (!ageCrypto.isUnlocked.value) {
                throw new Error('文件已加密，请先解锁私钥')
            }

            content = await ageCrypto.decryptFile(content)
        }

        // 5. 缓存下载的文件
        const blob = new Blob([content], { type: mimeType || 'application/octet-stream' })
        const file = new File([blob], `file_${ossFileId}`, { type: blob.type })
        await cacheFile(ossFileId, file)

        return content
    }

    /**
     * 获取文件文本内容（用于 markdown 文件）
     * @returns 文本格式的文件内容
     */
    const getFileTextContent = async (
        options: DocxRecognitionOptions
    ): Promise<string> => {
        const arrayBuffer = await getFileContent(options)
        const decoder = new TextDecoder('utf-8')
        return decoder.decode(arrayBuffer)
    }

    /**
         * 从文件名中提取不带扩展名的基础名称
         * @param fileName 完整文件名
         * @returns 不带扩展名的文件名
         */
    const getFileBaseName = (fileName: string): string => {
        const lastDotIndex = fileName.lastIndexOf('.')
        if (lastDotIndex > 0) {
            return fileName.substring(0, lastDotIndex)
        }
        return fileName
    }

    /**
     * 上传图片到 OSS
     * @param images 提取的图片列表
     * @param bucket 目标 bucket
     * @param docFileName 原始文档文件名（用于图片命名前缀）
     * @returns 图片占位符 ID 到 OSS 信息的映射
     */
    const uploadImages = async (
        images: ExtractedImage[],
        bucket: string,
        docFileName?: string
    ): Promise<Map<string, { bucket: string; ossFileId: number }>> => {
        const imageMap = new Map<string, { bucket: string; ossFileId: number }>()

        if (images.length === 0) {
            return imageMap
        }

        updateStatus('uploading', 50)

        // 获取文档基础名称作为图片前缀
        const filePrefix = docFileName ? getFileBaseName(docFileName) : 'docx'

        // 准备上传文件信息
        const fileInfos = images.map((img, index) => {
            const ext = img.mimeType.split('/')[1] || 'png'
            return {
                // 使用原始文档名称作为前缀，例如：证据_docx_image_1.png
                originalFileName: `${filePrefix}_docx_image_${index + 1}.${ext}`,
                fileSize: Math.ceil(img.base64.length * 0.75), // base64 大小估算
                mimeType: img.mimeType,
            }
        })

        // 批量获取预签名 URL
        const signatures = await fileStore.getBatchPresignedUrls({
            source: FileSource.CASE_ANALYSIS,
            files: fileInfos,
            encrypted: false,
        })

        if (!signatures || signatures.length !== images.length) {
            console.error('获取预签名 URL 失败')
            return imageMap
        }

        // 并行上传图片
        const uploadPromises = images.map(async (img, index) => {
            const signature = signatures[index]
            if (!signature) return

            try {
                // 将 base64 转换为 Blob
                const byteCharacters = atob(img.base64)
                const byteNumbers = new Array(byteCharacters.length)
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i)
                }
                const byteArray = new Uint8Array(byteNumbers)
                const blob = new Blob([byteArray], { type: img.mimeType })

                // 构建 FormData（使用 V4 签名格式）
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
                // 添加回调自定义变量（需要遍历添加每个键值对）
                if (signature.callbackVar) {
                    for (const [key, value] of Object.entries(signature.callbackVar)) {
                        formData.append(key, value)
                    }
                }
                formData.append('file', blob)

                // 上传到 OSS
                const uploadResponse = await fetch(signature.host, {
                    method: 'POST',
                    body: formData,
                })

                if (uploadResponse.ok) {
                    const result = await uploadResponse.json()
                    console.log(`图片 ${index} 上传响应:`, result)
                    // OSS 回调返回的数据结构可能是 { code, data: { fileId } } 或直接 { fileId }
                    const fileId = result.data?.fileId || result.fileId
                    if (fileId) {
                        imageMap.set(img.placeholderId, {
                            bucket,
                            ossFileId: fileId,
                        })
                        console.log(`图片 ${index} 上传成功, placeholderId: ${img.placeholderId}, ossFileId: ${fileId}`)
                    } else {
                        console.error(`图片 ${index} 上传响应中没有 fileId:`, result)
                    }
                } else {
                    console.error(`图片 ${index} 上传失败, status: ${uploadResponse.status}`)
                }
            } catch (error) {
                console.error(`上传图片 ${index} 失败:`, error)
            }

            // 更新进度
            const progress = 50 + Math.round(((index + 1) / images.length) * 30)
            updateStatus('uploading', progress)
        })

        await Promise.all(uploadPromises)

        return imageMap
    }

    /**
     * 保存识别结果到服务端
     */
    const saveRecognitionResult = async (
        ossFileId: number,
        htmlContent: string,
        markdownContent: string,
        fileName?: string
    ): Promise<SaveRecognitionResponse | null> => {
        updateStatus('submitting', 90)

        try {
            const response = await useApiFetch<SaveRecognitionResponse>(
                '/api/v1/recognition/doc/save',
                {
                    method: 'POST',
                    body: {
                        ossFileId,
                        htmlContent,
                        markdownContent,
                        fileName,
                    },
                    showError: true,
                }
            )

            return response
        } catch (error) {
            console.error('保存识别结果失败:', error)
            return null
        }
    }

    /**
     * 执行文档识别（支持 docx 和 markdown）
     * @param options 识别选项
     * @returns 识别结果
     */
    const recognize = async (
        options: DocxRecognitionOptions
    ): Promise<DocxRecognitionResult> => {
        const { ossFileId, bucket = 'lexseek-files', fileName } = options

        try {
            // 1. 检查是否已识别
            const statusCheck = await checkRecognitionStatus(ossFileId)

            if (statusCheck.recognized && statusCheck.record) {
                // 已识别，直接返回结果
                updateStatus('success', 100)
                return {
                    htmlContent: statusCheck.record.htmlContent || '',
                    markdownContent: statusCheck.record.markdownContent || '',
                    imageCount: 0,
                }
            }

            if (statusCheck.processing) {
                // 正在处理中，等待
                throw new Error('文件正在识别中，请稍后再试')
            }

            // 2. 根据文件类型选择处理方式
            let images: ExtractedImage[] = []
            let htmlContent = ''
            let markdownContent = ''

            if (fileName && isTxtFile(fileName)) {
                // TXT 文件处理：直接读取文本内容，无图片
                const textContent = await getFileTextContent(options)

                updateStatus('recognizing', 40)

                // txt 文件内容直接作为 markdown（纯文本）
                markdownContent = textContent
                // HTML 内容：将换行转换为 <br> 或 <p> 标签
                htmlContent = `<pre>${textContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`
                // txt 文件没有图片
                images = []
            } else if (fileName && isMarkdownFile(fileName)) {
                // Markdown 文件处理
                const textContent = await getFileTextContent(options)

                updateStatus('recognizing', 40)
                const extractResult: MarkdownExtractResult = await extractMarkdown(textContent)

                images = extractResult.images
                markdownContent = extractResult.markdown
                // 使用 marked 转换后的 HTML
                htmlContent = extractResult.html
            } else {
                // Docx 文件处理（默认）
                const fileContent = await getFileContent(options)

                updateStatus('recognizing', 40)
                const extractResult: DocxExtractResult = await extractDocx(fileContent)

                images = extractResult.images
                htmlContent = extractResult.html
                markdownContent = extractResult.markdown
            }

            // 3. 上传图片到 OSS（传递文件名用于图片命名）
            const imageMap = await uploadImages(images, bucket, fileName)

            // 4. 替换图片占位符
            htmlContent = replaceImagePlaceholders(htmlContent, imageMap)
            markdownContent = replaceImagePlaceholders(markdownContent, imageMap)

            // 5. 保存识别结果（会自动执行向量嵌入，传递文件名用于元数据）
            await saveRecognitionResult(
                ossFileId,
                htmlContent,
                markdownContent,
                fileName
            )

            updateStatus('success', 100)

            return {
                htmlContent,
                markdownContent,
                imageCount: imageMap.size,
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '识别失败'
            updateStatus('error', 0, errorMessage)
            throw error
        }
    }

    /**
     * 重置状态
     */
    const reset = () => {
        status.value = { status: 'idle', progress: 0 }
    }

    return {
        // 状态
        status: readonly(status),

        // 方法
        checkRecognitionStatus,
        recognize,
        reset,
    }
}
