/**
 * DocumentDraftSnapshot Service
 *
 * 封装快照业务规则：
 * - 10 条共享上限（每次 insert 后顺序 prune，失败仅 warn 不阻塞）
 * - 字段级/全量恢复前自动 workspace-backup
 * - owner-only 校验
 */

import type { Prisma } from '#shared/types/prisma'
import { getDocumentDraftDAO } from './documentDraft.dao'
import { createSnapshotDAO, listSnapshotsDAO, getSnapshotByIdDAO } from './documentDraftSnapshot.dao'

/** 每个 draft 保留快照的最大条数 */
const SNAPSHOT_KEEP = 10

type ServiceError = { error: string; code: number }

export interface SnapshotPayload {
    values: Record<string, unknown>
    aiTitle?: string | null
}

/**
 * 创建快照并尝试清理超限快照，保持 draftId 下总数 ≤ SNAPSHOT_KEEP。
 * 清理失败仅 warn 不阻塞主流程——insert 与 prune 顺序执行、不包外层事务。
 */
export async function createSnapshotService(
    draftId: number,
    source: 'ai-extract' | 'workspace-backup',
    payload: SnapshotPayload,
    tx?: Prisma.TransactionClient,
) {
    const snap = await createSnapshotDAO({ draftId, source, values: payload.values, aiTitle: payload.aiTitle ?? null }, tx)

    const db = tx ?? prisma
    try {
        await db.$executeRaw`
            DELETE FROM "document_draft_snapshots"
            WHERE "draft_id" = ${draftId}
              AND "id" NOT IN (
                SELECT "id" FROM "document_draft_snapshots"
                WHERE "draft_id" = ${draftId}
                ORDER BY "created_at" DESC
                LIMIT ${SNAPSHOT_KEEP}
              )
        `
    } catch (err) {
        logger.warn('清理旧快照失败（不阻塞）', { draftId, error: err })
    }

    return snap
}

/**
 * 查询指定 draft 的快照列表，校验 owner 归属。
 */
export async function listSnapshotsForUserService(
    userId: number,
    draftId: number,
): Promise<{ snapshots: Awaited<ReturnType<typeof listSnapshotsDAO>> } | ServiceError> {
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权访问此草稿', code: 403 }

    const snapshots = await listSnapshotsDAO(draftId)
    return { snapshots }
}

/**
 * 用快照的 values 覆盖工作区（全量或指定字段）。
 * 事务内：1) 先写 workspace-backup 快照 → 2) 合并 values → 3) 更新 draft。
 * 未知 fieldNames 直接跳过，不报错。
 */
export async function applySnapshotFieldsService(
    userId: number,
    draftId: number,
    snapshotId: number,
    fieldNames?: string[],
): Promise<{ draft: any } | ServiceError> {
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权访问此草稿', code: 403 }

    const snap = await getSnapshotByIdDAO(snapshotId)
    if (!snap || snap.draftId !== draftId) return { error: '快照不存在', code: 404 }

    const currentValues = (draft.values as Record<string, unknown>) ?? {}
    const snapValues = (snap.values as Record<string, unknown>) ?? {}

    let mergedValues: Record<string, unknown>
    if (!fieldNames) {
        mergedValues = { ...currentValues, ...snapValues }
    } else {
        mergedValues = { ...currentValues }
        for (const f of fieldNames) {
            if (f in snapValues) mergedValues[f] = snapValues[f]
        }
    }

    const updated = await prisma.$transaction(async (tx) => {
        await createSnapshotService(draftId, 'workspace-backup', { values: currentValues }, tx)
        return tx.documentDrafts.update({
            where: { id: draftId },
            data: { values: mergedValues as any, updatedAt: new Date() },
        })
    })

    return { draft: updated }
}
