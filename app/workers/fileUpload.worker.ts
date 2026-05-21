/**
 * 文件上传 Web Worker
 * 
 * 在后台线程处理文件上传，避免阻塞主线程
 */

// Worker 消息类型
interface UploadMessage {
    type: 'upload'
    id: string
    file: File
    signature: {
        host: string
        policy: string
        signatureVersion: string
        credential: string
        date: string
        signature: string
        key: string
        securityToken?: string
        callback?: string
        callbackVar?: Record<string, string>
    }
}

interface CancelMessage {
    type: 'cancel'
    id: string
}

type WorkerMessage = UploadMessage | CancelMessage

// 响应消息类型
interface ProgressResponse {
    type: 'progress'
    id: string
    progress: number
}

interface SuccessResponse {
    type: 'success'
    id: string
    data: Record<string, unknown>
}

interface ErrorResponse {
    type: 'error'
    id: string
    error: string
}

type WorkerResponse = ProgressResponse | SuccessResponse | ErrorResponse

// 存储正在进行的上传任务
const uploadTasks = new Map<string, XMLHttpRequest>()

/**
 * 处理上传任务
 */
const handleUpload = (message: UploadMessage) => {
    const { id, file, signature } = message

    const formData = new FormData()
    formData.append('key', signature.key)
    formData.append('policy', signature.policy)
    formData.append('x-oss-signature-version', signature.signatureVersion)
    formData.append('x-oss-credential', signature.credential)
    formData.append('x-oss-date', signature.date)
    formData.append('x-oss-signature', signature.signature)

    // 添加 Content-Type，OSS PostObject 需要显式设置文件的 MIME 类型
    if (file.type) {
        formData.append('Content-Type', file.type)
    }

    if (signature.securityToken) {
        formData.append('x-oss-security-token', signature.securityToken)
    }
    if (signature.callback) {
        formData.append('callback', signature.callback)
    }
    if (signature.callbackVar) {
        for (const [key, value] of Object.entries(signature.callbackVar)) {
            formData.append(key, value)
        }
    }
    formData.append('file', file)

    const xhr = new XMLHttpRequest()
    uploadTasks.set(id, xhr)

    // 上传进度
    xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
            const progress = (event.loaded / event.total) * 100
            const response: ProgressResponse = { type: 'progress', id, progress }
            self.postMessage(response)
        }
    })

    // 上传完成
    xhr.addEventListener('load', () => {
        uploadTasks.delete(id)
        // OSS callback 协议：HTTP 203 = 文件已上传成功但 callback 失败。
        // 必须透传 __callbackFailed 给主线程走 confirm-upload 兜底，
        // 否则 ossFiles 记录会卡在 PENDING 永不释放。
        if (xhr.status >= 200 && xhr.status < 300) {
            let body: Record<string, unknown> = {}
            if (xhr.status !== 204 && xhr.responseText) {
                try {
                    body = JSON.parse(xhr.responseText) as Record<string, unknown>
                } catch {
                    // 203 响应常是几 KB HTML 错误页，截断防止占满主线程内存
                    body = { raw: xhr.responseText.slice(0, 1000) }
                }
            }
            const data: Record<string, unknown> = {
                ...body,
                __httpStatus: xhr.status,
                ...(xhr.status === 203 && { __callbackFailed: true }),
            }
            self.postMessage({ type: 'success', id, data } satisfies SuccessResponse)
        } else {
            const response: ErrorResponse = {
                type: 'error',
                id,
                error: `上传失败: ${xhr.status} ${xhr.statusText}`
            }
            self.postMessage(response)
        }
    })

    // 上传错误
    xhr.addEventListener('error', () => {
        uploadTasks.delete(id)
        const response: ErrorResponse = { type: 'error', id, error: '上传过程中发生网络错误' }
        self.postMessage(response)
    })

    // 上传取消
    xhr.addEventListener('abort', () => {
        uploadTasks.delete(id)
        const response: ErrorResponse = { type: 'error', id, error: '上传已取消' }
        self.postMessage(response)
    })

    xhr.open('POST', signature.host)
    xhr.send(formData)
}

/**
 * 取消上传任务
 */
const handleCancel = (message: CancelMessage) => {
    const xhr = uploadTasks.get(message.id)
    if (xhr) {
        xhr.abort()
        uploadTasks.delete(message.id)
    }
}

// 监听主线程消息
self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const message = event.data

    switch (message.type) {
        case 'upload':
            handleUpload(message)
            break
        case 'cancel':
            handleCancel(message)
            break
    }
})

export { }
