/**
 * 文件上传 Worker Composable
 * 
 * 使用 Web Worker 在后台线程处理文件上传，避免阻塞主线程
 * Worker 实现位于 app/workers/fileUpload.worker.ts
 * 
 * 使用引用计数管理 Worker 生命周期，支持多个组件共享同一个 Worker
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

// Worker 实例管理
interface WorkerInstance {
  worker: Worker
  refCount: number
}

const workerInstanceMap = new Map<string, WorkerInstance>()

/**
 * 获取共享 Worker 实例
 * 使用文件路径作为 key，支持不同路径的 Worker 实例
 */
function getSharedWorker(workerUrl: string): WorkerInstance {
  let instance = workerInstanceMap.get(workerUrl)
  if (!instance) {
    const worker = new Worker(new URL(workerUrl, import.meta.url), { type: 'module' })
    instance = { worker, refCount: 0 }
    workerInstanceMap.set(workerUrl, instance)
  }
  return instance
}

/**
 * 文件上传 Worker Composable
 */
export const useFileUploadWorker = () => {
  // 当前 Worker 实例
  let currentInstance: WorkerInstance | null = null
  // 上传任务映射
  const tasks = new Map<string, UploadTask>()

  /**
   * 初始化 Worker（使用引用计数）
   */
  const initWorker = () => {
    const workerPath = '../workers/fileUpload.worker.ts'
    currentInstance = getSharedWorker(workerPath)
    currentInstance.refCount++

    // 监听 Worker 消息
    currentInstance.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
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

    return currentInstance.worker
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
    const id = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    tasks.set(id, { id, callbacks })

    const callbackVar: Record<string, string> = {}
    if (signature.callbackVar) {
      for (const [key, value] of Object.entries(signature.callbackVar)) {
        callbackVar[key] = String(value)
      }
    }

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
    if (currentInstance?.worker) {
      currentInstance.worker.postMessage({ type: 'cancel', id })
    }
    tasks.delete(id)
  }

  /**
   * 释放 Worker 引用（减少引用计数）
   */
  const releaseWorker = () => {
    if (currentInstance) {
      currentInstance.refCount--
      if (currentInstance.refCount <= 0) {
        const workerUrl = '../workers/fileUpload.worker.ts'
        const instance = workerInstanceMap.get(workerUrl)
        if (instance) {
          instance.worker.terminate()
          workerInstanceMap.delete(workerUrl)
        }
      }
      currentInstance = null
    }
    tasks.clear()
  }

  // 组件卸载时释放 Worker 引用
  onUnmounted(() => {
    releaseWorker()
  })

  return {
    upload,
    cancel,
    destroy: releaseWorker
  }
}
