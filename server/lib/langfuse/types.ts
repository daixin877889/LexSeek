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
  | 'ocr'
  | 'sub-agent'
  | 'invoke-node-json'
  | 'memory-consolidator'

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
    case 'ocr':
      return 'MATERIAL'
    case 'intent-classifier':
      return 'RETRIEVAL'
    case 'sub-agent':
    case 'invoke-node-json':
      return 'TOOL'
    case 'memory-consolidator':
      return 'CASE'
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
  /**
   * OTel span 上送模式
   * - 'batched'（默认）：BatchSpanProcessor 5s 内累积批量发送，长生命周期进程（dev/常驻容器）用
   * - 'immediate'：SimpleSpanProcessor 每 span end 时立即发送，serverless（FC3/Lambda 等）必须用此模式
   *   否则函数 handler 返回后容器被回收，队列里 span 还没 flush 就丢
   */
  exportMode: 'batched' | 'immediate'
}
