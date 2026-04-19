/**
 * DocumentDraftSnapshot Service 测试
 *
 * 覆盖 createSnapshotService / listSnapshotsForUserService / applySnapshotFieldsService。
 * 真实数据库集成测试，每个 case 独立创建/清理数据。
 *
 * **Feature: document-generation**
 * **Validates: Task 6**
 */

import { describe, it, expect, afterEach, afterAll } from 'vitest'
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
import { createDocumentDraftDAO } from '~~/server/services/assistant/document/documentDraft.dao'
import {
    createSnapshotService,
    applySnapshotFieldsService,
    listSnapshotsForUserService,
} from '~~/server/services/assistant/document/documentDraftSnapshot.service'
import { listSnapshotsDAO } from '~~/server/services/assistant/document/documentDraftSnapshot.dao'

// ==================== 本地测试数据追踪 ====================

interface SnapshotServiceTestIds extends CaseTestIds {
    templateIds: number[]
    draftIds: number[]
    snapshotIds: number[]
}

const createEmptyServiceTestIds = (): SnapshotServiceTestIds => ({
    ...createEmptyTestIds(),
    templateIds: [],
    draftIds: [],
    snapshotIds: [],
})

const cleanupServiceTestData = async (testIds: SnapshotServiceTestIds) => {
    const db = getTestPrisma()
    if (testIds.snapshotIds.length > 0) {
        await db.documentDraftSnapshots.deleteMany({
            where: { id: { in: testIds.snapshotIds } },
        })
    }
    if (testIds.draftIds.length > 0) {
        // 先清理快照（外键约束）
        await db.documentDraftSnapshots.deleteMany({
            where: { draftId: { in: testIds.draftIds } },
        })
        await db.documentDrafts.deleteMany({
            where: { id: { in: testIds.draftIds } },
        })
    }
    if (testIds.templateIds.length > 0) {
        await db.documentTemplates.deleteMany({
            where: { id: { in: testIds.templateIds } },
        })
    }
    await cleanupTestData(testIds)
}

// ==================== 辅助创建函数 ====================

/**
 * 创建真实的测试 draft（含用户和模板）
 */
async function makeDraft(
    testIds: SnapshotServiceTestIds,
    values: Record<string, unknown> = {},
) {
    const user = await createTestUser()
    testIds.userIds.push(user.id)

    const ossFile = await createTestOssFile({ userId: user.id }, testIds)
    testIds.ossFileIds.push(ossFile.id)

    const template = await getTestPrisma().documentTemplates.create({
        data: {
            name: `测试模板_svc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            category: '起诉状',
            scope: 'global',
            userId: null,
            ossFileId: ossFile.id,
            placeholders: [{ name: 'name', firstContext: '{{name}}' }, { name: 'amount', firstContext: '{{amount}}' }],
        },
    })
    testIds.templateIds.push(template.id)

    const draft = await createDocumentDraftDAO({
        userId: user.id,
        templateId: template.id,
        sessionId: `sid-svc-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
        status: 'ready',
        values,
        sourceRef: null,
        metadata: null,
        caseId: null,
    })
    testIds.draftIds.push(draft.id)

    return { draft, user }
}

// ==================== 测试用例 ====================

let testIds: SnapshotServiceTestIds = createEmptyServiceTestIds()

afterEach(async () => {
    await cleanupServiceTestData(testIds)
    testIds = createEmptyServiceTestIds()
})

afterAll(async () => {
    await disconnectTestDb()
})

describe('createSnapshotService', () => {
    it('写入单条快照并能被 listSnapshotsDAO 查到', async () => {
        const { draft } = await makeDraft(testIds)
        const snap = await createSnapshotService(draft.id, 'ai-extract', { values: { a: '1' }, aiTitle: 'T' })
        testIds.snapshotIds.push(snap.id)

        const list = await listSnapshotsDAO(draft.id)
        expect(list).toHaveLength(1)
        expect(list[0]!.aiTitle).toBe('T')
    })

    it('插入第 11 条时最老一条被清（总数保持 10）', async () => {
        const { draft } = await makeDraft(testIds)
        const snaps: number[] = []
        for (let i = 0; i < 11; i++) {
            const s = await createSnapshotService(draft.id, 'ai-extract', { values: { i: String(i) } })
            snaps.push(s.id)
            // 短暂延迟确保 createdAt 不同
            await new Promise(r => setTimeout(r, 2))
        }
        testIds.snapshotIds.push(...snaps)

        const list = await listSnapshotsDAO(draft.id)
        expect(list).toHaveLength(10)
        // 最老的 i=0 那条应当被删除，最新的 i=10 应当存在
        const oldest = list[list.length - 1]!
        expect((oldest.values as any).i).not.toBe('0')
    })
})

describe('listSnapshotsForUserService', () => {
    it('非 owner 返 403', async () => {
        const { draft, user } = await makeDraft(testIds)
        const snap = await createSnapshotService(draft.id, 'ai-extract', { values: {} })
        testIds.snapshotIds.push(snap.id)

        const wrongUserId = user.id + 9999
        const r = await listSnapshotsForUserService(wrongUserId, draft.id)
        expect('error' in r && r.code).toBe(403)
    })

    it('owner 可拉到列表', async () => {
        const { draft, user } = await makeDraft(testIds)
        const snap = await createSnapshotService(draft.id, 'ai-extract', { values: {} })
        testIds.snapshotIds.push(snap.id)

        const r = await listSnapshotsForUserService(user.id, draft.id)
        expect('snapshots' in r && r.snapshots).toHaveLength(1)
    })
})

describe('applySnapshotFieldsService', () => {
    it('先写 workspace-backup 再覆盖（全量）', async () => {
        const { draft, user } = await makeDraft(testIds, { name: 'old', amount: '100' })
        const snap = await createSnapshotService(draft.id, 'ai-extract', {
            values: { name: 'new', amount: '200' },
        })
        testIds.snapshotIds.push(snap.id)

        const r = await applySnapshotFieldsService(user.id, draft.id, snap.id)
        expect('draft' in r).toBe(true)
        expect('draft' in r && (r.draft.values as any).name).toBe('new')
        expect('draft' in r && (r.draft.values as any).amount).toBe('200')

        const list = await listSnapshotsDAO(draft.id)
        expect(list.filter(s => s.source === 'workspace-backup')).toHaveLength(1)
    })

    it('只覆盖指定 fieldNames', async () => {
        const { draft, user } = await makeDraft(testIds, { name: 'old', amount: '100' })
        const snap = await createSnapshotService(draft.id, 'ai-extract', {
            values: { name: 'new', amount: '200' },
        })
        testIds.snapshotIds.push(snap.id)

        const r = await applySnapshotFieldsService(user.id, draft.id, snap.id, ['name'])
        expect('draft' in r && (r.draft.values as any).name).toBe('new')
        expect('draft' in r && (r.draft.values as any).amount).toBe('100')
    })

    it('未知 fieldName 跳过，不抛错', async () => {
        const { draft, user } = await makeDraft(testIds, { name: 'old' })
        const snap = await createSnapshotService(draft.id, 'ai-extract', { values: { name: 'new' } })
        testIds.snapshotIds.push(snap.id)

        const r = await applySnapshotFieldsService(user.id, draft.id, snap.id, ['name', 'no-such-field'])
        expect('draft' in r && (r.draft.values as any).name).toBe('new')
    })

    it('非 owner 返 403', async () => {
        const { draft, user } = await makeDraft(testIds)
        const snap = await createSnapshotService(draft.id, 'ai-extract', { values: {} })
        testIds.snapshotIds.push(snap.id)

        const wrongUserId = user.id + 9999
        const r = await applySnapshotFieldsService(wrongUserId, draft.id, snap.id)
        expect('error' in r && r.code).toBe(403)
    })

    it('snapshot 不属于该 draft 返 404', async () => {
        const { draft: d1, user } = await makeDraft(testIds)
        const { draft: d2 } = await makeDraft(testIds)
        // 注意：d2 属于另一个用户，这里我们把 d2 迁移给 user 所有只是模拟跨 draft
        // 实际上用 d1 的 snap 去 apply 到 d2 即可（不同 draft 的 owner 可以是不同的，但 snapId 归属 draft 检查是关键）
        const snap = await createSnapshotService(d1.id, 'ai-extract', { values: {} })
        testIds.snapshotIds.push(snap.id)

        // 用 user 对 d2 操作，但 snap 属于 d1
        // d2 可能是不同 userId，先用 d2 的真实 user 来确保通过 owner 校验
        // 重新创建一个属于同一 user 的 d2'
        const ossFile = await createTestOssFile({ userId: user.id }, testIds)
        const template2 = await getTestPrisma().documentTemplates.create({
            data: {
                name: `测试模板_cross_${Date.now()}`,
                category: '合同',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            },
        })
        testIds.templateIds.push(template2.id)
        const d3 = await createDocumentDraftDAO({
            userId: user.id,
            templateId: template2.id,
            sessionId: `sid-svc-cross-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
            status: 'ready',
            values: {},
            sourceRef: null,
            metadata: null,
            caseId: null,
        })
        testIds.draftIds.push(d3.id)

        const r = await applySnapshotFieldsService(user.id, d3.id, snap.id)
        expect('error' in r && r.code).toBe(404)
    })
})
