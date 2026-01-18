/**
 * 材料相关类型定义
 */

// 导入案件材料类型枚举（统一使用，避免重复定义）
import { CaseMaterialType } from './case'

/** 材料类型文本映射 */
export const MaterialTypeText: Record<CaseMaterialType, string> = {
    [CaseMaterialType.CASE_CONTENT]: '文本',
    [CaseMaterialType.DOCUMENT]: '文档',
    [CaseMaterialType.IMAGE]: '图片',
    [CaseMaterialType.AUDIO]: '音频',
}

/**
 * 材料状态枚举（数据库存储值）
 */
export enum MaterialStatus {
    /** 待处理 */
    PENDING = 1,
    /** 处理中 */
    PROCESSING = 2,
    /** 已完成 */
    COMPLETED = 3,
    /** 处理失败 */
    FAILED = 4,
}

/** 材料状态文本映射 */
export const MaterialStatusText: Record<MaterialStatus, string> = {
    [MaterialStatus.PENDING]: '待处理',
    [MaterialStatus.PROCESSING]: '处理中',
    [MaterialStatus.COMPLETED]: '已完成',
    [MaterialStatus.FAILED]: '处理失败',
}

/**
 * 前端材料处理状态（UI 展示用）
 */
export type MaterialUIStatus = 'pending' | 'processing' | 'ready' | 'error' | 'uploaded'

/**
 * 材料项（前端使用）
 */
export interface MaterialItem {
    /** 材料名称 */
    name: string
    /** 材料类型 */
    type: CaseMaterialType
    /** 文件大小（字节） */
    size: number
    /** 原始文件（如果有） */
    file?: File
    /** 提取的文本内容（浏览器端处理的文件） */
    content?: string
    /** 处理状态（UI 状态） */
    status: MaterialUIStatus
    /** 错误信息 */
    error?: string
    /** 是否需要服务端处理 */
    needServerProcess: boolean
    /** 上传后的 OSS 文件 ID */
    ossFileId?: number
    /** 文件 MIME 类型 */
    mimeType?: string
}

/**
 * 材料上传结果（前端使用）
 */
export interface MaterialUploadResult {
    /** 材料列表 */
    materials: MaterialItem[]
    /** 是否加密 */
    encrypted: boolean
}


// ==================== 服务端材料操作接口 ====================

/**
 * 创建材料输入（服务端使用）
 */
export interface CreateMaterialInput {
    /** 关联的案件ID */
    caseId: number
    /** 材料名称 */
    name: string
    /** 材料类型 */
    type: number | CaseMaterialType
    /** 材料内容（处理后的文本内容） */
    content?: string
    /** 原始内容（加密存储时使用） */
    originalContent?: string
    /** 关联的 OSS 文件ID */
    ossFileId?: number
    /** 是否加密 */
    isEncrypted?: boolean
    /** 材料状态 */
    status?: MaterialStatus
}

/**
 * 更新材料输入（服务端使用）
 */
export interface UpdateMaterialInput {
    /** 材料名称 */
    name?: string
    /** 材料内容 */
    content?: string
    /** 原始内容 */
    originalContent?: string
    /** 材料状态 */
    status?: MaterialStatus
}

/**
 * 材料查询参数（服务端使用）
 */
export interface MaterialQueryOptions {
    /** 案件ID */
    caseId?: number
    /** 材料类型 */
    type?: number | CaseMaterialType
    /** 材料状态 */
    status?: MaterialStatus
    /** 页码 */
    page?: number
    /** 每页数量 */
    pageSize?: number
    /** 排序字段 */
    orderBy?: 'id' | 'name' | 'type' | 'status' | 'createdAt'
    /** 排序方向 */
    orderDir?: 'asc' | 'desc'
}
