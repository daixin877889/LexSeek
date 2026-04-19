/**
 * DocumentDraftSnapshot DAO 测试
 *
 * 覆盖 documentDraftSnapshot.dao 的 CRUD 方法。
 * 真打测试数据库（真实集成测试），每个 case 独立清理。
 *
 * **Feature: document-generation**
 * **Validates: Task 3**
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import '../../../server/case/test-setup'
import {
    createTestUser,
    createTestOssFile,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
    createEmptyTestIds,
} from '../../../server/case/test-db-helper'
import {
    createDocumentDraftDAO,
} from '../../../../server/services/assistant/document/documentDraft.dao'
import {
    createSnapshotDAO,
    listSnapshotsDAO,
    getSnapshotByIdDAO,
} from '../../../../server/services/assistant/document/documentDraftSnapshot.dao'

// ==================== 本地测试数据扩展 ====================

interface SnapshotTestIds extends CaseTestIds {
    templateIds: number[]
    draftIds: number[]
    snapshotIds: number[]
}

const createEmptySnapshotTestIds = (): SnapshotTestIds => ({
    ...createEmptyTestIds(),
    templateIds: [],
    draftIds: [],
    snapshotIds: [],
})

const cleanupSnapshotTestData = async (testIds: SnapshotTestIds) => {
    // 先清理 snapshots，再清 drafts，再清 templates（外键约束）
    if (testIds.snapshotIds.length > 0) {
        await getTestPrisma().documentDraftSnapshots.deleteMany({
            where: { id: { in: testIds.snapshotIds } },
        })
    }
    if (testIds.draftIds.length > 0) {
        await getTestPrisma().documentDrafts.deleteMany({
            where: { id: { in: testIds.draftIds } },
        })
    }
    if (testIds.templateIds.length > 0) {
        await getTestPrisma().documentTemplates.deleteMany({
            where: { id: { in: testIds.templateIds } },
        })
    }
    await cleanupTestData(testIds)
}

// ==================== 辅助创建函数 ====================

const createTestTemplate = async (testIds: SnapshotTestIds, userId: number | null = null) => {
    const ossFile = await createTestOssFile({ userId: userId ?? undefined }, testIds)
    testIds.ossFileIds.push(ossFile.id)

    const template = await getTestPrisma().documentTemplates.create({
        data: {
            name: `测试模板_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            category: '起诉状',
            scope: 'global',
            userId: null,
            ossFileId: ossFile.id,
            placeholders: [{ name: 'plaintiff', firstContext: '原告：{{plaintiff}}' }],
        },
    })
    testIds.templateIds.push(template.id)
    return template
}

const createTestDraft = async (testIds: SnapshotTestIds) => {
    const template = await createTestTemplate(testIds)
    const user = await createTestUser()
    testIds.userIds.push(user.id)

    const draft = await createDocumentDraftDAO({
        userId: user.id,
        templateId: template.id,
        sessionId: `sid-snap-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
        status: 'drafting',
        values: { plaintiff: '原告名称' },
        sourceRef: null,
        metadata: null,
        caseId: null,
    })
    testIds.draftIds.push(draft.id)
    return draft
}

// ==================== 测试用例 ====================

describe('documentDraftSnapshot.dao', () => {
    let testIds: SnapshotTestIds

    beforeAll(async () => {
        testIds = createEmptySnapshotTestIds()
    })

    afterEach(async () => {
        await cleanupSnapshotTestData(testIds)
        testIds = createEmptySnapshotTestIds()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    it('createSnapshotDAO 创建快照并能被 getSnapshotByIdDAO 查到', async () => {
        const draft = await createTestDraft(testIds)
        const snap = await createSnapshotDAO({
            draftId: draft.id,
            source: 'ai-extract',
            values: { name: 'Alice' },
            aiTitle: '测试标题',
        })
        testIds.snapshotIds.push(snap.id)

        expect(snap.id).toBeGreaterThan(0)
        expect(snap.draftId).toBe(draft.id)
        expect(snap.source).toBe('ai-extract')
        expect(snap.aiTitle).toBe('测试标题')
        expect(snap.values).toEqual({ name: 'Alice' })

        const got = await getSnapshotByIdDAO(snap.id)
        expect(got).not.toBeNull()
        expect(got?.id).toBe(snap.id)
        expect(got?.source).toBe('ai-extract')
        expect(got?.aiTitle).toBe('测试标题')
        expect(got?.values).toEqual({ name: 'Alice' })
    })

    it('createSnapshotDAO 支持可选的 aiTitle', async () => {
        const draft = await createTestDraft(testIds)
        const snap = await createSnapshotDAO({
            draftId: draft.id,
            source: 'workspace-backup',
            values: { status: 'pending' },
        })
        testIds.snapshotIds.push(snap.id)

        expect(snap.aiTitle).toBeNull()
        const got = await getSnapshotByIdDAO(snap.id)
        expect(got?.aiTitle).toBeNull()
    })

    it('listSnapshotsDAO 返回按 createdAt 降序的快照列表', async () => {
        const draft = await createTestDraft(testIds)

        const snap1 = await createSnapshotDAO({
            draftId: draft.id,
            source: 'ai-extract',
            values: { a: '1' },
            aiTitle: 'title1',
        })
        testIds.snapshotIds.push(snap1.id)

        // 短暂延迟确保时间戳不同
        await new Promise(r => setTimeout(r, 5))

        const snap2 = await createSnapshotDAO({
            draftId: draft.id,
            source: 'workspace-backup',
            values: { a: '2' },
            aiTitle: 'title2',
        })
        testIds.snapshotIds.push(snap2.id)

        const list = await listSnapshotsDAO(draft.id)
        expect(list).toHaveLength(2)
        // 应按 createdAt 降序，最新的在前
        expect(list[0]!.id).toBe(snap2.id)
        expect(list[0]!.source).toBe('workspace-backup')
        expect(list[0]!.aiTitle).toBe('title2')
        expect(list[1]!.id).toBe(snap1.id)
        expect(list[1]!.source).toBe('ai-extract')
        expect(list[1]!.aiTitle).toBe('title1')
    })

    it('listSnapshotsDAO 返回空列表当无快照', async () => {
        const draft = await createTestDraft(testIds)
        const list = await listSnapshotsDAO(draft.id)
        expect(list).toHaveLength(0)
    })

    it('getSnapshotByIdDAO 不存在的 ID 返回 null', async () => {
        const got = await getSnapshotByIdDAO(999999)
        expect(got).toBeNull()
    })

    it('createSnapshotDAO 支持事务客户端', async () => {
        const draft = await createTestDraft(testIds)
        const db = getTestPrisma()

        const snap = await db.$transaction(async (tx) => {
            return createSnapshotDAO(
                {
                    draftId: draft.id,
                    source: 'ai-extract',
                    values: { tx: 'test' },
                },
                tx,
            )
        })
        testIds.snapshotIds.push(snap.id)

        expect(snap.id).toBeGreaterThan(0)
        const got = await getSnapshotByIdDAO(snap.id)
        expect(got?.values).toEqual({ tx: 'test' })
    })

    it('listSnapshotsDAO 只返回指定 draftId 的快照', async () => {
        const draft1 = await createTestDraft(testIds)
        const draft2 = await createTestDraft(testIds)

        const snap1 = await createSnapshotDAO({
            draftId: draft1.id,
            source: 'ai-extract',
            values: { draft: '1' },
        })
        testIds.snapshotIds.push(snap1.id)

        const snap2 = await createSnapshotDAO({
            draftId: draft2.id,
            source: 'ai-extract',
            values: { draft: '2' },
        })
        testIds.snapshotIds.push(snap2.id)

        const list1 = await listSnapshotsDAO(draft1.id)
        const list2 = await listSnapshotsDAO(draft2.id)

        expect(list1).toHaveLength(1)
        expect(list1[0]!.draftId).toBe(draft1.id)
        expect(list2).toHaveLength(1)
        expect(list2[0]!.draftId).toBe(draft2.id)
    })
})
