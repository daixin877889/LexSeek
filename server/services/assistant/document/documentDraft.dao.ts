/**
 * DocumentDraft DAO（此处仅最小 stub：updateDocumentDraftDAO）
 *
 * 其余方法由 Task 3.10 补齐。
 */
import type { Prisma } from '#shared/types/prisma'

export async function updateDocumentDraftDAO(
    id: number,
    data: Prisma.documentDraftsUpdateInput,
    tx?: Prisma.TransactionClient,
) {
    return (tx ?? prisma).documentDrafts.update({ where: { id }, data })
}
