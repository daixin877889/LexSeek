import { useDocumentVisibility } from '@vueuse/core'
import { toast } from 'vue-sonner'
import type { OssFileItem } from '~/store/file'
import { isRecognizableDocFile, isImageFile, isAudioFile } from '~~/shared/utils/fileType'

export type RecognitionStatus = 'idle' | 'recognizing' | 'success' | 'error'

const POLLING_INTERVAL = 2000
const MAX_POLLING_ATTEMPTS = 60

/**
 * 文件识别轮询 composable
 * 供 AiPromptInput 和 MaterialUploader 共用
 */
export function useFileRecognition() {
  const fileRecognitionStatus = ref<Map<number, RecognitionStatus>>(new Map())
  const pollingTimers = ref<Map<number, NodeJS.Timeout>>(new Map())
  const visibility = useDocumentVisibility()

  function getRecognitionStatus(ossFileId?: number): RecognitionStatus | null {
    if (!ossFileId) return null
    return fileRecognitionStatus.value.get(ossFileId) || null
  }

  function scheduleNextPoll(ossFileId: number, attemptCount: number) {
    const timer = setTimeout(() => pollFileStatus(ossFileId, attemptCount + 1), POLLING_INTERVAL)
    pollingTimers.value.set(ossFileId, timer)
  }

  async function pollFileStatus(ossFileId: number, attemptCount = 0) {
    if (visibility.value !== 'visible') return
    if (attemptCount >= MAX_POLLING_ATTEMPTS) {
      fileRecognitionStatus.value.set(ossFileId, 'error')
      pollingTimers.value.delete(ossFileId)
      return
    }

    try {
      const response = await useApiFetch<{
        recognized: boolean
        status: number
      }>(`/api/v1/recognition/status/${ossFileId}`, {
        method: 'GET',
        showError: false,
      })

      if (!response) {
        scheduleNextPoll(ossFileId, attemptCount)
        return
      }

      const recognized = response.recognized === true || response.status === 2
      if (recognized) {
        fileRecognitionStatus.value.set(ossFileId, 'success')
        pollingTimers.value.delete(ossFileId)
      } else if (response.status === 3) {
        fileRecognitionStatus.value.set(ossFileId, 'error')
        pollingTimers.value.delete(ossFileId)
      } else {
        scheduleNextPoll(ossFileId, attemptCount)
      }
    } catch {
      scheduleNextPoll(ossFileId, attemptCount)
    }
  }

  function stopPolling(ossFileId: number) {
    const timer = pollingTimers.value.get(ossFileId)
    if (timer) {
      clearTimeout(timer)
      pollingTimers.value.delete(ossFileId)
    }
  }

  function stopAllPolling() {
    pollingTimers.value.forEach(clearTimeout)
    pollingTimers.value.clear()
  }

  /** 处理识别 API 返回结果 */
  function handleRecognitionResults(results: Array<{ ossFileId: number; status: 'processing' | 'completed' | 'failed'; error?: string }>) {
    for (const result of results) {
      if (result.status === 'completed') {
        fileRecognitionStatus.value.set(result.ossFileId, 'success')
      } else if (result.status === 'processing') {
        fileRecognitionStatus.value.set(result.ossFileId, 'recognizing')
        pollFileStatus(result.ossFileId)
      } else {
        fileRecognitionStatus.value.set(result.ossFileId, 'error')
        if (result.error) toast.error(`文件识别失败：${result.error}`)
      }
    }
  }

  /** 对已上传文件启动识别（自动过滤可识别类型） */
  async function startRecognition(ossFileIds: number[], files: OssFileItem[]) {
    const fileMap = new Map(files.map(f => [f.id, f]))
    const recognizable = ossFileIds.filter(id => {
      const file = fileMap.get(id)
      return file && (isRecognizableDocFile(file.fileName) || isImageFile(file.fileName) || isAudioFile(file.fileName))
    })

    if (recognizable.length === 0) return

    recognizable.forEach(id => fileRecognitionStatus.value.set(id, 'recognizing'))

    try {
      const response = await useApiFetch<{
        results: Array<{ ossFileId: number; status: 'processing' | 'completed' | 'failed'; error?: string }>
      }>('/api/v1/recognition/start', {
        method: 'POST',
        body: { ossFileIds: recognizable },
        showError: false,
      })

      if (!response?.results) {
        recognizable.forEach(id => fileRecognitionStatus.value.set(id, 'error'))
        return
      }

      handleRecognitionResults(response.results)
    } catch {
      recognizable.forEach(id => fileRecognitionStatus.value.set(id, 'error'))
    }
  }

  async function retryRecognition(ossFileId: number, files: OssFileItem[]) {
    fileRecognitionStatus.value.set(ossFileId, 'recognizing')
    await startRecognition([ossFileId], files)
  }

  function clearStatus(ossFileId: number) {
    fileRecognitionStatus.value.delete(ossFileId)
    stopPolling(ossFileId)
  }

  function clearAll() {
    fileRecognitionStatus.value.clear()
    stopAllPolling()
  }

  // 页面可见性优化：隐藏时暂停轮询，可见时恢复
  watch(visibility, (state) => {
    if (state === 'visible') {
      fileRecognitionStatus.value.forEach((status, id) => {
        if (status === 'recognizing' && !pollingTimers.value.has(id)) {
          pollFileStatus(id)
        }
      })
    } else {
      stopAllPolling()
    }
  })

  onUnmounted(stopAllPolling)

  return {
    fileRecognitionStatus,
    getRecognitionStatus,
    startRecognition,
    retryRecognition,
    stopPolling,
    stopAllPolling,
    clearStatus,
    clearAll,
    handleRecognitionResults,
  }
}
