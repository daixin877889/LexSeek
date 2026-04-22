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

export async function deleteContractRiskDAO(id: number): Promise<void> {
    await prisma.contractRisks.delete({ where: { id } })
}
