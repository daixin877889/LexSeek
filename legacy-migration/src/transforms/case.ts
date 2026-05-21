import type { LCase, LCaseSession } from '../legacyTypes'

/**
 * §8.1 cases：caseTypeId 走配置重映射（newCaseTypeId 由迁移器传入）。
 * 重映射失败时返回 null，迁移器据此跳过或兜底。
 * status：旧 3 态（1-进行中/2-已完成/3-已关闭）与新 6 阶段 CaseStatus 无法对应，
 * 全部统一映射为 1（CaseStatus.CONSULTING 咨询阶段）。
 * content：新项目约定案情描述以「案件描述」材料形式存在（createCaseService 把 content
 * 转成 CASE_CONTENT 材料并把 cases.content 置空）。故此处置 null，案情描述由
 * orchestrator 的 deriveCaseContentMaterials 派生为 case_materials 材料。
 */
export function transformCase(o: LCase, newCaseTypeId: number | null) {
  if (newCaseTypeId === null) return null
  return {
    id: o.id,
    title: o.title,
    content: null,
    userId: o.userId,
    caseTypeId: newCaseTypeId,
    plaintiff: o.plaintiff ?? undefined,
    defendant: o.defendant ?? undefined,
    summary: null,
    extractedInfo: undefined,
    courtName: null,
    firstInstanceCaseNo: null,
    secondInstanceCaseNo: null,
    firstInstanceJudge: null,
    secondInstanceJudge: null,
    status: 1,
    isDemo: false,
    stance: 'plaintiff',
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/**
 * §8.1 case_sessions：scope=case、status=2（已完成）、type=1。
 * userId 由迁移器从关联 case 反查后传入（旧 case_sessions 无 userId）。
 */
export function transformCaseSession(o: LCaseSession, caseUserId: number | null) {
  return {
    id: o.id,
    sessionId: o.sessionId,
    scope: 'case',
    userId: caseUserId,
    caseId: o.caseId,
    status: 2,
    type: 1,
    title: null,
    metadata: undefined,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}
