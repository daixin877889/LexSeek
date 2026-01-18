/**
 * 测试 embedding_status 更新问题
 * 
 * 验证向量化完成后，case_materials 表的 embedding_status 字段是否正确更新
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '../../../generated/prisma/client'
import { findMaterialsByOssFileIdDAO, updateMaterialEmbeddingStatusDAO } from '../../../server/services/case/caseMaterial.dao'

const prisma = new PrismaClient()

describe('embedding_status 更新测试', () => {
    let testOssFileId: number
    let testMaterialId: number

    beforeAll(async () => {
        // 创建测试数据
        const testCase = await prisma.cases.create({
            data: {
                title: '测试案件',
                userId: 137,
                caseTypeId: 1,
                status: 1,
            },
        })

        const testMaterial = await prisma.caseMaterials.create({
            data: {
                caseId: testCase.id,
                name: '测试材料',
                type: 2, // DOCUMENT
                ossFileId: 999,
                embeddingStatus: 'pending',
            },
        })

        testOssFileId = 999
        testMaterialId = testMaterial.id
    })

    afterAll(async () => {
        // 清理测试数据
        await prisma.caseMaterials.deleteMany({
            where: { ossFileId: testOssFileId },
        })
        await prisma.cases.deleteMany({
            where: { title: '测试案件' },
        })
    })

    it('应该能够通过 ossFileId 查找材料', async () => {
        const materials = await findMaterialsByOssFileIdDAO(testOssFileId)
        expect(materials).toHaveLength(1)
        expect(materials[0].id).toBe(testMaterialId)
        expect(materials[0].embeddingStatus).toBe('pending')
    })

    it('应该能够更新材料的 embedding_status', async () => {
        await updateMaterialEmbeddingStatusDAO(testMaterialId, 'completed')

        const materials = await findMaterialsByOssFileIdDAO(testOssFileId)
        expect(materials[0].embeddingStatus).toBe('completed')
    })

    it('应该能够批量更新多个材料的 embedding_status', async () => {
        // 创建第二个材料
        const testCase = await prisma.cases.findFirst({
            where: { title: '测试案件' },
        })

        const testMaterial2 = await prisma.caseMaterials.create({
            data: {
                caseId: testCase!.id,
                name: '测试材料2',
                type: 3, // IMAGE
                ossFileId: testOssFileId,
                embeddingStatus: 'pending',
            },
        })

        // 批量更新
        const materials = await findMaterialsByOssFileIdDAO(testOssFileId)
        for (const material of materials) {
            await updateMaterialEmbeddingStatusDAO(material.id, 'completed')
        }

        // 验证
        const updatedMaterials = await findMaterialsByOssFileIdDAO(testOssFileId)
        expect(updatedMaterials).toHaveLength(2)
        expect(updatedMaterials.every(m => m.embeddingStatus === 'completed')).toBe(true)
    })
})
