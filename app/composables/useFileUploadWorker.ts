/**
 * 文件上传 Worker Composable
 * 
 * 使用 Web Worker 在后台线程处理文件上传，避免阻塞主线程
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
   */
  const initWorker = () => {
    if (worker) return worker

    // 动态创建 Worker
    const workerCode = `
      const uploadTasks = new Map();

      const handleUpload = (message) => {
        const { id, file, signature } = message;

        const formData = new FormData();
        formData.append('key', signature.key);
        formData.append('policy', signature.policy);
        formData.append('x-oss-signature-version', signature.signatureVersion);
        formData.append('x-oss-credential', signature.credential);
        formData.append('x-oss-date', signature.date);
        formData.append('x-oss-signature', signature.signature);

        if (signature.securityToken) {
          formData.append('x-oss-security-token', signature.securityToken);
        }
        if (signature.callback) {
          formData.append('callback', signature.callback);
        }
        if (signature.callbackVar) {
          for (const [key, value] of Object.entries(signature.callbackVar)) {
            formData.append(key, value);
          }
        }
        formData.append('file', file);

        const xhr = new XMLHttpRequest();
        uploadTasks.set(id, xhr);

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const progress = (event.loaded / event.total) * 100;
            self.postMessage({ type: 'progress', id, progress });
          }
        });

        xhr.addEventListener('load', () => {
          uploadTasks.delete(id);
          if (xhr.status === 200) {
            try {
              const data = JSON.parse(xhr.responseText);
              self.postMessage({ type: 'success', id, data });
            } catch {
              self.postMessage({ type: 'success', id, data: { raw: xhr.responseText } });
            }
          } else {
            self.postMessage({ type: 'error', id, error: '上传失败: ' + xhr.status + ' ' + xhr.statusText });
          }
        });

        xhr.addEventListener('error', () => {
          uploadTasks.delete(id);
          self.postMessage({ type: 'error', id, error: '上传过程中发生网络错误' });
        });

        xhr.addEventListener('abort', () => {
          uploadTasks.delete(id);
          self.postMessage({ type: 'error', id, error: '上传已取消' });
        });

        xhr.open('POST', signature.host);
        xhr.send(formData);
      };

      const handleCancel = (message) => {
        const xhr = uploadTasks.get(message.id);
        if (xhr) {
          xhr.abort();
          uploadTasks.delete(message.id);
        }
      };

      self.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.type) {
          case 'upload':
            handleUpload(message);
            break;
          case 'cancel':
            handleCancel(message);
            break;
        }
      });
    `

    const blob = new Blob([workerCode], { type: 'application/javascript' })
    worker = new Worker(URL.createObjectURL(blob))

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
