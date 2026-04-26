/**
 * DocumentDraftVersion Service 测试
 *
 * 覆盖 createVersionService / listVersionsForUserService /
 *        restoreVersionService / renameVersionService / deleteVersionService。
 * 真实数据库集成测试，每个 case 独立创建/清理数据。
 *
 * **Feature: document-generation**
 * **Validates: Task 7**
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
import { createDocumentDraftDAO, updateDocumentDraftDAO } from '~~/server/agents/document/documentDraft.dao'
import {
    createVersionService,
    listVersionsForUserService,
    restoreVersionService,
    renameVersionService,
    deleteVersionService,
} from '~~/server/agents/document/documentDraftVersion.service'
import { listSnapshotsDAO } from '~~/server/agents/document/documentDraftSnapshot.dao'

// ==================== 测试 ID 追踪 ====================

interface VersionServiceTestIds extends CaseTestIds {
    templateIds: number[]
    draftIds: number[]
    versionIds: number[]
    snapshotIds: number[]
}

const createEmptyVersionTestIds = (): VersionServiceTestIds => ({
    ...createEmptyTestIds(),
    templateIds: [],
    draftIds: [],
    versionIds: [],
    snapshotIds: [],
})

const cleanupVersionTestData = async (testIds: VersionServiceTestIds) => {
    const db = getTestPrisma()
    if (testIds.versionIds.length > 0) {
        await db.documentDraftVersions.deleteMany({
            where: { id: { in: testIds.versionIds } },
        })
    }
    if (testIds.snapshotIds.length > 0) {
        await db.documentDraftSnapshots.deleteMany({
            where: { id: { in: testIds.snapshotIds } },
        })
    }
    if (testIds.draftIds.length > 0) {
        // 先清理关联子表（外键约束）
        await db.documentDraftVersions.deleteMany({
            where: { draftId: { in: testIds.draftIds } },
        })
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

// ==================== Fixture 辅助函数 ====================

/**
 * 创建真实的测试 draft（含独立用户和模板）。
 * 沿用 documentDraftSnapshot.service.test.ts 的模式。
 */
async function makeDraft(
    testIds: VersionServiceTestIds,
    values: Record<string, unknown> = {},
    title = 'T-260419',
) {
    const user = await createTestUser()
    testIds.userIds.push(user.id)

    const ossFile = await createTestOssFile({ userId: user.id }, testIds)
    testIds.ossFileIds.push(ossFile.id)

    const template = await getTestPrisma().documentTemplates.create({
        data: {
            name: `测试模板_ver_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            category: '起诉状',
            scope: 'global',
            userId: null,
            ossFileId: ossFile.id,
            placeholders: [
                { name: 'name', firstContext: '{{name}}' },
                { name: 'amount', firstContext: '{{amount}}' },
            ],
        },
    })
    testIds.templateIds.push(template.id)

    const draft = await createDocumentDraftDAO({
        userId: user.id,
        templateId: template.id,
        sessionId: `sid-ver-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
        status: 'ready',
        values,
        sourceRef: null,
        metadata: null,
        caseId: null,
        title,
        titleOverridden: false,
    })
    testIds.draftIds.push(draft.id)

    return { draft, user }
}

// ==================== 测试用例 ====================

let testIds: VersionServiceTestIds = createEmptyVersionTestIds()

afterEach(async () => {
    await cleanupVersionTestData(testIds)
    testIds = createEmptyVersionTestIds()
})

afterAll(async () => {
    await disconnectTestDb()
})

describe('createVersionService', () => {
    it('版本号从 1 连续自增', async () => {
        const { draft, user } = await makeDraft(testIds, { a: '1' })
        const r1 = await createVersionService(user.id, draft.id, 'First')
        const r2 = await createVersionService(user.id, draft.id, 'Second')
        expect('version' in r1 && r1.version.versionNo).toBe(1)
        expect('version' in r2 && r2.version.versionNo).toBe(2)
        if ('version' in r1) testIds.versionIds.push(r1.version.id)
        if ('version' in r2) testIds.versionIds.push(r2.version.id)
    })

    it('values 和 titleAt 快照自 draft', async () => {
        const { draft, user } = await makeDraft(testIds, { name: 'Alice' })
        const r = await createVersionService(user.id, draft.id, 'V1')
        expect('version' in r && (r.version.values as any).name).toBe('Alice')
        expect('version' in r && r.version.titleAt).toBe('T-260419')
        if ('version' in r) testIds.versionIds.push(r.version.id)
    })

    it('非 owner 返 403', async () => {
        const { draft } = await makeDraft(testIds)
        const r = await createVersionService(99999999, draft.id, 'X')
        expect('error' in r && r.code).toBe(403)
    })

    it('删除后版本号不回收（V3 删除后下一个仍是 V4）', async () => {
        const { draft, user } = await makeDraft(testIds)
        const r1 = await createVersionService(user.id, draft.id, 'V1')
        const r2 = await createVersionService(user.id, draft.id, 'V2')
        const r3 = await createVersionService(user.id, draft.id, 'V3')

        if ('version' in r1) testIds.versionIds.push(r1.version.id)
        if ('version' in r2) testIds.versionIds.push(r2.version.id)

        // 删除 V3，版本号 3 不回收
        if ('version' in r3) await deleteVersionService(user.id, r3.version.id)

        const r4 = await createVersionService(user.id, draft.id, 'V4')
        if ('version' in r4) testIds.versionIds.push(r4.version.id)

        expect('version' in r4 && r4.version.versionNo).toBe(4)
    })
})

describe('restoreVersionService', () => {
    it('恢复前自动快照当前工作区（workspace-backup）', async () => {
        const { draft, user } = await makeDraft(testIds, { a: 'current' })
        const vRes = await createVersionService(user.id, draft.id, 'V1')
        if (!('version' in vRes)) throw new Error('version 创建失败')
        testIds.versionIds.push(vRes.version.id)

        // 修改工作区
        await updateDocumentDraftDAO(draft.id, { values: { a: 'edited' } as any })

        const restored = await restoreVersionService(user.id, draft.id, vRes.version.id)
        expect('draft' in restored && (restored.draft.values as any).a).toBe('current')

        const snapshots = await listSnapshotsDAO(draft.id)
        const backup = snapshots.find(s => s.source === 'workspace-backup')
        expect(backup).toBeDefined()
        expect((backup!.values as any).a).toBe('edited')
    })

    it('版本不属于该 draft 返 404', async () => {
        const { draft: d1, user } = await makeDraft(testIds)

        // 为同一用户创建第二个 draft，使其通过 owner 校验
        const ossFile = await createTestOssFile({ userId: user.id }, testIds)
        testIds.ossFileIds.push(ossFile.id)
        const template2 = await getTestPrisma().documentTemplates.create({
            data: {
                name: `测试模板_ver2_${Date.now()}`,
                category: '合同',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            },
        })
        testIds.templateIds.push(template2.id)
        const d2 = await createDocumentDraftDAO({
            userId: user.id,
            templateId: template2.id,
            sessionId: `sid-ver-cross-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
            status: 'ready',
            values: {},
            sourceRef: null,
            metadata: null,
            caseId: null,
        })
        testIds.draftIds.push(d2.id)

        const v = await createVersionService(user.id, d1.id, 'V1')
        if (!('version' in v)) throw new Error('version 创建失败')
        testIds.versionIds.push(v.version.id)

        // 用 d1 的版本 ID 对 d2 发起恢复（版本不属于 d2，应返回 404）
        const r = await restoreVersionService(user.id, d2.id, v.version.id)
        expect('error' in r && r.code).toBe(404)
    })
})

describe('renameVersionService', () => {
    it('重命名成功', async () => {
        const { draft, user } = await makeDraft(testIds)
        const vRes = await createVersionService(user.id, draft.id, 'old')
        if (!('version' in vRes)) throw new Error()
        testIds.versionIds.push(vRes.version.id)

        const r = await renameVersionService(user.id, vRes.version.id, 'new')
        expect('version' in r && r.version.name).toBe('new')
    })

    it('非 owner 返 403', async () => {
        const { draft, user } = await makeDraft(testIds)
        const vRes = await createVersionService(user.id, draft.id, 'old')
        if (!('version' in vRes)) throw new Error()
        testIds.versionIds.push(vRes.version.id)

        const r = await renameVersionService(99999999, vRes.version.id, 'new')
        expect('error' in r && r.code).toBe(403)
    })
})

describe('listVersionsForUserService', () => {
    it('owner 可拉到列表', async () => {
        const { draft, user } = await makeDraft(testIds)
        const vRes = await createVersionService(user.id, draft.id, 'V1')
        if ('version' in vRes) testIds.versionIds.push(vRes.version.id)

        const r = await listVersionsForUserService(user.id, draft.id)
        expect('versions' in r && r.versions).toHaveLength(1)
    })

    it('非 owner 返 403', async () => {
        const { draft } = await makeDraft(testIds)
        const r = await listVersionsForUserService(99999999, draft.id)
        expect('error' in r && r.code).toBe(403)
    })
})
