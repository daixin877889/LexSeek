/**
 * 材料向量化状态更新测试
 *
 * 测试 DAO 层的 findMaterialsByOssFileIdDAO 和 updateMaterialEmbeddingStatusDAO 函数
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import './test-setup'
import {
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestOssFile,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    type CaseTestIds,
} from './test-db-helper'
import { findMaterialsByOssFileIdDAO, updateMaterialEmbeddingStatusDAO } from '../../../server/services/case/caseMaterial.dao'

const CASE_MATERIAL_TYPE = {
    DOCUMENT: 2,
    IMAGE: 3,
    AUDIO: 4,
}

describe('材料向量化状态更新', () => {
    let testIds: CaseTestIds
    let testUser: Awaited<ReturnType<typeof createTestUser>>
    let testCaseType: Awaited<ReturnType<typeof createTestCaseType>>
    let testCase: Awaited<ReturnType<typeof createTestCase>>

    beforeAll(async () => {
        testIds = createEmptyTestIds()
        testUser = await createTestUser()
        testIds.userIds.push(testUser.id)
        testCaseType = await createTestCaseType({ status: 1 })
        testIds.caseTypeIds.push(testCaseType.id)
        testCase = await createTestCase({ userId: testUser.id, caseTypeId: testCaseType.id })
        testIds.caseIds.push(testCase.id)
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    it('应该能根据 ossFileId 查询材料', async () => {
        const ossFile = await createTestOssFile({
            userId: testUser.id,
            fileType: 'image/jpeg',
            fileName: 'test.jpg',
        }, testIds)
        testIds.ossFileIds.push(ossFile.id)

        const material = await (globalThis as any).prisma.caseMaterials.create({
            data: {
                caseId: testCase.id,
                name: '测试材料',
                type: CASE_MATERIAL_TYPE.IMAGE,
                ossFileId: ossFile.id,
                status: 1,
                embeddingStatus: 'pending',
            },
        })
        testIds.materialIds.push(material.id)

        const materials = await findMaterialsByOssFileIdDAO(ossFile.id)
        expect(materials.length).toBeGreaterThan(0)
        expect(materials[0].ossFileId).toBe(ossFile.id)
    })

    it('应该能更新材料的 embedding_status', async () => {
        const ossFile = await createTestOssFile({
            userId: testUser.id,
            fileType: 'application/pdf',
            fileName: 'test.pdf',
        }, testIds)
        testIds.ossFileIds.push(ossFile.id)

        const material = await (globalThis as any).prisma.caseMaterials.create({
            data: {
                caseId: testCase.id,
                name: '测试材料',
                type: CASE_MATERIAL_TYPE.DOCUMENT,
                ossFileId: ossFile.id,
                status: 1,
                embeddingStatus: 'pending',
            },
        })
        testIds.materialIds.push(material.id)

        await updateMaterialEmbeddingStatusDAO(material.id, 'completed')

        const updated = await (globalThis as any).prisma.caseMaterials.findUnique({
            where: { id: material.id },
        })
        expect(updated?.embeddingStatus).toBe('completed')
    })
})
