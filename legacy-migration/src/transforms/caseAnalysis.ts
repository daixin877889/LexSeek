import type { LCaseAnalysis } from '../legacyTypes'
import { tsFallback } from './helpers'

/** 旧 status 0/1/2/3 → 新 status 1/1/2/3（旧 0 与 1 都映射为新 1-进行中） */
function mapStatus(old: number): number {
  return old <= 1 ? 1 : old
}

/**
 * §8.2 B-2：case_analyses 纯映射。
 * nodeId、sessionId 由迁移器解析后传入（nodeId 来自 analysisType→nodes.name 匹配；
 * sessionId 旧非空直传、旧空时迁移器新建 legacy 会话后传入）。
 * isActive Int→Boolean；status 旧 0~3→新 1~3；pointDeducted=true（防新系统重扣）；
 * tokens=usageToken；丢弃 analysisProcess/generationType/userId/title/messageId/keywords/vectorIds/lastEmbeddingAt/startedAt/completedAt。
 */
export function mapCaseAnalysis(o: LCaseAnalysis, nodeId: number, sessionId: string, migratedAt: Date) {
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    caseId: o.caseId,
    sessionId,
    nodeId,
    analysisType: o.analysisType,
    analysisResult: o.analysisResult,
    originalResult: null,
    version: o.version,
    status: mapStatus(o.status),
    isActive: o.isActive === 1,
    pointDeducted: true,
    tokenCount: null,
    tokens: o.usageToken,
    summary: o.summary,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}
