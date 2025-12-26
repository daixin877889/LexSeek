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
  encrypted?: boolean  // 是否加密上传
  configId?: number    // 存储配置 ID（可选，使用用户自定义存储）
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
  encrypted?: boolean  // 是否加密上传
  configId?: number    // 存储配置 ID（可选，使用用户自定义存储）
}

/**
 * 文件列表项
 */
export interface OssFileItem {
  id: number
  fileName: string
  fileSize: number
  fileType: string
  source: string
  sourceName: string
  status: number
  statusName: string
  encrypted: boolean
  createdAt: string
  url?: string  // 签名下载 URL
}

/**
 * 文件列表查询参数
 */
export interface FileListParams {
  page?: number
  pageSize?: number
  fileName?: string
  fileType?: string
  source?: string
  sortField?: string
  sortOrder?: string
}

/**
 * 文件列表响应
 */
export interface FileListResponse {
  list: OssFileItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

/** 文件列表 API 路径 */
export const FILE_LIST_API = '/api/v1/files/oss/file-list'

export const useFileStore = defineStore('file', () => {
  /**
   * 状态
   */
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 文件列表状态（用于非 SSR 场景或跨组件共享）
  const fileList = ref<OssFileItem[]>([])
  const pagination = ref({
    page: 1,
    pageSize: 30,
    total: 0,
    totalPages: 0,
  })

  /**
   * 构建文件列表查询参数（过滤空值）
   * @param params 原始查询参数
   * @returns 过滤后的查询参数
   */
  const buildFileListQuery = (params: FileListParams = {}): Record<string, any> => {
    const query: Record<string, any> = {}
    if (params.page) query.page = params.page
    if (params.pageSize) query.pageSize = params.pageSize
    if (params.fileName) query.fileName = params.fileName
    if (params.fileType && params.fileType !== 'all') query.fileType = params.fileType
    if (params.source && params.source !== 'all') query.source = params.source
    if (params.sortField) query.sortField = params.sortField
    if (params.sortOrder) query.sortOrder = params.sortOrder
    return query
  }

  /**
   * 同步文件列表数据到 store（供 SSR 场景使用）
   * @param data API 返回的数据
   */
  const syncFileListData = (data: FileListResponse | null) => {
    if (data) {
      fileList.value = data.list || []
      pagination.value = {
        page: data.pagination?.page || 1,
        pageSize: data.pagination?.pageSize || 30,
        total: data.pagination?.total || 0,
        totalPages: data.pagination?.totalPages || 0,
      }
    } else {
      fileList.value = []
      pagination.value = { page: 1, pageSize: 30, total: 0, totalPages: 0 }
    }
  }

  /**
   * 获取上传场景配置
   * @param source 文件来源场景（可选）
   * @returns 场景配置列表或 null
   */
  const getUploadConfig = async (source?: FileSource): Promise<FileSourceAccept[] | null> => {
    loading.value = true
    error.value = null

    try {
      const queryParams = source ? { source } : {}

      const data = await useApiFetch<FileSourceAccept[]>(
        '/api/v1/storage/presigned-url/config',
        {
          method: 'GET',
          query: queryParams,
          showError: false,
        }
      )

      loading.value = false
      return data
    } catch (err: unknown) {
      loading.value = false
      const errorMessage = err instanceof Error ? err.message : '获取场景配置失败'
      error.value = errorMessage
      logger.error('获取场景配置失败:', err)
      return null
    }
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
        '/api/v1/storage/presigned-url',
        {
          method: 'GET',
          query: {
            source: params.source,
            originalFileName: params.originalFileName,
            fileSize: String(params.fileSize),
            mimeType: params.mimeType,
            encrypted: params.encrypted ? 'true' : 'false',
            ...(params.configId ? { configId: String(params.configId) } : {}),
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
        '/api/v1/storage/presigned-url',
        {
          method: 'POST',
          body: {
            source: params.source,
            files: params.files,
            encrypted: params.encrypted ?? false,
            ...(params.configId ? { configId: params.configId } : {}),
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

  /**
   * 获取 OSS 文件列表（非 SSR 场景）
   * 注意：SSR 场景请在页面中直接使用 useApi + buildFileListQuery
   * @param params 查询参数
   * @returns 是否成功
   */
  const fetchFileList = async (params: FileListParams = {}): Promise<boolean> => {
    loading.value = true
    error.value = null

    try {
      const query = buildFileListQuery(params)

      const data = await useApiFetch<FileListResponse>(
        FILE_LIST_API,
        {
          method: 'GET',
          query,
          showError: true,
        }
      )

      loading.value = false
      syncFileListData(data)
      return true
    } catch (err: unknown) {
      loading.value = false
      const errorMessage = err instanceof Error ? err.message : '获取文件列表失败'
      error.value = errorMessage
      logger.error('获取文件列表失败:', err)
      syncFileListData(null)
      return false
    }
  }

  /**
   * 重置文件列表状态
   */
  const resetFileList = () => {
    fileList.value = []
    pagination.value = { page: 1, pageSize: 30, total: 0, totalPages: 0 }
  }

  return {
    // 状态
    loading,
    error,
    fileList,
    pagination,

    // 常量
    FILE_LIST_API,

    // 方法
    getUploadConfig,
    getPresignedUrl,
    getBatchPresignedUrls,
    buildFileListQuery,
    syncFileListData,
    fetchFileList,
    resetFileList,
  }
})
