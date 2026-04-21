/**
 * 合同审查清单要点 DAO 层
 *
 * - v1 不做硬删，只通过 enabled 切换停用
 * - listEnabledPlaybookPointsDAO 专用于快照写入，返回字段对齐 PlaybookPointSnapshot
 *
 * **Feature: contract-review-playbook (M7)**
 */
import { prisma } from '~~/server/utils/db'
import type { contractPlaybooks, Prisma } from '~~/generated/prisma/client'
import type { PlaybookPointSnapshot, StancePreference } from '#shared/types/contract'

type CreateInput = Omit<Prisma.contractPlaybooksUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>
type UpdateInput = Prisma.contractPlaybooksUncheckedUpdateInput

export async function createPlaybookDAO(data: CreateInput): Promise<contractPlaybooks> {
    return prisma.contractPlaybooks.create({ data })
}

export async function getPlaybookByIdDAO(id: number): Promise<contractPlaybooks | null> {
    return prisma.contractPlaybooks.findUnique({ where: { id } })
}

export interface ListPlaybooksFilter {
    contractType?: string
    enabled?: boolean
    q?: string
}

export async function listPlaybooksDAO(filter: ListPlaybooksFilter = {}): Promise<contractPlaybooks[]> {
    const where: Prisma.contractPlaybooksWhereInput = {}
    if (filter.contractType) where.contractType = filter.contractType
    if (filter.enabled !== undefined) where.enabled = filter.enabled
    if (filter.q) where.title = { contains: filter.q, mode: 'insensitive' }
    return prisma.contractPlaybooks.findMany({
        where,
        orderBy: [{ contractType: 'asc' }, { code: 'asc' }],
    })
}

export async function updatePlaybookDAO(id: number, data: UpdateInput): Promise<contractPlaybooks> {
    return prisma.contractPlaybooks.update({
        where: { id },
        data: { ...data, updatedAt: new Date() },
    })
}

/**
 * 查快照专用：只取启用项，返回结构对齐 PlaybookPointSnapshot。
 * 调用方：contractReviewMainAgent resume 分支。
 */
export async function listEnabledPlaybookPointsDAO(contractType: string): Promise<PlaybookPointSnapshot[]> {
    const rows = await prisma.contractPlaybooks.findMany({
        where: { contractType, enabled: true },
        orderBy: { code: 'asc' },
        select: {
            code: true,
            title: true,
            defaultLevel: true,
            stancePreference: true,
            checkContent: true,
            legalBasis: true,
            suggestion: true,
        },
    })
    return rows.map(r => ({
        code: r.code,
        title: r.title,
        defaultLevel: r.defaultLevel as 'high' | 'medium' | 'low',
        stancePreference: r.stancePreference as StancePreference,
        checkContent: r.checkContent,
        legalBasis: r.legalBasis ?? undefined,
        suggestion: r.suggestion ?? undefined,
    }))
}
