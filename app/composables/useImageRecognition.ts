/**
 * 图像识别 Composable
 *
 * 浏览器端图像识别核心逻辑，支持常见图片格式
 * 将图片转换为 base64 后调用服务端 API 进行识别
 *
 * @requirements 5.1-5.6
 */

/** 图像识别状态类型 */
export type ImageRecognitionStatusType =
    | 'idle'
    | 'checking'
    | 'reading'
    | 'recognizing'
    | 'success'
    | 'error'

/** 图像识别状态 */
export interface ImageRecognitionStatus {
    /** 状态 */
    status: ImageRecognitionStatusType
    /** 进度百分比 (0-100) */
    progress: number
    /** 错误信息 */
    error?: string
}

/** 图像识别选项 */
export interface ImageRecognitionOptions {
    /** OSS 文件 ID */
    ossFileId: number
    /** 原始文件名 */
    fileName: string
    /** 本地文件（如果是刚上传的） */
    localFile?: File
    /** 是否加密 */
    encrypted?: boolean
    /** 文件下载 URL（如果需要从 OSS 下载） */
    downloadUrl?: string
    /** 文件 MIME 类型 */
    mimeType?: string
}

/** 图像识别结果 */
export interface ImageRecognitionResult {
    /** 识别记录 ID */
    id: number
    /** 图片类型 */
    imageType: 'doc' | 'photo'
    /** Markdown 内容 */
    markdownContent: string
    /** HTML 内容 */
    htmlContent: string
}

/** 支持的图片扩展名 */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif']

/**
 * 判断是否为图片文件
 */
export const isImageFile = (fileName: string): boolean => {
    const ext = fileName.split('.').pop()?.toLowerCase()
    return IMAGE_EXTENSIONS.includes(ext || '')
}

/**
 * 获取图片的 MIME 类型
 */
const getImageMimeType = (fileName: string): string => {
    const ext = fileName.split('.').pop()?.toLowerCase()
    const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        heic: 'image/heic',
        heif: 'image/heif',
    }
    return mimeMap[ext || ''] || 'image/jpeg'
}

/**
 * 将文件转换为 base64
 */
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = reader.result as string
            // 移除 data:image/xxx;base64, 前缀
            const base64 = result.split(',')[1]
            resolve(base64)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}

/**
 * 图像识别 Composable
 */
export const useImageRecognition = () => {
    const { cacheFile, getCachedFile } = useLocalFileCache()
    const ageCrypto = useAgeCrypto()

    // 识别状态
    const status = ref<ImageRecognitionStatus>({
        status: 'idle',
        progress: 0,
    })

    /**
     * 更新状态
     */
    const updateStatus = (
        newStatus: ImageRecognitionStatusType,
        progress: number,
        error?: string
    ) => {
        status.value = { status: newStatus, progress, error }
    }

    /**
     * 检查图片是否已识别
     */
    const checkRecognitionStatus = async (
        ossFileId: number
    ): Promise<{
        recognized: boolean
        record?: {
            id: number
            imageType: 'doc' | 'photo'
            markdownContent: string
            htmlContent: string
        }
    }> => {
        updateStatus('checking', 10)

        try {
            const response = await useApiFetch<{
                recognized: boolean
                record?: {
                    id: number
                    imageType: 'doc' | 'photo'
                    markdownContent: string | null
                    htmlContent: string | null
                }
            }>(`/api/v1/recognition/doc/status/${ossFileId}`, {
                showError: false,
            })

            if (!response || !response.recognized || !response.record) {
                return { recognized: false }
            }

            return {
                recognized: true,
                record: {
                    id: response.record.id,
                    imageType: response.record.imageType,
                    markdownContent: response.record.markdownContent || '',
                    htmlContent: response.record.htmlContent || '',
                },
            }
        } catch (error) {
            console.error('检查识别状态失败:', error)
            return { recognized: false }
        }
    }

    /**
     * 获取文件内容
     */
    const getFileContent = async (
        options: ImageRecognitionOptions
    ): Promise<File> => {
        const { ossFileId, localFile, encrypted, downloadUrl, fileName, mimeType } = options

        // 1. 如果有本地文件，直接使用
        if (localFile) {
            await cacheFile(ossFileId, localFile)
            return localFile
        }

        // 2. 尝试从缓存读取
        const cached = await getCachedFile(ossFileId)
        if (cached) {
            const blob = new Blob([cached], { type: mimeType || getImageMimeType(fileName) })
            return new File([blob], fileName, { type: blob.type })
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
            await ageCrypto.restoreIdentity()

            if (!ageCrypto.isUnlocked.value) {
                throw new Error('文件已加密，请先解锁私钥')
            }

            content = await ageCrypto.decryptFile(content)
        }

        // 5. 创建 File 对象并缓存
        const blob = new Blob([content], { type: mimeType || getImageMimeType(fileName) })
        const file = new File([blob], fileName, { type: blob.type })
        await cacheFile(ossFileId, file)

        return file
    }

    /**
     * 执行图像识别
     */
    const recognize = async (
        options: ImageRecognitionOptions
    ): Promise<ImageRecognitionResult> => {
        const { ossFileId, fileName } = options

        try {
            // 1. 检查是否已识别
            const statusCheck = await checkRecognitionStatus(ossFileId)

            if (statusCheck.recognized && statusCheck.record) {
                // 已识别，直接返回结果
                updateStatus('success', 100)
                return statusCheck.record
            }

            // 2. 获取文件内容
            updateStatus('reading', 20)
            const file = await getFileContent(options)

            // 3. 转换为 base64
            updateStatus('reading', 40)
            const base64Data = await fileToBase64(file)

            // 4. 调用识别 API
            updateStatus('recognizing', 60)
            const mimeType = options.mimeType || getImageMimeType(fileName)

            const response = await useApiFetch<{
                id: number
                imageType: 'doc' | 'photo'
                markdownContent: string
                htmlContent: string
            }>('/api/v1/recognition/image', {
                method: 'POST',
                body: {
                    base64Data,
                    mimeType,
                    ossFileId,
                },
                showError: true,
            })

            if (!response) {
                throw new Error('识别失败')
            }

            updateStatus('success', 100)

            return response
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

        // 工具函数
        isImageFile,
    }
}
