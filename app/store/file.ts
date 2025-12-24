/**
 * 文件状态管理 Store
 * 
 * 负责文件上传相关的 API 调用和状态管理
 */

import type { FileSource, FileSourceAccept } from '~~/shared/types/file'
import type { PostSignatureResult } from '~~/shared/types/oss'

/**
 * 预签名 URL 请求参数（单文件）
 */
export interface PresignedUrlParams {
  source: FileSource
  originalFileName: string
  fileSize: number
  mimeType: string
}

/**
 * 单个文件信息
 */
export interface FileInfo {
  originalFileName: string
  fileSize: number
  mimeType: string
}

/**
 * 批量预签名 URL 请求参数
 */
export interface BatchPresignedUrlParams {
  source: FileSource
  files: FileInfo[]
}

export const useFileStore = defineStore('file', () => {
  /**
   * 状态
   */
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * 获取上传场景配置
   * @param source 文件来源场景（可选）
   * @returns 场景配置列表或 null
   */
  const getUploadConfig = async (source?: FileSource): Promise<FileSourceAccept[] | null> => {
    loading.value = true
    error.value = null

    const queryParams = source ? { source } : {}

    const { data: response, error: apiError, execute } = useApi<FileSourceAccept[]>(
      '/api/v1/files/presigned-url/config',
      {
        method: 'GET',
        query: queryParams,
        immediate: false,
        showError: false,
      }
    )

    await execute()
    loading.value = false

    if (apiError.value || !response.value) {
      error.value = apiError.value?.message || '获取场景配置失败'
      logger.error('获取场景配置失败:', apiError.value)
      return null
    }

    return response.value
  }

  /**
   * 获取预签名 URL（单文件）
   * @param params 请求参数
   * @returns 预签名结果或 null
   */
  const getPresignedUrl = async (params: PresignedUrlParams): Promise<PostSignatureResult | null> => {
    loading.value = true
    error.value = null

    try {
      const data = await useApiFetch<PostSignatureResult>(
        '/api/v1/files/presigned-url',
        {
          method: 'GET',
          query: {
            source: params.source,
            originalFileName: params.originalFileName,
            fileSize: String(params.fileSize),
            mimeType: params.mimeType,
          },
          showError: false,
        }
      )
      loading.value = false
      return data
    } catch (err: unknown) {
      loading.value = false
      const errorMessage = err instanceof Error ? err.message : '获取预签名 URL 失败'
      error.value = errorMessage
      logger.error('获取预签名 URL 失败:', err)
      return null
    }
  }

  /**
   * 批量获取预签名 URL（多文件）
   * @param params 批量请求参数
   * @returns 预签名结果数组或 null
   */
  const getBatchPresignedUrls = async (params: BatchPresignedUrlParams): Promise<PostSignatureResult[] | null> => {
    loading.value = true
    error.value = null

    try {
      const data = await useApiFetch<PostSignatureResult[]>(
        '/api/v1/files/presigned-url',
        {
          method: 'POST',
          body: {
            source: params.source,
            files: params.files,
          },
          showError: false,
        }
      )
      loading.value = false
      return data
    } catch (err: unknown) {
      loading.value = false
      const errorMessage = err instanceof Error ? err.message : '批量获取预签名 URL 失败'
      error.value = errorMessage
      logger.error('批量获取预签名 URL 失败:', err)
      return null
    }
  }

  return {
    // 状态
    loading,
    error,

    // 方法
    getUploadConfig,
    getPresignedUrl,
    getBatchPresignedUrls,
  }
})
