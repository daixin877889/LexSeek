import type { LCaseMaterial } from '../legacyTypes'

/**
 * §8.2 B-1：旧材料 → 新 case_materials。
 * type 值域 1→1/2→2/3→3/4→4；旧 type=5（视频）由 preflight 拦截，迁移器对 type=5 跳过。
 * 丢弃 userId/content/asrRecordId/materialGroup/keywords/summary/vectorIds/lastEmbeddingAt/lastEditAt。
 */
export function mapCaseMaterial(o: LCaseMaterial) {
  return {
    id: o.id,
    caseId: o.caseId,
    draftId: null,
    name: o.name,
    type: o.type,
    ossFileId: o.ossFileId,
    isEncrypted: false,
    status: 3,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/**
 * §8.2 B-1：仅旧 type=1（文本/案情材料）额外产出一条 text_content_records。
 * 非文本类返回 null（其解析内容已在 doc/image/asr 识别表，靠 ossFileId 关联，不重复搬）。
 */
export function mapTextContentRecord(o: LCaseMaterial) {
  if (o.type !== 1) return null
  return {
    userId: o.userId,
    caseId: o.caseId,
    materialId: o.id,
    content: o.content,
    htmlContent: null,
    summary: o.summary,
    status: 2,
    vectorIds: [],
    lastEmbeddingAt: null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}
