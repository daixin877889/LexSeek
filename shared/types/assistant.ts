/**
 * 通用法律助手相关类型
 *
 * 用于前后端共享的助手（assistant）域类型定义。
 * 与 case 域共用 case_sessions 表但 scope='assistant'，参见 spec §4.10, §5.1, §5.6.1-3。
 */

/** 助手会话（前端列表展示用） */
export interface AssistantSession {
    sessionId: string
    title: string | null
    updatedAt: string // ISO 字符串
    createdAt: string
}

/** 会话列表响应 */
export interface AssistantSessionListResponse {
    list: AssistantSession[]
    total: number
    page: number
    pageSize: number
}

/** 会话创建响应 */
export interface CreateAssistantSessionResponse {
    sessionId: string
    title: string | null
}
