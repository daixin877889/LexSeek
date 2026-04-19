/**
 * DocumentDraftVersion DAO
 *
 * 用户主动保存的版本快照；只读，无上限；支持 CRUD 与重命名。
 * versionNo 自增逻辑在 Service 层事务中 SELECT MAX+1，此处仅提供原子写。
 */

import type { Prisma } from '#shared/types/prisma'

export interface CreateVersionInput {
    draftId: number
    versionNo: number
    name: string
    values: Record<string, unknown>
    titleAt: string
}

/**
 * 创建版本记录。
 * @param input 版本输入数据
 * @param tx 可选事务客户端
 */
export async function createVersionDAO(
    input: CreateVersionInput,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftVersions.create({
        data: {
            draftId: input.draftId,
            versionNo: input.versionNo,
            name: input.name,
            values: input.values as any,
            titleAt: input.titleAt,
        },
    })
}

/**
 * 按 ID 查询单条版本。
 * 不存在返回 null。
 * @param id 版本 ID
 * @param tx 可选事务客户端
 */
export async function getVersionByIdDAO(
    id: number,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftVersions.findUnique({ where: { id } })
}

/**
 * 按 draftId 查询版本列表。
 * 按 createdAt 降序排序（最新在前）。
 * @param draftId 草稿 ID
 * @param tx 可选事务客户端
 */
export async function listVersionsDAO(
    draftId: number,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftVersions.findMany({
        where: { draftId },
        orderBy: { createdAt: 'desc' },
    })
}

/**
 * 重命名版本。
 * @param id 版本 ID
 * @param name 新的版本名称
 * @param tx 可选事务客户端
 */
export async function updateVersionNameDAO(
    id: number,
    name: string,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftVersions.update({
        where: { id },
        data: { name },
    })
}

/**
 * 删除版本（物理删除）。
 * @param id 版本 ID
 * @param tx 可选事务客户端
 */
export async function deleteVersionDAO(
    id: number,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftVersions.delete({ where: { id } })
}
