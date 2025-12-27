/**
 * 文件上传 Worker Composable
 * 
 * 使用 Web Worker 在后台线程处理文件上传，避免阻塞主线程
 * Worker 实现位于 app/workers/fileUpload.worker.ts
 */

import type { PostSignatureResult } from '~~/shared/types/oss'

// Worker 响应类型
interface WorkerResponse {
  type: 'progress' | 'success' | 'error'
  id: string
  progress?: number
  data?: Record<string, unknown>
  error?: string
}

// 上传任务回调
interface UploadCallbacks {
  onProgress?: (progress: number) => void
  onSuccess?: (data: Record<string, unknown>) => void
  onError?: (error: Error) => void
}

// 上传任务
interface UploadTask {
  id: string
  callbacks: UploadCallbacks
}

/**
 * 文件上传 Worker Composable
 */
export const useFileUploadWorker = () => {
  // Worker 实例
  let worker: Worker | null = null
  // 上传任务映射
  const tasks = new Map<string, UploadTask>()
  // 任务 ID 计数器
  let taskIdCounter = 0

  /**
   * 初始化 Worker
   * 使用 app/workers/fileUpload.worker.ts 文件
   */
  const initWorker = () => {
    if (worker) return worker

    // 使用 Nuxt 的方式创建 Worker，引用 workers 目录下的文件
    worker = new Worker(
      new URL('../workers/fileUpload.worker.ts', import.meta.url),
      { type: 'module' }
    )

    // 监听 Worker 消息
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      const task = tasks.get(response.id)

      if (!task) return

      switch (response.type) {
        case 'progress':
          task.callbacks.onProgress?.(response.progress || 0)
          break
        case 'success':
          task.callbacks.onSuccess?.(response.data || {})
          tasks.delete(response.id)
          break
        case 'error':
          task.callbacks.onError?.(new Error(response.error || '未知错误'))
          tasks.delete(response.id)
          break
      }
    })

    return worker
  }

  /**
   * 上传文件
   */
  const upload = (
    file: File,
    signature: PostSignatureResult,
    callbacks: UploadCallbacks
  ): string => {
    const w = initWorker()
    const id = `upload_${++taskIdCounter}_${Date.now()}`

    tasks.set(id, { id, callbacks })

    // 确保 callbackVar 是纯对象，避免克隆问题
    const callbackVar: Record<string, string> = {}
    if (signature.callbackVar) {
      for (const [key, value] of Object.entries(signature.callbackVar)) {
        callbackVar[key] = String(value)
      }
    }

    // 构建可克隆的签名对象
    const cloneableSignature = {
      host: signature.host,
      policy: signature.policy,
      signatureVersion: signature.signatureVersion,
      credential: signature.credential,
      date: signature.date,
      signature: signature.signature,
      key: signature.key,
      securityToken: signature.securityToken || undefined,
      callback: signature.callback || undefined,
      callbackVar: Object.keys(callbackVar).length > 0 ? callbackVar : undefined,
    }

    w.postMessage({
      type: 'upload',
      id,
      file,
      signature: cloneableSignature
    })

    return id
  }

  /**
   * 取消上传
   */
  const cancel = (id: string) => {
    if (worker) {
      worker.postMessage({ type: 'cancel', id })
    }
    tasks.delete(id)
  }

  /**
   * 销毁 Worker
   */
  const destroy = () => {
    if (worker) {
      worker.terminate()
      worker = null
    }
    tasks.clear()
  }

  // 组件卸载时销毁 Worker
  onUnmounted(() => {
    destroy()
  })

  return {
    upload,
    cancel,
    destroy
  }
}
