/**
 * DocumentDraftVersion DAO 测试
 *
 * 覆盖 documentDraftVersion.dao 的 CRUD 和重命名方法。
 * 真打测试数据库（真实集成测试），每个 case 独立清理。
 *
 * **Feature: document-generation**
 * **Validates: Task 4**
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
    createVersionDAO,
    listVersionsDAO,
    getVersionByIdDAO,
    updateVersionNameDAO,
    deleteVersionDAO,
} from '../../../../server/services/assistant/document/documentDraftVersion.dao'

// ==================== 本地测试数据扩展 ====================

interface VersionTestIds extends CaseTestIds {
    templateIds: number[]
    draftIds: number[]
    versionIds: number[]
}

const createEmptyVersionTestIds = (): VersionTestIds => ({
    ...createEmptyTestIds(),
    templateIds: [],
    draftIds: [],
    versionIds: [],
})

const cleanupVersionTestData = async (testIds: VersionTestIds) => {
    // 先清理 versions，再清 drafts，再清 templates（外键约束）
    if (testIds.versionIds.length > 0) {
        await getTestPrisma().documentDraftVersions.deleteMany({
            where: { id: { in: testIds.versionIds } },
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

const createTestTemplate = async (testIds: VersionTestIds, userId: number | null = null) => {
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

const createTestDraft = async (testIds: VersionTestIds) => {
    const template = await createTestTemplate(testIds)
    const user = await createTestUser()
    testIds.userIds.push(user.id)

    const draft = await createDocumentDraftDAO({
        userId: user.id,
        templateId: template.id,
        sessionId: `sid-ver-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
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

describe('documentDraftVersion.dao', () => {
    let testIds: VersionTestIds

    beforeAll(async () => {
        testIds = createEmptyVersionTestIds()
    })

    afterEach(async () => {
        await cleanupVersionTestData(testIds)
        testIds = createEmptyVersionTestIds()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    it('createVersionDAO 写入并按 id 获取', async () => {
        const draft = await createTestDraft(testIds)
        const v = await createVersionDAO({
            draftId: draft.id,
            versionNo: 1,
            name: '第 1 版',
            values: { a: '1' },
            titleAt: 'T-260419',
        })
        testIds.versionIds.push(v.id)

        expect(v.id).toBeGreaterThan(0)
        expect(v.draftId).toBe(draft.id)
        expect(v.versionNo).toBe(1)
        expect(v.name).toBe('第 1 版')
        expect(v.titleAt).toBe('T-260419')
        expect(v.values).toEqual({ a: '1' })

        const got = await getVersionByIdDAO(v.id)
        expect(got).not.toBeNull()
        expect(got?.id).toBe(v.id)
        expect(got?.name).toBe('第 1 版')
        expect(got?.versionNo).toBe(1)
        expect(got?.titleAt).toBe('T-260419')
        expect(got?.values).toEqual({ a: '1' })
    })

    it('listVersionsDAO 按 createdAt 降序', async () => {
        const draft = await createTestDraft(testIds)

        const v1 = await createVersionDAO({
            draftId: draft.id,
            versionNo: 1,
            name: 'V1',
            values: {},
            titleAt: 'T',
        })
        testIds.versionIds.push(v1.id)

        // 短暂延迟确保时间戳不同
        await new Promise(r => setTimeout(r, 5))

        const v2 = await createVersionDAO({
            draftId: draft.id,
            versionNo: 2,
            name: 'V2',
            values: {},
            titleAt: 'T',
        })
        testIds.versionIds.push(v2.id)

        const list = await listVersionsDAO(draft.id)
        expect(list).toHaveLength(2)
        // 应按 createdAt 降序，最新的在前
        expect(list[0]!.id).toBe(v2.id)
        expect(list[0]!.name).toBe('V2')
        expect(list[0]!.versionNo).toBe(2)
        expect(list[1]!.id).toBe(v1.id)
        expect(list[1]!.name).toBe('V1')
        expect(list[1]!.versionNo).toBe(1)
    })

    it('updateVersionNameDAO 重命名成功', async () => {
        const draft = await createTestDraft(testIds)
        const v = await createVersionDAO({
            draftId: draft.id,
            versionNo: 1,
            name: 'old',
            values: {},
            titleAt: 'T',
        })
        testIds.versionIds.push(v.id)

        const u = await updateVersionNameDAO(v.id, 'new')
        expect(u.name).toBe('new')
        expect(u.versionNo).toBe(1) // versionNo 不变
        expect(u.draftId).toBe(draft.id) // draftId 不变

        // 验证确实更新了
        const got = await getVersionByIdDAO(v.id)
        expect(got?.name).toBe('new')
    })

    it('deleteVersionDAO 物理删除', async () => {
        const draft = await createTestDraft(testIds)
        const v = await createVersionDAO({
            draftId: draft.id,
            versionNo: 1,
            name: 'V1',
            values: {},
            titleAt: 'T',
        })
        testIds.versionIds.push(v.id)

        await deleteVersionDAO(v.id)
        const got = await getVersionByIdDAO(v.id)
        expect(got).toBeNull()
    })

    it('同 draftId 重复 versionNo 应命中唯一约束 P2002', async () => {
        const draft = await createTestDraft(testIds)

        const v1 = await createVersionDAO({
            draftId: draft.id,
            versionNo: 1,
            name: 'A',
            values: {},
            titleAt: 'T',
        })
        testIds.versionIds.push(v1.id)

        // 尝试创建相同 draftId 和 versionNo 的版本应失败
        await expect(
            createVersionDAO({
                draftId: draft.id,
                versionNo: 1,
                name: 'B',
                values: {},
                titleAt: 'T',
            }),
        ).rejects.toMatchObject({ code: 'P2002' })
    })

    it('getVersionByIdDAO 不存在的 ID 返回 null', async () => {
        const got = await getVersionByIdDAO(999999)
        expect(got).toBeNull()
    })

    it('listVersionsDAO 返回空列表当无版本', async () => {
        const draft = await createTestDraft(testIds)
        const list = await listVersionsDAO(draft.id)
        expect(list).toHaveLength(0)
    })

    it('createVersionDAO 支持事务客户端', async () => {
        const draft = await createTestDraft(testIds)
        const db = getTestPrisma()

        const v = await db.$transaction(async (tx) => {
            return createVersionDAO(
                {
                    draftId: draft.id,
                    versionNo: 1,
                    name: 'TX Test',
                    values: { tx: 'test' },
                    titleAt: 'T-tx',
                },
                tx,
            )
        })
        testIds.versionIds.push(v.id)

        expect(v.id).toBeGreaterThan(0)
        expect(v.name).toBe('TX Test')
        const got = await getVersionByIdDAO(v.id)
        expect(got?.values).toEqual({ tx: 'test' })
    })

    it('listVersionsDAO 只返回指定 draftId 的版本', async () => {
        const draft1 = await createTestDraft(testIds)
        const draft2 = await createTestDraft(testIds)

        const v1 = await createVersionDAO({
            draftId: draft1.id,
            versionNo: 1,
            name: 'Draft1-V1',
            values: { draft: '1' },
            titleAt: 'T1',
        })
        testIds.versionIds.push(v1.id)

        const v2 = await createVersionDAO({
            draftId: draft2.id,
            versionNo: 1,
            name: 'Draft2-V1',
            values: { draft: '2' },
            titleAt: 'T2',
        })
        testIds.versionIds.push(v2.id)

        const list1 = await listVersionsDAO(draft1.id)
        const list2 = await listVersionsDAO(draft2.id)

        expect(list1).toHaveLength(1)
        expect(list1[0]!.draftId).toBe(draft1.id)
        expect(list1[0]!.name).toBe('Draft1-V1')

        expect(list2).toHaveLength(1)
        expect(list2[0]!.draftId).toBe(draft2.id)
        expect(list2[0]!.name).toBe('Draft2-V1')
    })

    it('updateVersionNameDAO 仅更新 name，其他字段不变', async () => {
        const draft = await createTestDraft(testIds)
        const origValues = { field: 'original', count: 42 }
        const v = await createVersionDAO({
            draftId: draft.id,
            versionNo: 3,
            name: 'OriginalName',
            values: origValues,
            titleAt: 'OriginalTitle',
        })
        testIds.versionIds.push(v.id)

        const updated = await updateVersionNameDAO(v.id, 'NewName')
        expect(updated.name).toBe('NewName')
        expect(updated.versionNo).toBe(3) // 不变
        expect(updated.draftId).toBe(draft.id) // 不变
        expect(updated.values).toEqual(origValues) // 不变
        expect(updated.titleAt).toBe('OriginalTitle') // 不变
    })
})
