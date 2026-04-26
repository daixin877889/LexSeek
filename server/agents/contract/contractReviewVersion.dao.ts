/**
 * ContractReviewVersion DAO 层
 *
 * 提供版本快照表的 CRUD 操作。
 * 列表查询不含 snapshotData（节省传输），详情查询包含完整快照数据。
 * 无独立测试，由 service 层（contractReviewVersion.service.test.ts）覆盖。
 *
 * **Feature: contract-review-versioning-phase-a**
 */
import type { contractReviewVersions, Prisma } from '~~/generated/prisma/client'
import type { VersionSystemLabel } from '#shared/types/contract'

export interface CreateContractReviewVersionInput {
    reviewId: number
    versionNumber: number
    systemLabel: VersionSystemLabel
    lawyerNote?: string | null
    snapshotData: Prisma.InputJsonValue
    createdById: number
}

export async function createContractReviewVersionDAO(input: CreateContractReviewVersionInput): Promise<contractReviewVersions> {
    return prisma.contractReviewVersions.create({ data: input })
}

/** 列表（不含 snapshotData，节省流量），按版本号降序 */
export async function listContractReviewVersionsDAO(reviewId: number) {
    return prisma.contractReviewVersions.findMany({
        where: { reviewId },
        orderBy: { versionNumber: 'desc' },
        select: {
            id: true,
            reviewId: true,
            versionNumber: true,
            systemLabel: true,
            lawyerNote: true,
            createdById: true,
            createdAt: true,
            createdBy: { select: { name: true } },
        },
    })
}

export async function getContractReviewVersionByIdDAO(id: number): Promise<contractReviewVersions | null> {
    return prisma.contractReviewVersions.findUnique({ where: { id } })
}

export async function updateContractReviewVersionNoteDAO(id: number, lawyerNote: string | null): Promise<contractReviewVersions> {
    return prisma.contractReviewVersions.update({ where: { id }, data: { lawyerNote } })
}
