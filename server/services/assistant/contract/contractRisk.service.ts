/**
 * ContractRisk Service
 *
 * 薄业务封装：owner 校验统一由 reviewGuard.ts 的 guard 家族完成，
 * service 层不再做归属校验，只负责接收经过校验的 riskId 做业务动作。
 *
 * **Feature: contract-review-versioning-phase-a**
 */
import type { RiskArchivedStatus } from '#shared/types/contract'
import { updateContractRiskDAO } from './contractRisk.dao'

/**
 * 更新风险处置状态。
 * 归属校验由 handler 层通过 loadOwnedReviewByRiskId 完成，
 * service 只接收经过校验的 riskId 做业务动作。
 */
export async function archiveContractRiskService(params: {
    riskId: number
    archivedStatus: RiskArchivedStatus | null
}) {
    return updateContractRiskDAO(params.riskId, { archivedStatus: params.archivedStatus })
}
