/**
 * ContractAnnotation DAO 层
 *
 * 提供 ContractAnnotation 表的 CRUD 操作。
 * 决策 11 铁律：批注永不物理删除，律师删自己批注走软删（deletedAt）。
 * list 函数必须过滤 deletedAt IS NULL，以保证软删批注不出现在工作区与 snapshot 中。
 *
 * **Feature: contract-review-versioning-phase-a**
 */
import type { contractAnnotations } from '~~/generated/prisma/client'
import type { AnnotationAuthorType } from '#shared/types/contract'

export interface CreateContractAnnotationInput {
    reviewId: number
    riskId: number
    parentAnnotationId?: number | null
    authorType: AnnotationAuthorType
    authorName: string
    authorUserId?: number | null
    content: string
}

export async function createContractAnnotationDAO(input: CreateContractAnnotationInput): Promise<contractAnnotations> {
    return prisma.contractAnnotations.create({ data: input })
}

export async function updateContractAnnotationDAO(
    id: number,
    input: Partial<Pick<contractAnnotations, 'content'>>,
): Promise<contractAnnotations> {
    return prisma.contractAnnotations.update({ where: { id }, data: input })
}

/** 按 riskId 查询批注列表，过滤软删（deletedAt IS NULL），按创建时间升序 */
export async function listContractAnnotationsByRiskDAO(riskId: number): Promise<contractAnnotations[]> {
    return prisma.contractAnnotations.findMany({
        where: { riskId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
    })
}

/** 按 reviewId 查询该 review 下所有批注，过滤软删，按 riskId + createdAt 排序 */
export async function listContractAnnotationsByReviewDAO(reviewId: number): Promise<contractAnnotations[]> {
    return prisma.contractAnnotations.findMany({
        where: { reviewId, deletedAt: null },
        orderBy: [{ riskId: 'asc' }, { createdAt: 'asc' }],
    })
}

/**
 * 软删：批注永不物理删除（决策 11 铁律）。
 * 律师删自己批注时调用此接口，只设 deletedAt，数据行仍保留在 DB。
 */
export async function softDeleteContractAnnotationDAO(id: number): Promise<void> {
    await prisma.contractAnnotations.update({
        where: { id },
        data: { deletedAt: new Date() },
    })
}

/** 按 id 查询单条批注（包含软删的），供 service 层做 owner 校验 */
export async function getContractAnnotationByIdDAO(id: number): Promise<contractAnnotations | null> {
    return prisma.contractAnnotations.findUnique({ where: { id } })
}
