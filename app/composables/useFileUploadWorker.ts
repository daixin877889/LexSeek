/**
 * 文件上传 Worker Composable
 * 
 * 使用 Web Worker 在后台线程处理文件上传，避免阻塞主线程
 * Worker 实现位于 app/workers/fileUpload.worker.ts
 * 
 * 使用引用计数管理 Worker 生命周期，支持多个组件共享同一个 Worker
 */

import type { PostSignatureResult } from '~~/shared/types/oss'
import { useApiFetch } from '~/composables/useApiFetch'

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
  ossFileId?: number  // 用于回调失败时的兜底校验
}

// Worker 实例管理
interface WorkerInstance {
  worker: Worker
  refCount: number
}

/** Worker 单例 key */
const WORKER_KEY = 'fileUpload'

const workerInstanceMap = new Map<string, WorkerInstance>()

/**
 * 创建文件上传 Worker
 * 注意：new URL() 必须使用静态字符串字面量，Vite 才能在生产构建中正确打包 Worker 文件
 */
function createFileUploadWorker(): Worker {
  return new Worker(new URL('../workers/fileUpload.worker.ts', import.meta.url), { type: 'module' })
}

/**
 * 获取共享 Worker 实例
 * 使用引用计数管理 Worker 生命周期
 */
function getSharedWorker(): WorkerInstance {
  let instance = workerInstanceMap.get(WORKER_KEY)
  if (!instance) {
    const worker = createFileUploadWorker()
    instance = { worker, refCount: 0 }
    workerInstanceMap.set(WORKER_KEY, instance)
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
    // 已初始化则直接返回
    if (currentInstance) return currentInstance.worker

    currentInstance = getSharedWorker()
    currentInstance.refCount++

    // 仅在首次初始化时添加监听器
    currentInstance.worker.addEventListener('message', async (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      const task = tasks.get(response.id)

      if (!task) return

      switch (response.type) {
        case 'progress':
          task.callbacks.onProgress?.(response.progress || 0)
          break

        case 'success': {
          const data = response.data || {}
          // 触发兜底的两种信号：
          //   data.success === false  → callback 收到但业务异常
          //   data.__callbackFailed   → worker 翻译的 OSS HTTP 203（callback 未送达）
          const callbackOk = data?.success !== false && data?.__callbackFailed !== true

          if (callbackOk) {
            task.callbacks.onSuccess?.(data)
            tasks.delete(response.id)
            break
          }

          // 回调失败：用 ossFileId 兜底校验
          if (!task.ossFileId) {
            task.callbacks.onError?.(new Error('上传回调失败且无法兜底校验'))
            tasks.delete(response.id)
            break
          }

          try {
            const result = await useApiFetch<{ status: string }>(
              '/api/v1/storage/confirm-upload',
              { method: 'POST', body: { fileId: task.ossFileId } }
            )
            if (result?.status === 'uploaded') {
              task.callbacks.onSuccess?.({ recovered: true, fileId: task.ossFileId })
            } else {
              task.callbacks.onError?.(new Error('上传校验失败，请重新上传'))
            }
          } catch (err) {
            task.callbacks.onError?.(err instanceof Error ? err : new Error('上传校验异常'))
          } finally {
            tasks.delete(response.id)
          }
          break
        }

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

    tasks.set(id, { id, callbacks, ossFileId: signature.ossFileId })

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
        const instance = workerInstanceMap.get(WORKER_KEY)
        if (instance) {
          instance.worker.terminate()
          workerInstanceMap.delete(WORKER_KEY)
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
