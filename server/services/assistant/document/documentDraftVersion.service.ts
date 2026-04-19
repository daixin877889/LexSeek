/**
 * DocumentDraftVersion Service
 *
 * 用户主动保存的版本（里程碑），owner-only。
 * - createVersionService: 原子递增 draft.maxVersionNo 保证删除不回收版本号
 * - restoreVersionService: 先 workspace-backup 再覆盖 draft.values
 * - renameVersionService / deleteVersionService: owner-only
 */

import type { Prisma } from '#shared/types/prisma'
import { getDocumentDraftDAO } from './documentDraft.dao'
import {
    createVersionDAO,
    listVersionsDAO,
    getVersionByIdDAO,
    updateVersionNameDAO,
    deleteVersionDAO,
} from './documentDraftVersion.dao'
import { createSnapshotService } from './documentDraftSnapshot.service'

type ServiceError = { error: string; code: number }

/**
 * 原子递增 draft.maxVersionNo 后创建版本，版本号永不回收。
 */
export async function createVersionService(
    userId: number,
    draftId: number,
    name: string,
): Promise<{ version: Awaited<ReturnType<typeof createVersionDAO>> } | ServiceError> {
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权访问此草稿', code: 403 }

    const version = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const bumped = await tx.documentDrafts.update({
            where: { id: draftId },
            data: { maxVersionNo: { increment: 1 } },
            select: { maxVersionNo: true, values: true, title: true },
        })
        return createVersionDAO(
            {
                draftId,
                versionNo: bumped.maxVersionNo,
                name,
                values: (bumped.values as Record<string, unknown>) ?? {},
                titleAt: bumped.title ?? '',
            },
            tx,
        )
    })

    return { version }
}

/**
 * 查询指定 draft 的版本列表，校验 owner 归属。
 */
export async function listVersionsForUserService(
    userId: number,
    draftId: number,
): Promise<{ versions: Awaited<ReturnType<typeof listVersionsDAO>> } | ServiceError> {
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权访问此草稿', code: 403 }

    const versions = await listVersionsDAO(draftId)
    return { versions }
}

/**
 * 恢复版本：先写 workspace-backup 快照，再将 draft.values 覆盖为版本值。
 * 整个操作在同一事务中完成。
 */
export async function restoreVersionService(
    userId: number,
    draftId: number,
    versionId: number,
): Promise<{ draft: Awaited<ReturnType<typeof prisma.documentDrafts.update>> } | ServiceError> {
    const [draft, version] = await Promise.all([
        getDocumentDraftDAO(draftId),
        getVersionByIdDAO(versionId),
    ])
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权访问此草稿', code: 403 }
    if (!version || version.draftId !== draftId) {
        return { error: '版本不存在', code: 404 }
    }

    const currentValues = (draft.values as Record<string, unknown>) ?? {}
    const restoredValues = (version.values as Record<string, unknown>) ?? {}

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await createSnapshotService(draftId, 'workspace-backup', { values: currentValues }, tx)
        return tx.documentDrafts.update({
            where: { id: draftId },
            data: { values: restoredValues as any, updatedAt: new Date() },
        })
    })

    return { draft: updated }
}

/**
 * 重命名版本，校验 owner 归属。
 */
export async function renameVersionService(
    userId: number,
    versionId: number,
    name: string,
): Promise<{ version: Awaited<ReturnType<typeof updateVersionNameDAO>> } | ServiceError> {
    const version = await getVersionByIdDAO(versionId)
    if (!version) return { error: '版本不存在', code: 404 }

    const draft = await getDocumentDraftDAO(version.draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权修改此版本', code: 403 }

    const updated = await updateVersionNameDAO(versionId, name)
    return { version: updated }
}

/**
 * 删除版本（物理删除），校验 owner 归属。
 */
export async function deleteVersionService(
    userId: number,
    versionId: number,
): Promise<{ ok: true } | ServiceError> {
    const version = await getVersionByIdDAO(versionId)
    if (!version) return { error: '版本不存在', code: 404 }

    const draft = await getDocumentDraftDAO(version.draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权删除此版本', code: 403 }

    await deleteVersionDAO(versionId)
    return { ok: true }
}
