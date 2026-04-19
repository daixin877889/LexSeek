/**
 * 文书生成相关业务类型
 *
 * 约定：Prisma row 类型直接从 #shared/types/prisma 导入，不在此处手写镜像。
 * 本文件只放业务枚举、API 请求响应、值对象。
 */

// ==================== 分类枚举 ====================
export const DOCUMENT_CATEGORIES = [
    { key: 'general',          label: '律师通用工具' },
    { key: 'litigation',       label: '起诉·应诉·上诉' },
    { key: 'procedure',        label: '流程变更·程序操作' },
    { key: 'evidence',         label: '证据·鉴定·调查取证' },
    { key: 'preservation',     label: '保全·冻结·先予执行' },
    { key: 'enforcement',      label: '执行·追偿·强制措施' },
    { key: 'arbitration',      label: '仲裁·调解·担保物权' },
    { key: 'protection_order', label: '人身安全保护令' },
    { key: 'identity',         label: '身份·监护·失踪' },
] as const

export type DocumentCategoryKey = typeof DOCUMENT_CATEGORIES[number]['key']
export const DOCUMENT_CATEGORY_KEYS = DOCUMENT_CATEGORIES.map(c => c.key) as readonly DocumentCategoryKey[]

// ==================== 模板来源筛选枚举 ====================
export type TemplateScopeFilter = 'all' | 'user' | 'global'

export const TEMPLATE_SCOPE_OPTIONS: { value: TemplateScopeFilter; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'user', label: '我的' },
    { value: 'global', label: '公共' },
]

// ==================== Draft 状态枚举 ====================
export type DocumentDraftStatus = 'drafting' | 'filling' | 'ready' | 'exported' | 'failed'

// ==================== 值对象 ====================
export interface Placeholder {
    name: string
    firstContext: string
}

// ==================== 模板类型 ====================
/**
 * 带类型化 placeholders 的模板类型
 *
 * Prisma 生成类型中 placeholders 为 JsonValue，使用时需转为 Placeholder[]，
 * 统一在此处收敛，避免在每个消费点做类型断言。
 */
import type { documentTemplates } from '#shared/types/prisma'
export type DocumentTemplate = Omit<documentTemplates, 'placeholders'> & {
    placeholders: Placeholder[] | null
}

export interface DocumentSourceRef {
    text?: string
    fileIds?: number[]
    caseId?: number
}

export interface DocumentDraftMetadata {
    suggestions?: Record<string, string>
}

// ==================== API 请求/响应 ====================
export interface CreateDraftRequest {
    templateId: number
    sourceText?: string
    sourceFileIds?: number[]
    caseId?: number
}

export interface CreateDraftResponse {
    draftId: number
    sessionId: string
}

export interface PatchDraftRequest {
    values: Record<string, string | null>
}

export interface ExportDraftResponse {
    ossFileId: number
    downloadUrl: string
}

// ==================== 快照 & 版本 ====================

/** 文书快照来源 */
export type DraftSnapshotSource = 'ai-extract' | 'workspace-backup'

export interface DocumentDraftSnapshot {
    id: number
    draftId: number
    source: DraftSnapshotSource
    values: Record<string, string | null>
    aiTitle: string | null
    createdAt: string
}

export interface DocumentDraftVersion {
    id: number
    draftId: number
    versionNo: number
    name: string
    values: Record<string, string | null>
    titleAt: string
    createdAt: string
}
