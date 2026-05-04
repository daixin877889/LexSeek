/**
 * Langfuse 集成 - 类型定义
 *
 * - LangfuseTraceContext: AsyncLocalStorage store 形态
 * - LangfuseVertical: 12 个细分业务维度（spec D6 决策）
 * - deriveScope: vertical → scope 映射
 * - LangfuseRuntimeConfig: runtimeConfig.langfuse 形态
 */

export type LangfuseTraceContext = {
  /** HTTP 请求级（中间件填） */
  requestId: string

  /** 用户 ID（鉴权后填，公开 API 例外） */
  userId?: number

  /** agent 执行级（agentRun.service 填） */
  runId?: string
  sessionId?: string
  threadId?: string

  /** 业务实体（按场景填，可同时多个） */
  caseId?: number
  reviewId?: string
  draftId?: string
  materialId?: string

  /** 业务维度 */
  vertical?: LangfuseVertical
}

export type LangfuseVertical =
  | 'case-main'
  | 'case-analysis'
  | 'case-module'
  | 'contract'
  | 'document'
  | 'legal-assistant'
  | 'init-analysis'
  | 'extract'
  | 'intent-classifier'
  | 'material-summary'
  | 'sub-agent'
  | 'invoke-node-json'

export type LangfuseScope =
  | 'CASE'
  | 'CONTRACT'
  | 'DOCUMENT'
  | 'ASSISTANT'
  | 'MATERIAL'
  | 'RETRIEVAL'
  | 'TOOL'

export function deriveScope(vertical: LangfuseVertical): LangfuseScope {
  switch (vertical) {
    case 'case-main':
    case 'case-analysis':
    case 'case-module':
    case 'init-analysis':
    case 'extract':
      return 'CASE'
    case 'contract':
      return 'CONTRACT'
    case 'document':
      return 'DOCUMENT'
    case 'legal-assistant':
      return 'ASSISTANT'
    case 'material-summary':
      return 'MATERIAL'
    case 'intent-classifier':
      return 'RETRIEVAL'
    case 'sub-agent':
    case 'invoke-node-json':
      return 'TOOL'
  }
}

export type LangfuseRuntimeConfig = {
  publicKey: string
  secretKey: string
  baseUrl: string
  tracingEnabled: boolean
  maskPII: boolean
  environment: 'development' | 'staging' | 'production'
  gitSha: string
}
