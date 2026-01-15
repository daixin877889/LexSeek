/**
 * MinerU 识别 Composable
 *
 * 浏览器端 MinerU 识别核心逻辑，处理 doc 和 pdf 文件
 * 整合上传链接申请、文件直传、状态轮询
 * 服务端会在 MinerU 回调时自动处理 ZIP 文件并保存结果
 *
 * @requirements 1.1-1.4, 2.1, 3.1-3.6, 5.1-5.5, 6.1-6.6
 */

/** MinerU 识别状态类型 */
export type MineruRecognitionStatusType =
    | 'idle'
    | 'checking'
    | 'requesting'       // 请求上传链接
    | 'downloading'      // 下载文件（从 OSS）
    | 'decrypting'       // 解密文件
    | 'uploading'        // 上传到 MinerU
    | 'processing'       // MinerU 处理中
    | 'downloading_result' // 下载结果
    | 'extracting'       // 提取内容
    | 'uploading_images' // 上传图片
    | 'converting'       // 转换 HTML
    | 'submitting'       // 提交结果
    | 'success'
    | 'error'

/** MinerU 识别状态 */
export interface MineruRecognitionStatus {
    /** 状态 */
    status: MineruRecognitionStatusType
    /** 进度百分比 (0-100) */
    progress: number
    /** 错误信息 */
    error?: string
}

/** MinerU 识别选项 */
export interface MineruRecognitionOptions {
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
    /** bucket 名称 */
    bucket?: string
}

/** MinerU 识别结果 */
export interface MineruRecognitionResult {
    /** HTML 内容（图片已替换为占位符） */
    htmlContent: string
    /** Markdown 内容（图片已替换为占位符） */
    markdownContent: string
    /** 上传的图片数量 */
    imageCount: number
}

/** 申请上传链接响应 */
interface ApplyUploadUrlResponse {
    batchId: string
    fileUrls: string[]
    files: Array<{
        ossFileId: number
        dataId: string
        uploadUrl: string
    }>
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
    mineruTask?: {
        taskId?: string
        batchId?: string
        status: number
        downloadUrl?: string
        errorMsg?: string
    }
}

/** 轮询配置 */
interface PollingConfig {
    /** 初始延迟（毫秒） */
    initialDelay: number
    /** 最大延迟（毫秒） */
    maxDelay: number
    /** 最大重试次数 */
    maxRetries: number
    /** 退避因子 */
    backoffFactor: number
}

/** 默认轮询配置 */
const DEFAULT_POLLING_CONFIG: PollingConfig = {
    initialDelay: 5000,      // 5 秒
    maxDelay: 300000,        // 5 分钟
    maxRetries: 60,          // 最多 60 次（约 30 分钟）
    backoffFactor: 1.5,      // 每次延迟增加 1.5 倍
}

/** MinerU 任务状态枚举 */
const MineruTaskStatus = {
    PENDING: 0,
    PROCESSING: 1,
    SUCCESS: 2,
    FAILED: 3,
} as const

/**
 * 计算指数退避延迟
 */
const calculateBackoffDelay = (
    retryCount: number,
    config: PollingConfig = DEFAULT_POLLING_CONFIG
): number => {
    const delay = config.initialDelay * Math.pow(config.backoffFactor, retryCount)
    return Math.min(delay, config.maxDelay)
}

/**
 * 等待指定时间
 */
const sleep = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * MinerU 识别 Composable
 */
export const useMineruRecognition = () => {
    const { cacheFile, getCachedFile } = useLocalFileCache()
    const ageCrypto = useAgeCrypto()

    // 识别状态
    const status = ref<MineruRecognitionStatus>({
        status: 'idle',
        progress: 0,
    })

    /**
     * 更新状态
     */
    const updateStatus = (
        newStatus: MineruRecognitionStatusType,
        progress: number,
        error?: string
    ) => {
        status.value = { status: newStatus, progress, error }
    }

    /**
     * 检查文件识别状态
     */
    const checkRecognitionStatus = async (
        ossFileId: number
    ): Promise<{
        recognized: boolean
        processing: boolean
        mineruCompleted: boolean
        downloadUrl?: string
        record?: CheckStatusResponse['record']
    }> => {
        updateStatus('checking', 5)

        try {
            const response = await useApiFetch<CheckStatusResponse>(
                `/api/v1/recognition/doc/status/${ossFileId}`,
                { showError: false }
            )

            if (!response) {
                return { recognized: false, processing: false, mineruCompleted: false }
            }

            // 检查 MinerU 任务状态
            const mineruTask = response.mineruTask
            const mineruCompleted = mineruTask?.status === MineruTaskStatus.SUCCESS
            const mineruFailed = mineruTask?.status === MineruTaskStatus.FAILED

            // 如果 MinerU 任务失败，抛出错误
            if (mineruFailed) {
                throw new Error(mineruTask?.errorMsg || 'MinerU 识别失败')
            }

            return {
                recognized: response.recognized,
                processing: response.status === 1 && !mineruCompleted,
                mineruCompleted,
                downloadUrl: mineruTask?.downloadUrl,
                record: response.record,
            }
        } catch (error) {
            console.error('检查识别状态失败:', error)
            throw error
        }
    }

    /**
     * 申请 MinerU 上传链接
     */
    const requestUploadUrl = async (
        ossFileId: number,
        fileName: string
    ): Promise<{ uploadUrl: string; batchId: string; dataId: string }> => {
        updateStatus('requesting', 10)

        const response = await useApiFetch<ApplyUploadUrlResponse>(
            '/api/v1/recognition/mineru/upload-url',
            {
                method: 'POST',
                body: {
                    files: [{ ossFileId, fileName }],
                    modelVersion: 'vlm',
                    enableOcr: true,
                    enableFormula: true,
                    enableTable: true,
                },
                showError: true,
            }
        )

        if (!response || !response.files[0]) {
            throw new Error('申请上传链接失败')
        }

        const fileInfo = response.files[0]
        return {
            uploadUrl: fileInfo.uploadUrl,
            batchId: response.batchId,
            dataId: fileInfo.dataId,
        }
    }

    /**
     * 获取文件内容
     */
    const getFileContent = async (
        options: MineruRecognitionOptions
    ): Promise<ArrayBuffer> => {
        const { ossFileId, localFile, encrypted, downloadUrl, fileName } = options

        // 1. 如果有本地文件，直接使用
        if (localFile) {
            await cacheFile(ossFileId, localFile)
            return localFile.arrayBuffer()
        }

        // 2. 尝试从缓存读取
        updateStatus('downloading', 15)
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
            updateStatus('decrypting', 20)

            await ageCrypto.restoreIdentity()

            if (!ageCrypto.isUnlocked.value) {
                throw new Error('文件已加密，请先解锁私钥')
            }

            content = await ageCrypto.decryptFile(content)
        }

        // 5. 缓存下载的文件
        const mimeType = fileName.endsWith('.pdf') ? 'application/pdf' : 'application/msword'
        const blob = new Blob([content], { type: mimeType })
        const file = new File([blob], fileName, { type: mimeType })
        await cacheFile(ossFileId, file)

        return content
    }

    /**
     * 上传文件到 MinerU（通过服务端代理，避免 CORS 问题）
     */
    const uploadToMineru = async (
        uploadUrl: string,
        fileContent: ArrayBuffer,
        fileName: string
    ): Promise<void> => {
        updateStatus('uploading', 25)

        // 将 ArrayBuffer 转换为 Base64
        const base64Content = btoa(
            new Uint8Array(fileContent).reduce(
                (data, byte) => data + String.fromCharCode(byte),
                ''
            )
        )

        // 通过服务端代理上传，避免浏览器 CORS 限制
        const response = await useApiFetch('/api/v1/recognition/mineru/upload', {
            method: 'POST',
            body: {
                uploadUrl,
                fileContent: base64Content,
                fileName,
            },
            showError: true,
        })

        if (!response) {
            throw new Error('上传到 MinerU 失败')
        }
    }

    /**
     * 轮询识别状态
     * 服务端会在 MinerU 回调时自动处理 ZIP 文件并保存结果
     * 浏览器只需要轮询等待 recognized 状态变为 true
     */
    const pollStatus = async (
        ossFileId: number,
        config: PollingConfig = DEFAULT_POLLING_CONFIG
    ): Promise<void> => {
        updateStatus('processing', 30)

        let retryCount = 0

        while (retryCount < config.maxRetries) {
            // 检查状态
            const statusResult = await checkRecognitionStatus(ossFileId)

            // 如果已识别成功，直接返回
            if (statusResult.recognized) {
                return
            }

            // 计算下次轮询延迟
            const delay = calculateBackoffDelay(retryCount, config)
            retryCount++

            // 更新进度（30-90%）
            const progress = 30 + Math.min(60, retryCount * 3)
            updateStatus('processing', progress)

            // 等待后继续轮询
            await sleep(delay)
        }

        throw new Error('轮询超时，请稍后重试')
    }

    /**
     * 执行 MinerU 识别
     * 服务端会在 MinerU 回调时自动处理 ZIP 文件并保存结果
     * 浏览器只需要上传文件并轮询等待结果
     */
    const recognize = async (
        options: MineruRecognitionOptions
    ): Promise<MineruRecognitionResult> => {
        const { ossFileId, fileName } = options

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

            // 2. 如果正在处理中，轮询等待服务端处理完成
            if (statusCheck.processing || statusCheck.mineruCompleted) {
                await pollStatus(ossFileId)

                // 轮询完成后获取最终结果
                const finalStatus = await checkRecognitionStatus(ossFileId)
                if (finalStatus.recognized && finalStatus.record) {
                    updateStatus('success', 100)
                    return {
                        htmlContent: finalStatus.record.htmlContent || '',
                        markdownContent: finalStatus.record.markdownContent || '',
                        imageCount: 0,
                    }
                }
                throw new Error('识别结果获取失败')
            }

            // 3. 开始新的识别流程
            // 3.1 获取文件内容
            const fileContent = await getFileContent(options)

            // 3.2 申请上传链接
            const { uploadUrl } = await requestUploadUrl(ossFileId, fileName)

            // 3.3 上传到 MinerU
            await uploadToMineru(uploadUrl, fileContent, fileName)

            // 3.4 轮询等待服务端处理完成（服务端会在回调时自动处理 ZIP）
            await pollStatus(ossFileId)

            // 3.5 获取最终结果
            const finalStatus = await checkRecognitionStatus(ossFileId)
            if (finalStatus.recognized && finalStatus.record) {
                updateStatus('success', 100)
                return {
                    htmlContent: finalStatus.record.htmlContent || '',
                    markdownContent: finalStatus.record.markdownContent || '',
                    imageCount: 0,
                }
            }

            throw new Error('识别结果获取失败')
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
