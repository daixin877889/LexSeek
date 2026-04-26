/**
 * DocumentDraftSnapshot DAO
 *
 * 文书草稿快照（AI 每次重跑 + 覆盖工作区前自动备份）。
 * 10 条共享上限的清理逻辑由 Service 层在事务内处理，DAO 只做基础 CRUD。
 */

import type { Prisma } from '#shared/types/prisma'

export interface CreateSnapshotInput {
    draftId: number
    /** 'ai-extract' | 'workspace-backup' */
    source: string
    values: Record<string, unknown>
    aiTitle?: string | null
}

/**
 * 创建快照记录。
 * @param input 快照输入数据
 * @param tx 可选事务客户端
 */
export async function createSnapshotDAO(
    input: CreateSnapshotInput,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftSnapshots.create({
        data: {
            draftId: input.draftId,
            source: input.source,
            values: input.values as any,
            aiTitle: input.aiTitle ?? null,
        },
    })
}

/**
 * 按 ID 查询单条快照。
 * 不存在返回 null。
 * @param id 快照 ID
 * @param tx 可选事务客户端
 */
export async function getSnapshotByIdDAO(
    id: number,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftSnapshots.findUnique({ where: { id } })
}

/**
 * 按 draftId 查询快照列表。
 * 按 createdAt 降序排序（最新在前）。
 * @param draftId 草稿 ID
 * @param tx 可选事务客户端
 */
export async function listSnapshotsDAO(
    draftId: number,
    tx?: Prisma.TransactionClient,
) {
    const db = tx ?? prisma
    return db.documentDraftSnapshots.findMany({
        where: { draftId },
        orderBy: { createdAt: 'desc' },
    })
}
