import type { LCaseAnalysis } from '../legacyTypes'
import { tsFallback } from './helpers'

/**
 * 历史文书生成记录 → 新库 documentDrafts 自由文书草稿。
 *
 * 旧库的文书生成产物（起诉状/答辩状/律师函/法律意见书/各类申请书等）存在 case_analyses，
 * analysisType 为文书类型、analysisResult 为整块 Markdown。新库文书草稿是模板+占位符结构，
 * 装不下整块 Markdown——故落到自由文书：mode=freeform、templateId=null、正文存 content。
 *
 * id 不保留旧值（documentDrafts 与 case_analyses 不同表、ID 空间独立）；
 * sessionId 用 legacy-doc-<旧分析id> 保证唯一约束 + 重跑幂等。
 *
 * @param docTypeLabel 文书类型中文名（迁移器经旧 analysis_modules.title 解析后传入；
 *                     旧 case_analyses.title 多为"第N版"无业务含义，不采用）
 */
export function mapFreeformDraft(o: LCaseAnalysis, migratedAt: Date, docTypeLabel: string) {
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  const title = o.version > 1 ? `${docTypeLabel}（第${o.version}版）` : docTypeLabel
  return {
    userId: o.userId,
    caseId: o.caseId,
    sessionId: `legacy-doc-${o.id}`,
    templateId: null,
    mode: 'freeform',
    content: o.analysisResult,
    status: 'completed',
    title,
    metadata: {
      legacy: true,
      legacyAnalysisId: o.id,
      legacyAnalysisType: o.analysisType,
      legacyVersion: o.version,
      legacyIsActive: o.isActive === 1,
    },
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}
