/**
 * DocumentTemplate DAO 测试
 *
 * 覆盖 documentTemplate.dao 的六个 CRUD 函数 + 过滤 + 分页 + 配额统计。
 * 真打测试数据库。
 *
 * **Feature: document-generation**
 * **Validates: Task 2.1**
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
    createDocumentTemplateDAO,
    getDocumentTemplateDAO,
    listDocumentTemplatesDAO,
    updateDocumentTemplateDAO,
    softDeleteDocumentTemplateDAO,
    countUserTemplatesDAO,
} from '../../../../server/services/assistant/document/documentTemplate.dao'

// ==================== 扩展 testIds 以追踪模板 ====================

interface TemplateTestIds extends CaseTestIds {
    templateIds: number[]
}

const createEmptyTemplateTestIds = (): TemplateTestIds => ({
    ...createEmptyTestIds(),
    templateIds: [],
})

const cleanupTemplateTestData = async (testIds: TemplateTestIds) => {
    if (testIds.templateIds.length > 0) {
        await getTestPrisma().documentTemplates.deleteMany({
            where: { id: { in: testIds.templateIds } },
        })
    }
    await cleanupTestData(testIds)
}

// ==================== 测试套件 ====================

describe('documentTemplate.dao', () => {
    let testIds: TemplateTestIds

    beforeAll(() => {
        testIds = createEmptyTemplateTestIds()
    })

    afterEach(async () => {
        // 每个用例结束清理，防止串扰
        const snapshot: TemplateTestIds = {
            ...createEmptyTemplateTestIds(),
            templateIds: [...testIds.templateIds],
            ossFileIds: [...testIds.ossFileIds],
            userIds: [...testIds.userIds],
        }
        if (
            snapshot.templateIds.length > 0
            || snapshot.ossFileIds.length > 0
            || snapshot.userIds.length > 0
        ) {
            await cleanupTemplateTestData(snapshot)
        }
        testIds = createEmptyTemplateTestIds()
    })

    afterAll(async () => {
        await cleanupTemplateTestData(testIds)
        await disconnectTestDb()
    })

    // ==================== createDocumentTemplateDAO ====================

    describe('createDocumentTemplateDAO', () => {
        it('成功创建全局模板（scope=global，userId=null）', async () => {
            const ossFile = await createTestOssFile({}, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const template = await createDocumentTemplateDAO({
                name: '起诉状模板',
                category: '起诉状',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [{ name: 'plaintiff_name', firstContext: '原告：{{plaintiff_name}}' }],
                description: '通用起诉状模板',
            })
            testIds.templateIds.push(template.id)

            expect(template.id).toBeGreaterThan(0)
            expect(template.name).toBe('起诉状模板')
            expect(template.category).toBe('起诉状')
            expect(template.scope).toBe('global')
            expect(template.userId).toBeNull()
            expect(template.ossFileId).toBe(ossFile.id)
            expect(template.status).toBe(1)
            expect(template.deletedAt).toBeNull()
        })

        it('成功创建用户个人模板（scope=user，包含 userId）', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const ossFile = await createTestOssFile({ userId: user.id }, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const template = await createDocumentTemplateDAO({
                name: '个人借款合同',
                category: '合同',
                scope: 'user',
                userId: user.id,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(template.id)

            expect(template.scope).toBe('user')
            expect(template.userId).toBe(user.id)
        })

        it('创建时 placeholders 默认为 []（不传 description）', async () => {
            const ossFile = await createTestOssFile({}, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const template = await createDocumentTemplateDAO({
                name: '空占位符模板',
                category: '合同',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(template.id)

            expect(template.description).toBeNull()
            expect(Array.isArray(template.placeholders)).toBe(true)
        })
    })

    // ==================== getDocumentTemplateDAO ====================

    describe('getDocumentTemplateDAO', () => {
        it('创建后能按 id 查询到模板', async () => {
            const ossFile = await createTestOssFile({}, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const created = await createDocumentTemplateDAO({
                name: '查询测试模板',
                category: '起诉状',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(created.id)

            const found = await getDocumentTemplateDAO(created.id)
            expect(found).not.toBeNull()
            expect(found?.id).toBe(created.id)
            expect(found?.name).toBe('查询测试模板')
        })

        it('查询不存在的 id 返回 null', async () => {
            const found = await getDocumentTemplateDAO(999999999)
            expect(found).toBeNull()
        })

        it('软删后 get 返回 null', async () => {
            const ossFile = await createTestOssFile({}, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const template = await createDocumentTemplateDAO({
                name: '软删测试模板',
                category: '合同',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(template.id)

            await softDeleteDocumentTemplateDAO(template.id)
            const found = await getDocumentTemplateDAO(template.id)
            expect(found).toBeNull()
        })
    })

    // ==================== listDocumentTemplatesDAO ====================

    describe('listDocumentTemplatesDAO', () => {
        it('按 scope=global 过滤，只返回全局模板', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const ossFile = await createTestOssFile({ userId: user.id }, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const globalTpl = await createDocumentTemplateDAO({
                name: `全局模板_${Date.now()}`,
                category: '起诉状',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(globalTpl.id)

            const userTpl = await createDocumentTemplateDAO({
                name: `用户模板_${Date.now()}`,
                category: '合同',
                scope: 'user',
                userId: user.id,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(userTpl.id)

            const result = await listDocumentTemplatesDAO({ scope: 'global', skip: 0, take: 50 })
            const ids = result.list.map(t => t.id)

            expect(ids).toContain(globalTpl.id)
            expect(ids).not.toContain(userTpl.id)
        })

        it('按 scope=user 过滤，只返回用户模板', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const ossFile = await createTestOssFile({ userId: user.id }, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const globalTpl = await createDocumentTemplateDAO({
                name: `全局模板2_${Date.now()}`,
                category: '起诉状',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(globalTpl.id)

            const userTpl = await createDocumentTemplateDAO({
                name: `用户模板2_${Date.now()}`,
                category: '合同',
                scope: 'user',
                userId: user.id,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(userTpl.id)

            const result = await listDocumentTemplatesDAO({ scope: 'user', skip: 0, take: 50 })
            const ids = result.list.map(t => t.id)

            expect(ids).toContain(userTpl.id)
            expect(ids).not.toContain(globalTpl.id)
        })

        it('按 category 过滤', async () => {
            const ossFile = await createTestOssFile({}, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const susoTpl = await createDocumentTemplateDAO({
                name: `起诉状_${Date.now()}`,
                category: '起诉状',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(susoTpl.id)

            const contractTpl = await createDocumentTemplateDAO({
                name: `合同_${Date.now()}`,
                category: '合同',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(contractTpl.id)

            const result = await listDocumentTemplatesDAO({ category: '起诉状', skip: 0, take: 50 })
            const ids = result.list.map(t => t.id)

            expect(ids).toContain(susoTpl.id)
            expect(ids).not.toContain(contractTpl.id)
        })

        it('按 q（name ILIKE）模糊过滤', async () => {
            const uniqueSuffix = Date.now()
            const ossFile = await createTestOssFile({}, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const tplA = await createDocumentTemplateDAO({
                name: `借款合同_${uniqueSuffix}`,
                category: '合同',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(tplA.id)

            const tplB = await createDocumentTemplateDAO({
                name: `委托书_${uniqueSuffix}`,
                category: '委托',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(tplB.id)

            const result = await listDocumentTemplatesDAO({ q: `借款合同_${uniqueSuffix}`, skip: 0, take: 50 })
            const ids = result.list.map(t => t.id)

            expect(ids).toContain(tplA.id)
            expect(ids).not.toContain(tplB.id)
        })

        it('分页：skip/take 有效', async () => {
            const ossFile = await createTestOssFile({}, testIds)
            testIds.ossFileIds.push(ossFile.id)
            const category = `分页测试_${Date.now()}`

            const t1 = await createDocumentTemplateDAO({
                name: `模板1_${Date.now()}`,
                category,
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(t1.id)

            await new Promise(r => setTimeout(r, 5))

            const t2 = await createDocumentTemplateDAO({
                name: `模板2_${Date.now()}`,
                category,
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(t2.id)

            await new Promise(r => setTimeout(r, 5))

            const t3 = await createDocumentTemplateDAO({
                name: `模板3_${Date.now()}`,
                category,
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(t3.id)

            const page1 = await listDocumentTemplatesDAO({ category, skip: 0, take: 2 })
            expect(page1.list).toHaveLength(2)
            expect(page1.total).toBe(3)

            const page2 = await listDocumentTemplatesDAO({ category, skip: 2, take: 2 })
            expect(page2.list).toHaveLength(1)
        })

        it('软删的模板不出现在列表中', async () => {
            const ossFile = await createTestOssFile({}, testIds)
            testIds.ossFileIds.push(ossFile.id)
            const category = `软删列表_${Date.now()}`

            const tpl = await createDocumentTemplateDAO({
                name: `软删模板_${Date.now()}`,
                category,
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(tpl.id)

            await softDeleteDocumentTemplateDAO(tpl.id)

            const result = await listDocumentTemplatesDAO({ category, skip: 0, take: 50 })
            expect(result.list.map(t => t.id)).not.toContain(tpl.id)
        })

        it('不传过滤条件时返回所有未删除模板（total >= 0）', async () => {
            const result = await listDocumentTemplatesDAO({ skip: 0, take: 10 })
            expect(result.total).toBeGreaterThanOrEqual(0)
            expect(Array.isArray(result.list)).toBe(true)
        })
    })

    // ==================== updateDocumentTemplateDAO ====================

    describe('updateDocumentTemplateDAO', () => {
        it('成功更新 name/category/description/status', async () => {
            const ossFile = await createTestOssFile({}, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const tpl = await createDocumentTemplateDAO({
                name: '更新前名称',
                category: '起诉状',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
                description: '原始描述',
            })
            testIds.templateIds.push(tpl.id)

            const updated = await updateDocumentTemplateDAO(tpl.id, {
                name: '更新后名称',
                category: '合同',
                description: '新描述',
                status: 0,
            })

            expect(updated.name).toBe('更新后名称')
            expect(updated.category).toBe('合同')
            expect(updated.description).toBe('新描述')
            expect(updated.status).toBe(0)
        })

        it('只更新部分字段（partial update）', async () => {
            const ossFile = await createTestOssFile({}, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const tpl = await createDocumentTemplateDAO({
                name: '原名称',
                category: '起诉状',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(tpl.id)

            const updated = await updateDocumentTemplateDAO(tpl.id, { name: '新名称' })
            expect(updated.name).toBe('新名称')
            expect(updated.category).toBe('起诉状') // 未改变
        })
    })

    // ==================== softDeleteDocumentTemplateDAO ====================

    describe('softDeleteDocumentTemplateDAO', () => {
        it('成功设置 deletedAt，原始记录保留在数据库', async () => {
            const ossFile = await createTestOssFile({}, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const tpl = await createDocumentTemplateDAO({
                name: '软删模板',
                category: '起诉状',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(tpl.id)

            await softDeleteDocumentTemplateDAO(tpl.id)

            const raw = await getTestPrisma().documentTemplates.findUnique({
                where: { id: tpl.id },
            })
            expect(raw?.deletedAt).not.toBeNull()
        })

        it('重复软删不报错（幂等）', async () => {
            const ossFile = await createTestOssFile({}, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const tpl = await createDocumentTemplateDAO({
                name: '幂等软删测试',
                category: '合同',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(tpl.id)

            await softDeleteDocumentTemplateDAO(tpl.id)
            // 第二次软删不应抛出
            await expect(softDeleteDocumentTemplateDAO(tpl.id)).resolves.not.toThrow()
        })
    })

    // ==================== countUserTemplatesDAO ====================

    describe('countUserTemplatesDAO', () => {
        it('统计特定用户的个人模板数量', async () => {
            const userA = await createTestUser()
            const userB = await createTestUser()
            testIds.userIds.push(userA.id, userB.id)
            const ossFile = await createTestOssFile({ userId: userA.id }, testIds)
            testIds.ossFileIds.push(ossFile.id)

            // userA 创建 2 个个人模板
            const t1 = await createDocumentTemplateDAO({
                name: `配额模板1_${Date.now()}`,
                category: '合同',
                scope: 'user',
                userId: userA.id,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(t1.id)
            await new Promise(r => setTimeout(r, 5))
            const t2 = await createDocumentTemplateDAO({
                name: `配额模板2_${Date.now()}`,
                category: '委托',
                scope: 'user',
                userId: userA.id,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(t2.id)

            // userB 创建 1 个
            const ossFileB = await createTestOssFile({ userId: userB.id }, testIds)
            testIds.ossFileIds.push(ossFileB.id)
            const t3 = await createDocumentTemplateDAO({
                name: `配额模板3_${Date.now()}`,
                category: '合同',
                scope: 'user',
                userId: userB.id,
                ossFileId: ossFileB.id,
                placeholders: [],
            })
            testIds.templateIds.push(t3.id)

            const countA = await countUserTemplatesDAO(userA.id)
            const countB = await countUserTemplatesDAO(userB.id)

            expect(countA).toBe(2)
            expect(countB).toBe(1)
        })

        it('软删后的模板不计入配额', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const ossFile = await createTestOssFile({ userId: user.id }, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const tpl = await createDocumentTemplateDAO({
                name: `配额软删_${Date.now()}`,
                category: '合同',
                scope: 'user',
                userId: user.id,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(tpl.id)

            const beforeDelete = await countUserTemplatesDAO(user.id)
            await softDeleteDocumentTemplateDAO(tpl.id)
            const afterDelete = await countUserTemplatesDAO(user.id)

            expect(beforeDelete).toBe(1)
            expect(afterDelete).toBe(0)
        })

        it('全局模板（scope=global）不计入用户配额', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const ossFile = await createTestOssFile({ userId: user.id }, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const globalTpl = await createDocumentTemplateDAO({
                name: `全局不计配额_${Date.now()}`,
                category: '合同',
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: [],
            })
            testIds.templateIds.push(globalTpl.id)

            const count = await countUserTemplatesDAO(user.id)
            expect(count).toBe(0)
        })
    })
})
