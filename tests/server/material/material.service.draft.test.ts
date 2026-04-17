/**
 * material.service - getMaterialsByDraftIdService 测试
 *
 * 验证通过 draftId 查询材料并附加文件信息的 Service 函数
 * 使用真实数据库（与 material.service.test.ts 保持一致）
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import './test-setup'
import {
    createTestUser,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from './test-db-helper'
import { getMaterialsByDraftIdService } from '../../../server/services/material/material.service'
import { CaseMaterialType } from '../../../shared/types/case'
import { MaterialStatus } from '../../../shared/types/material'
import { v7 as uuidv7 } from 'uuid'

describe('getMaterialsByDraftIdService', () => {
    let testIds: CaseTestIds
    let testUserId: number
    let testTemplateId: number
    let testDraftId: number

    beforeAll(async () => {
        testIds = createEmptyTestIds()

        const user = await createTestUser()
        testUserId = user.id
        testIds.userIds.push(user.id)

        // 创建模板所需的 OSS 文件
        const ossFile = await getTestPrisma().ossFiles.create({
            data: {
                fileName: 'test_template.docx',
                filePath: `test/templates/${Date.now()}_svc.docx`,
                fileSize: 1024,
                fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                bucketName: 'test-bucket',
                userId: testUserId,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testIds.ossFileIds.push(ossFile.id)

        const template = await getTestPrisma().documentTemplates.create({
            data: {
                name: `测试模板_svc_${Date.now()}`,
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
        if (testIds.materialIds.length > 0) {
            await getTestPrisma().caseMaterials.deleteMany({
                where: { id: { in: testIds.materialIds } },
            })
            testIds.materialIds = []
        }
        if (testIds.ossFileIds.length > 1) {
            // 保留索引0（模板 ossFile），清理其他
            const extraIds = testIds.ossFileIds.slice(1)
            await getTestPrisma().ossFiles.deleteMany({ where: { id: { in: extraIds } } })
            testIds.ossFileIds = [testIds.ossFileIds[0]!]
        }
    })

    afterAll(async () => {
        if (testDraftId) {
            await getTestPrisma().documentDrafts.deleteMany({ where: { id: testDraftId } })
        }
        if (testTemplateId) {
            await getTestPrisma().documentTemplates.deleteMany({ where: { id: testTemplateId } })
        }
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    it('草稿没有材料时返回空数组', async () => {
        const result = await getMaterialsByDraftIdService(testDraftId)
        expect(result).toEqual([])
    })

    it('材料无关联 OSS 文件时返回材料本身（无文件信息）', async () => {
        const m = await getTestPrisma().caseMaterials.create({
            data: {
                draftId: testDraftId,
                caseId: null,
                name: `草稿材料_svc_nofile_${Date.now()}`,
                type: CaseMaterialType.CASE_CONTENT,
                status: MaterialStatus.PENDING,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testIds.materialIds.push(m.id)

        const result = await getMaterialsByDraftIdService(testDraftId)

        expect(result).toHaveLength(1)
        expect(result[0]!.id).toBe(m.id)
        expect(result[0]!.draftId).toBe(testDraftId)
        expect(result[0]!.fileName).toBeUndefined()
    })

    it('有关联 OSS 文件时附加文件信息', async () => {
        // 创建测试 OSS 文件
        const ossFile = await getTestPrisma().ossFiles.create({
            data: {
                fileName: 'contract.pdf',
                filePath: `test/contract_${Date.now()}.pdf`,
                fileSize: 2048,
                fileType: 'application/pdf',
                bucketName: 'test-bucket',
                userId: testUserId,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testIds.ossFileIds.push(ossFile.id)

        const m = await getTestPrisma().caseMaterials.create({
            data: {
                draftId: testDraftId,
                caseId: null,
                ossFileId: ossFile.id,
                name: `草稿材料_svc_withfile_${Date.now()}`,
                type: CaseMaterialType.DOCUMENT,
                status: MaterialStatus.PENDING,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testIds.materialIds.push(m.id)

        const result = await getMaterialsByDraftIdService(testDraftId)

        const found = result.find(r => r.id === m.id)
        expect(found).toBeDefined()
        expect(found!.fileName).toBe('contract.pdf')
        expect(found!.fileSize).toBe(2048)
        expect(found!.fileType).toBe('application/pdf')
    })

    it('所有返回的材料应带有 draftId 字段', async () => {
        const m1 = await getTestPrisma().caseMaterials.create({
            data: {
                draftId: testDraftId,
                caseId: null,
                name: `草稿材料_svc_draft_a_${Date.now()}`,
                type: CaseMaterialType.CASE_CONTENT,
                status: MaterialStatus.PENDING,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        const m2 = await getTestPrisma().caseMaterials.create({
            data: {
                draftId: testDraftId,
                caseId: null,
                name: `草稿材料_svc_draft_b_${Date.now()}`,
                type: CaseMaterialType.CASE_CONTENT,
                status: MaterialStatus.PENDING,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testIds.materialIds.push(m1.id, m2.id)

        const result = await getMaterialsByDraftIdService(testDraftId)

        expect(result.length).toBeGreaterThanOrEqual(2)
        expect(result.every(m => m.draftId === testDraftId)).toBe(true)
    })

    it('不存在的 draftId 应返回空数组', async () => {
        const result = await getMaterialsByDraftIdService(999999)
        expect(result).toEqual([])
    })
})
