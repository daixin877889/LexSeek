/**
 * ContractRisk DAO 层
 *
 * 提供 ContractRisk 表的 CRUD 操作。
 * archivedStatus 更新时自动同步 archivedAt 字段。
 *
 * **Feature: contract-review-versioning-phase-a**
 */
import type { contractRisks } from '~~/generated/prisma/client'
import type { RiskSource, RiskArchivedStatus, StancePreference, RiskLevel } from '#shared/types/contract'

export interface CreateContractRiskInput {
    reviewId: number
    source: RiskSource
    code?: string | null
    category: string
    level: RiskLevel
    stance: StancePreference
    problem: string
    legalBasis?: string | null
    analysis?: string | null
    suggestion?: string | null
    anchorQuote: string
    anchorParagraphIndex?: number | null
    anchorCharStart?: number | null
    anchorCharEnd?: number | null
}

export async function createContractRiskDAO(input: CreateContractRiskInput): Promise<contractRisks> {
    return prisma.contractRisks.create({ data: input })
}

export interface UpdateContractRiskInput {
    level?: RiskLevel
    suggestion?: string | null
    archivedStatus?: RiskArchivedStatus | null
    anchorQuote?: string
    anchorParagraphIndex?: number | null
}

export async function updateContractRiskDAO(id: number, input: UpdateContractRiskInput): Promise<contractRisks> {
    const data: Record<string, unknown> = { ...input }
    // archivedStatus 更新时自动同步 archivedAt
    if ('archivedStatus' in input) {
        data.archivedAt = input.archivedStatus ? new Date() : null
    }
    return prisma.contractRisks.update({ where: { id }, data })
}

export async function listContractRisksDAO(reviewId: number): Promise<contractRisks[]> {
    return prisma.contractRisks.findMany({
        where: { reviewId },
        orderBy: [{ source: 'asc' }, { createdAt: 'asc' }],
    })
}

export async function getContractRiskByIdDAO(id: number): Promise<contractRisks | null> {
    return prisma.contractRisks.findUnique({ where: { id } })
}

/**
 * ANN-H2：物理删 contractRisks 会触发 FK onDelete: Cascade 级联物理删
 * contractAnnotations 子行——违反"批注永不物理删"铁律（决策 11）。
 * 该 DAO 已被生产路径完全弃用，仅留作"测试用例直接清表"的内部工具：
 *   - 不再 export 给生产代码
 *   - 测试若要清理 fixtures，应直接走 prisma.contractRisks.delete 并清楚
 *     这次清理同时会丢批注（测试本身就该构造完整 fixture）
 */
