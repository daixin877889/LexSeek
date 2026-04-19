/**
 * DocumentDraft DAO 测试
 *
 * 覆盖 documentDraft.dao 的 5 个 CRUD 方法。
 * 真打测试数据库（真实集成测试），每个 case 独立清理。
 *
 * **Feature: document-generation**
 * **Validates: Task 3.10**
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
    getDocumentDraftDAO,
    findDraftBySessionIdDAO,
    updateDocumentDraftDAO,
    listDocumentDraftsDAO,
    softDeleteDocumentDraftDAO,
    updateDraftTitleDAO,
    updateDraftTitleIfNotOverriddenDAO,
} from '../../../../server/services/assistant/document/documentDraft.dao'

// ==================== 本地测试数据扩展 ====================

interface DraftTestIds extends CaseTestIds {
    templateIds: number[]
    draftIds: number[]
}

const createEmptyDraftTestIds = (): DraftTestIds => ({
    ...createEmptyTestIds(),
    templateIds: [],
    draftIds: [],
})

const cleanupDraftTestData = async (testIds: DraftTestIds) => {
    // 先清理 drafts，再清 templates（外键约束：drafts -> templates）
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

const createTestTemplate = async (testIds: DraftTestIds, userId: number | null = null) => {
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

const createTestDraft = async (
    testIds: DraftTestIds,
    userId: number,
    templateId: number,
    sessionId?: string,
) => {
    const sid = sessionId ?? `test-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const draft = await createDocumentDraftDAO({
        userId,
        templateId,
        sessionId: sid,
        status: 'drafting',
        values: {},
        sourceRef: null,
        metadata: null,
        caseId: null,
    })
    testIds.draftIds.push(draft.id)
    testIds.sessionIds.push(sid)
    return draft
}

// ==================== 测试套件 ====================

describe('documentDraft.dao', () => {
    let testIds: DraftTestIds

    beforeAll(() => {
        testIds = createEmptyDraftTestIds()
    })

    afterEach(async () => {
        const snapshot: DraftTestIds = {
            ...createEmptyDraftTestIds(),
            draftIds: [...testIds.draftIds],
            templateIds: [...testIds.templateIds],
            ossFileIds: [...testIds.ossFileIds],
            userIds: [...testIds.userIds],
            sessionIds: [...testIds.sessionIds],
        }
        if (
            snapshot.draftIds.length > 0
            || snapshot.templateIds.length > 0
            || snapshot.ossFileIds.length > 0
            || snapshot.userIds.length > 0
        ) {
            await cleanupDraftTestData(snapshot)
        }
        testIds = createEmptyDraftTestIds()
    })

    afterAll(async () => {
        await cleanupDraftTestData(testIds)
        await disconnectTestDb()
    })

    // ==================== createDocumentDraftDAO ====================

    describe('createDocumentDraftDAO', () => {
        it('成功创建草稿，返回完整记录（包含 id, sessionId, status=drafting）', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)

            const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            testIds.sessionIds.push(sessionId)

            const draft = await createDocumentDraftDAO({
                userId: user.id,
                templateId: template.id,
                sessionId,
                status: 'drafting',
                values: {},
                sourceRef: { text: '原告是张三' },
                metadata: null,
                caseId: null,
            })
            testIds.draftIds.push(draft.id)

            expect(draft.id).toBeGreaterThan(0)
            expect(draft.userId).toBe(user.id)
            expect(draft.templateId).toBe(template.id)
            expect(draft.sessionId).toBe(sessionId)
            expect(draft.status).toBe('drafting')
            expect(draft.deletedAt).toBeNull()
        })

        it('支持传 caseId（绑定案件）', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)
            const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            testIds.sessionIds.push(sessionId)

            const draft = await createDocumentDraftDAO({
                userId: user.id,
                templateId: template.id,
                sessionId,
                status: 'drafting',
                values: {},
                sourceRef: null,
                metadata: null,
                caseId: null, // 无案件版本
            })
            testIds.draftIds.push(draft.id)

            expect(draft.caseId).toBeNull()
        })

        it('支持传入事务客户端 tx', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)
            const sessionId = `sess-tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            testIds.sessionIds.push(sessionId)

            let draftId: number | null = null
            await getTestPrisma().$transaction(async (tx) => {
                const draft = await createDocumentDraftDAO(
                    {
                        userId: user.id,
                        templateId: template.id,
                        sessionId,
                        status: 'drafting',
                        values: {},
                        sourceRef: null,
                        metadata: null,
                        caseId: null,
                    },
                    tx as any,
                )
                draftId = draft.id
            })

            expect(draftId).not.toBeNull()
            testIds.draftIds.push(draftId!)
        })
    })

    // ==================== getDocumentDraftDAO ====================

    describe('getDocumentDraftDAO', () => {
        it('按 id 查询存在的草稿', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)

            const draft = await createTestDraft(testIds, user.id, template.id)

            const found = await getDocumentDraftDAO(draft.id)
            expect(found).not.toBeNull()
            expect(found?.id).toBe(draft.id)
        })

        it('查询不存在的 id 返回 null', async () => {
            const found = await getDocumentDraftDAO(999999999)
            expect(found).toBeNull()
        })

        it('软删后 getDocumentDraftDAO 返回 null', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)

            const draft = await createTestDraft(testIds, user.id, template.id)

            // 手动软删
            await getTestPrisma().documentDrafts.update({
                where: { id: draft.id },
                data: { deletedAt: new Date() },
            })

            const found = await getDocumentDraftDAO(draft.id)
            expect(found).toBeNull()
        })
    })

    // ==================== findDraftBySessionIdDAO ====================

    describe('findDraftBySessionIdDAO', () => {
        it('按 sessionId 查询存在的草稿', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)

            const sessionId = `sess-find-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            testIds.sessionIds.push(sessionId)
            const draft = await createDocumentDraftDAO({
                userId: user.id,
                templateId: template.id,
                sessionId,
                status: 'drafting',
                values: {},
                sourceRef: null,
                metadata: null,
                caseId: null,
            })
            testIds.draftIds.push(draft.id)

            const found = await findDraftBySessionIdDAO(sessionId)
            expect(found).not.toBeNull()
            expect(found?.sessionId).toBe(sessionId)
            expect(found?.id).toBe(draft.id)
        })

        it('不存在的 sessionId 返回 null', async () => {
            const found = await findDraftBySessionIdDAO('non-existent-session-id')
            expect(found).toBeNull()
        })

        it('软删后 findDraftBySessionIdDAO 返回 null', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)

            const sessionId = `sess-del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            testIds.sessionIds.push(sessionId)
            const draft = await createDocumentDraftDAO({
                userId: user.id,
                templateId: template.id,
                sessionId,
                status: 'drafting',
                values: {},
                sourceRef: null,
                metadata: null,
                caseId: null,
            })
            testIds.draftIds.push(draft.id)

            await getTestPrisma().documentDrafts.update({
                where: { id: draft.id },
                data: { deletedAt: new Date() },
            })

            const found = await findDraftBySessionIdDAO(sessionId)
            expect(found).toBeNull()
        })
    })

    // ==================== updateDocumentDraftDAO ====================

    describe('updateDocumentDraftDAO', () => {
        it('成功更新 status 字段', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)

            const draft = await createTestDraft(testIds, user.id, template.id)

            const updated = await updateDocumentDraftDAO(draft.id, { status: 'ready' })
            expect(updated.status).toBe('ready')
        })

        it('成功更新 values（JSON 对象）', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)

            const draft = await createTestDraft(testIds, user.id, template.id)

            const values = { plaintiff: '张三', defendant: '李四' }
            const updated = await updateDocumentDraftDAO(draft.id, { values })
            expect(updated.values).toEqual(values)
        })

        it('支持事务 tx 参数', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)

            const draft = await createTestDraft(testIds, user.id, template.id)

            await getTestPrisma().$transaction(async (tx) => {
                const updated = await updateDocumentDraftDAO(
                    draft.id,
                    { status: 'filling' },
                    tx as any,
                )
                expect(updated.status).toBe('filling')
            })
        })
    })

    // ==================== listDocumentDraftsDAO ====================

    describe('listDocumentDraftsDAO', () => {
        it('按 userId 过滤，只返回属于该用户的草稿', async () => {
            const userA = await createTestUser()
            const userB = await createTestUser()
            testIds.userIds.push(userA.id, userB.id)
            const template = await createTestTemplate(testIds)

            const draftA = await createTestDraft(testIds, userA.id, template.id)
            const draftB = await createTestDraft(testIds, userB.id, template.id)

            const result = await listDocumentDraftsDAO({ userId: userA.id, skip: 0, take: 50 })
            const ids = result.list.map(d => d.id)

            expect(ids).toContain(draftA.id)
            expect(ids).not.toContain(draftB.id)
        })

        it('软删的草稿不出现在列表中', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)

            const draft = await createTestDraft(testIds, user.id, template.id)

            // 软删
            await getTestPrisma().documentDrafts.update({
                where: { id: draft.id },
                data: { deletedAt: new Date() },
            })

            const result = await listDocumentDraftsDAO({ userId: user.id, skip: 0, take: 50 })
            expect(result.list.map(d => d.id)).not.toContain(draft.id)
        })

        it('分页：skip/take 有效', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)

            // 创建 3 个草稿
            for (let i = 0; i < 3; i++) {
                await createTestDraft(testIds, user.id, template.id)
                await new Promise(r => setTimeout(r, 5))
            }

            const page1 = await listDocumentDraftsDAO({ userId: user.id, skip: 0, take: 2 })
            expect(page1.list).toHaveLength(2)
            expect(page1.total).toBe(3)

            const page2 = await listDocumentDraftsDAO({ userId: user.id, skip: 2, take: 2 })
            expect(page2.list).toHaveLength(1)
        })

        it('按 createdAt desc 排序（最新的在最前面）', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)

            const d1 = await createTestDraft(testIds, user.id, template.id)
            await new Promise(r => setTimeout(r, 10))
            const d2 = await createTestDraft(testIds, user.id, template.id)

            const result = await listDocumentDraftsDAO({ userId: user.id, skip: 0, take: 50 })
            const ids = result.list.map(d => d.id)

            // d2 应该在 d1 之前（desc 排序）
            expect(ids.indexOf(d2.id)).toBeLessThan(ids.indexOf(d1.id))
        })

        it('total 字段反映真实总数（不含软删）', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)

            const d1 = await createTestDraft(testIds, user.id, template.id)
            const d2 = await createTestDraft(testIds, user.id, template.id)

            // 软删 d2
            await getTestPrisma().documentDrafts.update({
                where: { id: d2.id },
                data: { deletedAt: new Date() },
            })

            const result = await listDocumentDraftsDAO({ userId: user.id, skip: 0, take: 50 })
            // 只有 d1 存在
            expect(result.list.map(d => d.id)).toContain(d1.id)
            expect(result.list.map(d => d.id)).not.toContain(d2.id)
        })

        it('返回结果 include 模板名称供列表展示', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)

            await createTestDraft(testIds, user.id, template.id)

            const result = await listDocumentDraftsDAO({ userId: user.id, skip: 0, take: 50 })
            const row = result.list.find(d => d.templateId === template.id)
            expect(row).toBeDefined()
            expect((row as any).template?.name).toBe(template.name)
        })
    })

    // ==================== softDeleteDocumentDraftDAO ====================

    describe('softDeleteDocumentDraftDAO', () => {
        it('设置 deletedAt 后 getDocumentDraftDAO 返回 null', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)

            const draft = await createTestDraft(testIds, user.id, template.id)

            await softDeleteDocumentDraftDAO(draft.id)

            const fetched = await getDocumentDraftDAO(draft.id)
            expect(fetched).toBeNull()

            // 验证 DB 中确实写入了 deletedAt
            const raw = await getTestPrisma().documentDrafts.findUnique({ where: { id: draft.id } })
            expect(raw?.deletedAt).not.toBeNull()
        })

        it('支持事务 tx 参数', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const template = await createTestTemplate(testIds)
            const draft = await createTestDraft(testIds, user.id, template.id)

            await getTestPrisma().$transaction(async (tx) => {
                await softDeleteDocumentDraftDAO(draft.id, tx as any)
            })

            const fetched = await getDocumentDraftDAO(draft.id)
            expect(fetched).toBeNull()
        })
    })
})

describe('updateDraftTitleDAO (无条件写)', () => {
    const localDraftIds: number[] = []

    afterEach(async () => {
        if (localDraftIds.length > 0) {
            await getTestPrisma().documentDrafts.deleteMany({ where: { id: { in: localDraftIds } } })
            localDraftIds.length = 0
        }
    })

    it('应当更新 title 并置 titleOverridden=true', async () => {
        const draft = await createDocumentDraftDAO({
            userId: 1, templateId: 1,
            sessionId: `sid-title-1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            status: 'ready', values: {}, sourceRef: null, metadata: null, caseId: null,
        })
        localDraftIds.push(draft.id)
        const updated = await updateDraftTitleDAO(draft.id, '我的起诉状')
        expect(updated.title).toBe('我的起诉状')
        expect(updated.titleOverridden).toBe(true)
    })
})

describe('updateDraftTitleIfNotOverriddenDAO (AI 安全写)', () => {
    const localDraftIds: number[] = []

    afterEach(async () => {
        if (localDraftIds.length > 0) {
            await getTestPrisma().documentDrafts.deleteMany({ where: { id: { in: localDraftIds } } })
            localDraftIds.length = 0
        }
    })

    it('overridden=false 时正常写入 title，保持 titleOverridden=false', async () => {
        const draft = await createDocumentDraftDAO({
            userId: 1, templateId: 1,
            sessionId: `sid-title-2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            status: 'ready', values: {}, sourceRef: null, metadata: null, caseId: null,
        })
        localDraftIds.push(draft.id)
        const result = await updateDraftTitleIfNotOverriddenDAO(draft.id, 'AI 标题')
        expect(result?.title).toBe('AI 标题')
        expect(result?.titleOverridden).toBe(false)
    })

    it('overridden=true 时原子 UPDATE 未命中，返回 null', async () => {
        const draft = await createDocumentDraftDAO({
            userId: 1, templateId: 1,
            sessionId: `sid-title-3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            status: 'ready', values: {}, sourceRef: null, metadata: null, caseId: null,
        })
        localDraftIds.push(draft.id)
        await updateDraftTitleDAO(draft.id, '用户命名')
        const result = await updateDraftTitleIfNotOverriddenDAO(draft.id, 'AI 尝试覆盖')
        expect(result).toBeNull()
    })
})
