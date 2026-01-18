/**
 * 案件材料向量化服务测试
 * Requirements: 8.4
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { embedTextMaterialService, batchEmbedTextMaterialsService } from '../../../server/services/case/caseMaterial.service'
import { createCaseService } from '../../../server/services/case/case.service'
import { findByCaseIdDAO } from '../../../server/services/case/caseMaterial.dao'
import { CaseMaterialType } from '../../../shared/types/case'
import type { CaseMaterialParam } from '../../../shared/types/case'

describe('案件材料向量化服务测试', () => {
    let testUserId: number
    let testCaseTypeId: number
    let testCaseId: number
    let testSessionId: string
    let testMaterialId: number

    beforeAll(async () => {
        // 创建测试用户
        const user = await prisma.users.create({
            data: {
                username: `test_embed_${Date.now()}`,
                password: 'test123',
                email: `test_embed_${Date.now()}@test.com`,
            },
        })
        testUserId = user.id

        // 创建测试案件类型
        const caseType = await prisma.caseTypes.create({
            data: {
                name: '测试案件类型',
                status: 1,
            },
        })
        testCaseTypeId = caseType.id
    })

    afterAll(async () => {
        // 清理测试数据
        if (testCaseId) {
            await prisma.caseMaterials.deleteMany({
                where: { caseId: testCaseId },
            })
            await prisma.caseSessions.deleteMany({
                where: { caseId: testCaseId },
            })
            await prisma.cases.deleteMany({
                where: { id: testCaseId },
            })
        }
        if (testCaseTypeId) {
            await prisma.caseTypes.deleteMany({
                where: { id: testCaseTypeId },
            })
        }
        if (testUserId) {
            await prisma.users.deleteMany({
                where: { id: testUserId },
            })
        }
    })

    beforeEach(async () => {
        // 每个测试前创建新案件
        const result = await createCaseService({
            userId: testUserId,
            caseTypeId: testCaseTypeId,
            content: '这是一个测试案件的详细描述，用于测试向量化功能。案件涉及合同纠纷，原告主张被告违约。',
        })
        testCaseId = result.caseId
        testSessionId = result.sessionId

        // 获取创建的材料 ID
        const materials = await findByCaseIdDAO(testCaseId)
        const textMaterial = materials.find(m => m.type === CaseMaterialType.CASE_CONTENT)
        if (textMaterial) {
            testMaterialId = textMaterial.id
        }
    })

    describe('embedTextMaterialService', () => {
        it('应该成功为文本材料生成向量', async () => {
            const result = await embedTextMaterialService(
                testMaterialId,
                testUserId,
                testCaseId,
                testSessionId
            )

            expect(result.success).toBe(true)
            expect(result.materialId).toBe(testMaterialId)
            expect(result.chunkCount).toBeGreaterThan(0)

            // 验证材料状态已更新
            const material = await prisma.caseMaterials.findUnique({
                where: { id: testMaterialId },
            })
            expect(material?.embeddingStatus).toBe('completed')
        })

        it('应该拒绝为非文本材料生成向量', async () => {
            // 创建一个文档类型材料
            const docMaterial = await prisma.caseMaterials.create({
                data: {
                    caseId: testCaseId,
                    name: '测试文档',
                    type: CaseMaterialType.DOCUMENT,
                    ossFileId: 1,
                    status: 1,
                },
            })

            const result = await embedTextMaterialService(
                docMaterial.id,
                testUserId,
                testCaseId,
                testSessionId
            )

            expect(result.success).toBe(false)
            expect(result.error).toContain('只能为文本材料生成向量')

            // 清理
            await prisma.caseMaterials.delete({
                where: { id: docMaterial.id },
            })
        })

        it('应该拒绝为空内容材料生成向量', async () => {
            // 创建一个空内容的文本材料
            const emptyMaterial = await prisma.caseMaterials.create({
                data: {
                    caseId: testCaseId,
                    name: '空内容材料',
                    type: CaseMaterialType.CASE_CONTENT,
                    content: '',
                    status: 1,
                },
            })

            const result = await embedTextMaterialService(
                emptyMaterial.id,
                testUserId,
                testCaseId,
                testSessionId
            )

            expect(result.success).toBe(false)
            expect(result.error).toContain('材料内容为空')

            // 清理
            await prisma.caseMaterials.delete({
                where: { id: emptyMaterial.id },
            })
        })

        it('应该处理不存在的材料', async () => {
            const result = await embedTextMaterialService(
                999999,
                testUserId,
                testCaseId,
                testSessionId
            )

            expect(result.success).toBe(false)
            expect(result.error).toContain('材料不存在')
        })
    })

    describe('batchEmbedTextMaterialsService', () => {
        it('应该成功批量为文本材料生成向量', async () => {
            // 创建多个文本材料
            const material2 = await prisma.caseMaterials.create({
                data: {
                    caseId: testCaseId,
                    name: '证据材料1',
                    type: CaseMaterialType.CASE_CONTENT,
                    content: '这是第一份证据材料的内容，包含了重要的事实描述。',
                    status: 1,
                },
            })

            const material3 = await prisma.caseMaterials.create({
                data: {
                    caseId: testCaseId,
                    name: '证据材料2',
                    type: CaseMaterialType.CASE_CONTENT,
                    content: '这是第二份证据材料的内容，提供了补充信息。',
                    status: 1,
                },
            })

            const materialIds = [testMaterialId, material2.id, material3.id]

            const result = await batchEmbedTextMaterialsService(
                materialIds,
                testUserId,
                testCaseId,
                testSessionId
            )

            expect(result.total).toBe(3)
            expect(result.success).toBe(3)
            expect(result.failed).toBe(0)
            expect(result.results).toHaveLength(3)

            // 验证所有材料状态已更新
            for (const materialId of materialIds) {
                const material = await prisma.caseMaterials.findUnique({
                    where: { id: materialId },
                })
                expect(material?.embeddingStatus).toBe('completed')
            }

            // 清理
            await prisma.caseMaterials.deleteMany({
                where: { id: { in: [material2.id, material3.id] } },
            })
        })

        it('应该正确处理部分失败的情况', async () => {
            // 创建一个空内容材料（会失败）
            const emptyMaterial = await prisma.caseMaterials.create({
                data: {
                    caseId: testCaseId,
                    name: '空内容材料',
                    type: CaseMaterialType.CASE_CONTENT,
                    content: '',
                    status: 1,
                },
            })

            const materialIds = [testMaterialId, emptyMaterial.id]

            const result = await batchEmbedTextMaterialsService(
                materialIds,
                testUserId,
                testCaseId,
                testSessionId
            )

            expect(result.total).toBe(2)
            expect(result.success).toBe(1)
            expect(result.failed).toBe(1)

            // 验证成功的材料状态
            const successMaterial = await prisma.caseMaterials.findUnique({
                where: { id: testMaterialId },
            })
            expect(successMaterial?.embeddingStatus).toBe('completed')

            // 验证失败的材料状态
            const failedMaterial = await prisma.caseMaterials.findUnique({
                where: { id: emptyMaterial.id },
            })
            expect(failedMaterial?.embeddingStatus).toBe('failed')

            // 清理
            await prisma.caseMaterials.delete({
                where: { id: emptyMaterial.id },
            })
        })
    })

    describe('案件创建自动触发向量化', () => {
        it('应该在创建案件时自动触发文本材料向量化', async () => {
            // 创建包含文本材料的案件
            const result = await createCaseService({
                userId: testUserId,
                caseTypeId: testCaseTypeId,
                content: '这是一个新案件，应该自动触发向量化。案件内容包含了详细的事实描述和法律问题。',
            })

            // 等待异步向量化完成（最多等待 5 秒）
            let attempts = 0
            let material: any = null
            while (attempts < 10) {
                const materials = await findByCaseIdDAO(result.caseId)
                material = materials.find(m => m.type === CaseMaterialType.CASE_CONTENT)
                if (material && material.embeddingStatus === 'completed') {
                    break
                }
                await new Promise(resolve => setTimeout(resolve, 500))
                attempts++
            }

            // 验证向量化已完成
            expect(material).toBeTruthy()
            expect(material.embeddingStatus).toBe('completed')

            // 清理
            await prisma.caseMaterials.deleteMany({
                where: { caseId: result.caseId },
            })
            await prisma.caseSessions.deleteMany({
                where: { caseId: result.caseId },
            })
            await prisma.cases.delete({
                where: { id: result.caseId },
            })
        }, 10000) // 增加超时时间到 10 秒
    })
})
