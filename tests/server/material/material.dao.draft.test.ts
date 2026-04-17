/**
 * findMaterialsByDraftIdDao 测试
 *
 * 验证通过 draftId 查询材料的 DAO 函数
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import './test-setup'
import {
    createTestUser,
    createTestCaseType,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from './test-db-helper'
import {
    findMaterialsByDraftIdDao,
} from '../../../server/services/material/material.dao'
import { CaseMaterialType } from '../../../shared/types/case'
import { MaterialStatus } from '../../../shared/types/material'
import { v7 as uuidv7 } from 'uuid'

describe('findMaterialsByDraftIdDao - 通过文书草稿 ID 查询材料', () => {
    let testIds: CaseTestIds
    let testUserId: number
    let testTemplateId: number
    let testDraftId: number

    beforeAll(async () => {
        testIds = createEmptyTestIds()

        // 创建测试用户
        const user = await createTestUser()
        testUserId = user.id
        testIds.userIds.push(user.id)

        // 创建测试案件类型（模板需要）
        const caseType = await createTestCaseType({ status: 1 })
        testIds.caseTypeIds.push(caseType.id)

        // 创建测试 OSS 文件（模板原始文件）
        const ossFile = await getTestPrisma().ossFiles.create({
            data: {
                fileName: 'test_template.docx',
                filePath: `test/templates/${Date.now()}.docx`,
                fileSize: 1024,
                fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                bucketName: 'test-bucket',
                userId: testUserId,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testIds.ossFileIds.push(ossFile.id)

        // 创建测试文书模板
        const template = await getTestPrisma().documentTemplates.create({
            data: {
                name: `测试模板_${Date.now()}`,
                category: '测试分类',
                scope: 'global',
                ossFileId: ossFile.id,
                placeholders: [],
                status: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testTemplateId = template.id

        // 创建测试文书草稿
        const draft = await getTestPrisma().documentDrafts.create({
            data: {
                userId: testUserId,
                sessionId: uuidv7(),
                templateId: testTemplateId,
                values: {},
                status: 'drafting',
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testDraftId = draft.id
    })

    afterEach(async () => {
        // 清理本次测试创建的材料
        if (testIds.materialIds.length > 0) {
            await getTestPrisma().caseMaterials.deleteMany({
                where: { id: { in: testIds.materialIds } },
            })
            testIds.materialIds = []
        }
    })

    afterAll(async () => {
        // 清理草稿和模板
        if (testDraftId) {
            await getTestPrisma().documentDrafts.deleteMany({
                where: { id: testDraftId },
            })
        }
        if (testTemplateId) {
            await getTestPrisma().documentTemplates.deleteMany({
                where: { id: testTemplateId },
            })
        }
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    it('应该返回草稿的所有材料', async () => {
        // 创建属于该草稿的材料
        const m1 = await getTestPrisma().caseMaterials.create({
            data: {
                draftId: testDraftId,
                caseId: null,
                name: `草稿材料_测试_${Date.now()}_1`,
                type: CaseMaterialType.DOCUMENT,
                status: MaterialStatus.PENDING,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        const m2 = await getTestPrisma().caseMaterials.create({
            data: {
                draftId: testDraftId,
                caseId: null,
                name: `草稿材料_测试_${Date.now()}_2`,
                type: CaseMaterialType.IMAGE,
                status: MaterialStatus.PENDING,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testIds.materialIds.push(m1.id, m2.id)

        const result = await findMaterialsByDraftIdDao(testDraftId)

        expect(result.length).toBeGreaterThanOrEqual(2)
        expect(result.every(m => m.draftId === testDraftId)).toBe(true)
        expect(result.some(m => m.id === m1.id)).toBe(true)
        expect(result.some(m => m.id === m2.id)).toBe(true)
    })

    it('应该自动过滤已删除的材料', async () => {
        const m = await getTestPrisma().caseMaterials.create({
            data: {
                draftId: testDraftId,
                caseId: null,
                name: `草稿材料_软删除测试_${Date.now()}`,
                type: CaseMaterialType.DOCUMENT,
                status: MaterialStatus.PENDING,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testIds.materialIds.push(m.id)

        // 软删除
        await getTestPrisma().caseMaterials.update({
            where: { id: m.id },
            data: { deletedAt: new Date() },
        })

        const result = await findMaterialsByDraftIdDao(testDraftId)
        expect(result.every(item => item.id !== m.id)).toBe(true)
    })

    it('不存在的草稿 ID 应返回空数组', async () => {
        const result = await findMaterialsByDraftIdDao(999999)
        expect(result).toEqual([])
    })

    it('不应返回属于其他草稿的材料', async () => {
        // 创建另一个草稿
        const anotherDraft = await getTestPrisma().documentDrafts.create({
            data: {
                userId: testUserId,
                sessionId: uuidv7(),
                templateId: testTemplateId,
                values: {},
                status: 'drafting',
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })

        // 属于 testDraftId 的材料
        const m1 = await getTestPrisma().caseMaterials.create({
            data: {
                draftId: testDraftId,
                caseId: null,
                name: `草稿材料_隔离测试_${Date.now()}_1`,
                type: CaseMaterialType.DOCUMENT,
                status: MaterialStatus.PENDING,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        // 属于 anotherDraft 的材料
        const m2 = await getTestPrisma().caseMaterials.create({
            data: {
                draftId: anotherDraft.id,
                caseId: null,
                name: `草稿材料_隔离测试_${Date.now()}_2`,
                type: CaseMaterialType.DOCUMENT,
                status: MaterialStatus.PENDING,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testIds.materialIds.push(m1.id, m2.id)

        const result = await findMaterialsByDraftIdDao(testDraftId)

        expect(result.some(m => m.id === m1.id)).toBe(true)
        expect(result.every(m => m.id !== m2.id)).toBe(true)

        // 清理另一个草稿
        await getTestPrisma().caseMaterials.deleteMany({ where: { id: m2.id } })
        testIds.materialIds = testIds.materialIds.filter(id => id !== m2.id)
        await getTestPrisma().documentDrafts.deleteMany({ where: { id: anotherDraft.id } })
    })

    it('结果应按创建时间升序排列', async () => {
        const m1 = await getTestPrisma().caseMaterials.create({
            data: {
                draftId: testDraftId,
                caseId: null,
                name: `草稿材料_排序测试_${Date.now()}_first`,
                type: CaseMaterialType.DOCUMENT,
                status: MaterialStatus.PENDING,
                createdAt: new Date(Date.now() - 1000),
                updatedAt: new Date(),
            },
        })
        const m2 = await getTestPrisma().caseMaterials.create({
            data: {
                draftId: testDraftId,
                caseId: null,
                name: `草稿材料_排序测试_${Date.now()}_second`,
                type: CaseMaterialType.IMAGE,
                status: MaterialStatus.PENDING,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testIds.materialIds.push(m1.id, m2.id)

        const result = await findMaterialsByDraftIdDao(testDraftId)
        const filtered = result.filter(m => m.id === m1.id || m.id === m2.id)

        // 较早创建的应在前面
        const idx1 = filtered.findIndex(m => m.id === m1.id)
        const idx2 = filtered.findIndex(m => m.id === m2.id)
        expect(idx1).toBeLessThan(idx2)
    })
})
