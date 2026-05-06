/**
 * 材料服务层测试
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import './test-setup'
import {
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestMaterial,
    createTestOssFile,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    type CaseTestIds,
} from './test-db-helper'
import { PBT_CONFIG, materialDataArbitrary, materialStatusArb } from './test-generators'
import {
    createMaterialService,
    getMaterialByIdService,
    getMaterialsService,
    getMaterialsByCaseIdService,
    getMaterialContentService,
    updateMaterialService,
    updateMaterialStatusService,
    updateMaterialContentService,
    deleteMaterialService,
    getMaterialsByIdsService,
    getCompletedMaterialsContentService,
    hasPendingMaterialsService,
    getMaterialsStatsService,
    markMaterialsByOssFileIdService,
    getMaterialSummariesByMaterials,
} from '../../../server/services/material/material.service'
import { prisma } from '~~/server/utils/db'
import { MaterialStatus } from '../../../shared/types/material'
import { CaseMaterialType } from '../../../shared/types/case'

describe('材料服务层', () => {
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

    afterEach(async () => {
        // 清理每个测试创建的材料
        if (testIds.materialIds.length > 0) {
            await cleanupTestData({
                ...createEmptyTestIds(),
                materialIds: [...testIds.materialIds],
            })
            testIds.materialIds = []
        }
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    describe('createMaterialService - 创建材料', () => {
        it('应该成功创建材料', async () => {
            const material = await createMaterialService({
                caseId: testCase.id,
                name: '测试材料_服务层创建',
                type: CaseMaterialType.CASE_CONTENT,
            })
            testIds.materialIds.push(material.id)

            expect(material).toBeDefined()
            expect(material.id).toBeGreaterThan(0)
            expect(material.caseId).toBe(testCase.id)
            expect(material.name).toBe('测试材料_服务层创建')
        })

        it('应该在案件不存在时抛出错误', async () => {
            await expect(
                createMaterialService({
                    caseId: 999999,
                    name: '测试材料',
                    type: CaseMaterialType.CASE_CONTENT,
                })
            ).rejects.toThrow('案件不存在')
        })
    })

    describe('getMaterialByIdService - 获取材料详情', () => {
        it('应该返回材料详情', async () => {
            const material = await createTestMaterial({ caseId: testCase.id })
            testIds.materialIds.push(material.id)

            const found = await getMaterialByIdService(material.id)

            expect(found).toBeDefined()
            expect(found?.id).toBe(material.id)
            expect(found?.name).toBe(material.name)
        })

        it('应该返回 null 当材料不存在', async () => {
            const found = await getMaterialByIdService(999999)
            expect(found).toBeNull()
        })

        it('应该包含 OSS 文件信息', async () => {
            const ossFile = await createTestOssFile({ userId: testUser.id }, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const material = await createTestMaterial({
                caseId: testCase.id,
                ossFileId: ossFile.id,
            })
            testIds.materialIds.push(material.id)

            const found = await getMaterialByIdService(material.id)

            expect(found).toBeDefined()
            expect(found?.ossFileId).toBe(ossFile.id)
            expect(found?.fileName).toBe(ossFile.fileName)
        })
    })

    describe('getMaterialsService - 获取材料列表', () => {
        it('应该返回分页的材料列表', async () => {
            for (let i = 0; i < 3; i++) {
                const m = await createTestMaterial({
                    caseId: testCase.id,
                    name: `测试材料_列表_${i}`,
                })
                testIds.materialIds.push(m.id)
            }

            const result = await getMaterialsService({
                caseId: testCase.id,
                page: 1,
                pageSize: 10,
            })

            expect(result.list).toBeDefined()
            expect(result.total).toBeGreaterThanOrEqual(3)
        })

        it('应该支持按状态筛选', async () => {
            const pendingMaterial = await createTestMaterial({
                caseId: testCase.id,
                status: MaterialStatus.PENDING,
            })
            testIds.materialIds.push(pendingMaterial.id)

            const completedMaterial = await createTestMaterial({
                caseId: testCase.id,
                status: MaterialStatus.COMPLETED,
            })
            testIds.materialIds.push(completedMaterial.id)

            const result = await getMaterialsService({
                caseId: testCase.id,
                status: MaterialStatus.COMPLETED,
            })

            expect(result.list.every(m => m.status === MaterialStatus.COMPLETED)).toBe(true)
        })
    })

    describe('getMaterialsByCaseIdService - 获取案件材料', () => {
        it('应该返回案件的所有材料', async () => {
            for (let i = 0; i < 3; i++) {
                const m = await createTestMaterial({
                    caseId: testCase.id,
                    name: `测试材料_案件_${i}`,
                })
                testIds.materialIds.push(m.id)
            }

            const materials = await getMaterialsByCaseIdService(testCase.id)

            expect(materials.length).toBeGreaterThanOrEqual(3)
            expect(materials.every(m => m.caseId === testCase.id)).toBe(true)
        })
    })

    describe('getMaterialContentService - 获取材料内容', () => {
        it('应该返回材料内容（通过 textContentRecords）', async () => {
            const material = await createTestMaterial({ caseId: testCase.id })
            testIds.materialIds.push(material.id)

            // content 现在存储在 textContentRecords，不在 caseMaterials
            // 新创建的材料没有对应 textContentRecord，应返回 null
            const result = await getMaterialContentService(material.id)
            expect(result).toBeNull()
        })

        it('应该返回 null 当材料不存在', async () => {
            const result = await getMaterialContentService(999999)
            expect(result).toBeNull()
        })
    })

    describe('updateMaterialService - 更新材料', () => {
        it('应该成功更新材料', async () => {
            const material = await createTestMaterial({ caseId: testCase.id })
            testIds.materialIds.push(material.id)

            const newName = '更新后的材料名称'
            const updated = await updateMaterialService(material.id, { name: newName })

            expect(updated.name).toBe(newName)
        })

        it('应该在材料不存在时抛出错误', async () => {
            await expect(
                updateMaterialService(999999, { name: '新名称' })
            ).rejects.toThrow('材料不存在')
        })
    })

    describe('updateMaterialStatusService - 更新材料状态', () => {
        it('应该成功更新材料状态', async () => {
            const material = await createTestMaterial({
                caseId: testCase.id,
                status: MaterialStatus.PENDING,
            })
            testIds.materialIds.push(material.id)

            const updated = await updateMaterialStatusService(material.id, MaterialStatus.PROCESSING)

            expect(updated.status).toBe(MaterialStatus.PROCESSING)
        })
    })

    describe('markMaterialsByOssFileIdService - ASR/MinerU 异步完成时切状态', () => {
        it('应该把所有引用该 ossFile 的活跃材料切到 COMPLETED', async () => {
            const ossFile = await createTestOssFile({ userId: testUser.id })
            const m1 = await createTestMaterial({
                caseId: testCase.id,
                ossFileId: ossFile.id,
                type: CaseMaterialType.AUDIO,
                status: MaterialStatus.PROCESSING,
            })
            const m2 = await createTestMaterial({
                caseId: testCase.id,
                ossFileId: ossFile.id,
                type: CaseMaterialType.AUDIO,
                status: MaterialStatus.PENDING,
            })
            testIds.materialIds.push(m1.id, m2.id)

            await markMaterialsByOssFileIdService(ossFile.id, MaterialStatus.COMPLETED)

            const after1 = await prisma.caseMaterials.findUnique({ where: { id: m1.id } })
            const after2 = await prisma.caseMaterials.findUnique({ where: { id: m2.id } })
            expect(after1?.status).toBe(MaterialStatus.COMPLETED)
            expect(after2?.status).toBe(MaterialStatus.COMPLETED)
        })

        it('应该把所有引用该 ossFile 的活跃材料切到 FAILED', async () => {
            const ossFile = await createTestOssFile({ userId: testUser.id })
            const m = await createTestMaterial({
                caseId: testCase.id,
                ossFileId: ossFile.id,
                type: CaseMaterialType.DOCUMENT,
                status: MaterialStatus.PROCESSING,
            })
            testIds.materialIds.push(m.id)

            await markMaterialsByOssFileIdService(ossFile.id, MaterialStatus.FAILED)

            const after = await prisma.caseMaterials.findUnique({ where: { id: m.id } })
            expect(after?.status).toBe(MaterialStatus.FAILED)
        })

        it('找不到 ossFile 关联的材料时应安静返回，不抛错', async () => {
            // 用一个不存在的 ossFileId
            await expect(
                markMaterialsByOssFileIdService(99999999, MaterialStatus.COMPLETED),
            ).resolves.toBeUndefined()
        })

        it('已软删除的材料不应被切状态', async () => {
            const ossFile = await createTestOssFile({ userId: testUser.id })
            const m = await createTestMaterial({
                caseId: testCase.id,
                ossFileId: ossFile.id,
                type: CaseMaterialType.AUDIO,
                status: MaterialStatus.PENDING,
            })
            testIds.materialIds.push(m.id)
            // 模拟软删除
            await prisma.caseMaterials.update({
                where: { id: m.id },
                data: { deletedAt: new Date() },
            })

            await markMaterialsByOssFileIdService(ossFile.id, MaterialStatus.COMPLETED)

            const after = await prisma.caseMaterials.findUnique({ where: { id: m.id } })
            // 软删除的材料保持 PENDING，不被 helper 切
            expect(after?.status).toBe(MaterialStatus.PENDING)
        })
    })

    describe('updateMaterialContentService - 更新材料内容', () => {
        it('应该成功设置状态为已完成（content 存于 textContentRecords）', async () => {
            const material = await createTestMaterial({
                caseId: testCase.id,
                status: MaterialStatus.PROCESSING,
            })
            testIds.materialIds.push(material.id)

            const newContent = '更新后的内容'
            const updated = await updateMaterialContentService(material.id)

            // content 已迁移到 textContentRecords，caseMaterials 只更新状态
            expect(updated.status).toBe(MaterialStatus.COMPLETED)
        })
    })

    describe('deleteMaterialService - 删除材料', () => {
        it('应该成功软删除材料', async () => {
            const material = await createTestMaterial({ caseId: testCase.id })
            testIds.materialIds.push(material.id)

            await deleteMaterialService(material.id)

            const found = await getMaterialByIdService(material.id)
            expect(found).toBeNull()
        })

        it('应该在材料不存在时抛出错误', async () => {
            await expect(deleteMaterialService(999999)).rejects.toThrow('材料不存在')
        })
    })

    describe('getMaterialsByIdsService - 批量获取材料', () => {
        it('应该返回指定 ID 的材料列表', async () => {
            const ids: number[] = []
            for (let i = 0; i < 3; i++) {
                const m = await createTestMaterial({
                    caseId: testCase.id,
                    name: `测试材料_批量_${i}`,
                })
                testIds.materialIds.push(m.id)
                ids.push(m.id)
            }

            const materials = await getMaterialsByIdsService(ids)

            expect(materials.length).toBe(3)
            expect(materials.every(m => ids.includes(m.id))).toBe(true)
        })
    })

    describe('getCompletedMaterialsContentService - 获取已完成材料内容', () => {
        it('应该只返回已完成状态且有 textContentRecords 内容的材料', async () => {
            // 创建待处理材料（应被过滤）
            const pendingMaterial = await createTestMaterial({
                caseId: testCase.id,
                status: MaterialStatus.PENDING,
            })
            testIds.materialIds.push(pendingMaterial.id)

            // 创建已完成材料（无 textContentRecords，应被过滤）
            const completedMaterial = await createTestMaterial({
                caseId: testCase.id,
                status: MaterialStatus.COMPLETED,
            })
            testIds.materialIds.push(completedMaterial.id)

            // 获取已完成材料内容（无 textContentRecords 内容时，结果为空）
            const result = await getCompletedMaterialsContentService(testCase.id)

            // 结果中所有材料都应该有内容
            expect(result.every(m => m.content !== null && m.content !== '')).toBe(true)
        })
    })

    describe('hasPendingMaterialsService - 检查待处理材料', () => {
        it('应该返回 true 当有待处理材料', async () => {
            const material = await createTestMaterial({
                caseId: testCase.id,
                status: MaterialStatus.PENDING,
            })
            testIds.materialIds.push(material.id)

            const result = await hasPendingMaterialsService(testCase.id)

            expect(result).toBe(true)
        })

        it('应该返回 false 当没有待处理材料', async () => {
            // 创建一个新案件，确保没有待处理材料
            const newCase = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(newCase.id)

            const completedMaterial = await createTestMaterial({
                caseId: newCase.id,
                status: MaterialStatus.COMPLETED,
            })
            testIds.materialIds.push(completedMaterial.id)

            const result = await hasPendingMaterialsService(newCase.id)

            expect(result).toBe(false)
        })
    })

    describe('getMaterialsStatsService - 获取材料统计', () => {
        it('应该返回正确的材料统计', async () => {
            // 创建一个新案件用于统计测试
            const statsCase = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(statsCase.id)

            // 创建不同状态的材料
            const pending = await createTestMaterial({
                caseId: statsCase.id,
                status: MaterialStatus.PENDING,
            })
            testIds.materialIds.push(pending.id)

            const processing = await createTestMaterial({
                caseId: statsCase.id,
                status: MaterialStatus.PROCESSING,
            })
            testIds.materialIds.push(processing.id)

            const completed = await createTestMaterial({
                caseId: statsCase.id,
                status: MaterialStatus.COMPLETED,
            })
            testIds.materialIds.push(completed.id)

            const failed = await createTestMaterial({
                caseId: statsCase.id,
                status: MaterialStatus.FAILED,
            })
            testIds.materialIds.push(failed.id)

            const stats = await getMaterialsStatsService(statsCase.id)

            expect(stats.total).toBe(4)
            expect(stats.pending).toBe(1)
            expect(stats.processing).toBe(1)
            expect(stats.completed).toBe(1)
            expect(stats.failed).toBe(1)
        })
    })

    // ==================== 属性测试 ====================

    describe('属性测试', () => {
        describe('Property 6: 材料状态更新正确性', () => {
            it('更新状态后查询应返回新状态', async () => {
                await fc.assert(
                    fc.asyncProperty(materialStatusArb, async (newStatus) => {
                        const material = await createTestMaterial({
                            caseId: testCase.id,
                            status: MaterialStatus.PENDING,
                        })
                        testIds.materialIds.push(material.id)

                        const updated = await updateMaterialStatusService(material.id, newStatus)
                        const found = await getMaterialByIdService(material.id)

                        expect(updated.status).toBe(newStatus)
                        expect(found?.status).toBe(newStatus)

                        return true
                    }),
                    PBT_CONFIG
                )
            })
        })

        describe('Property 8: 已完成材料筛选正确性', () => {
            it('getCompletedMaterialsContentService 只返回已完成且有 textContentRecords 内容的材料', async () => {
                await fc.assert(
                    fc.asyncProperty(
                        fc.array(materialDataArbitrary, { minLength: 1, maxLength: 5 }),
                        async (materialsData) => {
                            // 创建一个新案件
                            const propCase = await createTestCase({
                                userId: testUser.id,
                                caseTypeId: testCaseType.id,
                            })
                            testIds.caseIds.push(propCase.id)

                            // 创建材料
                            for (const data of materialsData) {
                                const m = await createTestMaterial({
                                    caseId: propCase.id,
                                    name: data.name,
                                    type: data.type,
                                    status: data.status,
                                })
                                testIds.materialIds.push(m.id)
                            }

                            // 获取已完成材料内容
                            const result = await getCompletedMaterialsContentService(propCase.id)

                            // 验证所有返回的材料都有内容
                            for (const item of result) {
                                expect(item.content).toBeTruthy()
                            }

                            return true
                        }
                    ),
                    { ...PBT_CONFIG, numRuns: 20 }
                )
            })
        })
    })

    describe('getMaterialSummariesByMaterials - 跨表读取摘要', () => {
        it('混合类型：按 ossFileId / materialId 关联读到对应 summary', async () => {
            const ossFileDoc = await createTestOssFile({ userId: testUser.id }, testIds)
            const ossFileImg = await createTestOssFile({ userId: testUser.id }, testIds)
            const ossFileAudio = await createTestOssFile({ userId: testUser.id }, testIds)

            const matText = await createTestMaterial({ caseId: testCase.id, type: CaseMaterialType.CASE_CONTENT })
            const matDoc = await createTestMaterial({ caseId: testCase.id, type: CaseMaterialType.DOCUMENT, ossFileId: ossFileDoc.id })
            const matImg = await createTestMaterial({ caseId: testCase.id, type: CaseMaterialType.IMAGE, ossFileId: ossFileImg.id })
            const matAudio = await createTestMaterial({ caseId: testCase.id, type: CaseMaterialType.AUDIO, ossFileId: ossFileAudio.id })
            testIds.materialIds.push(matText.id, matDoc.id, matImg.id, matAudio.id)

            await prisma.textContentRecords.create({
                data: { userId: testUser.id, caseId: testCase.id, materialId: matText.id, content: 'x', summary: '文字摘要', status: 2 },
            })
            await prisma.docRecognitionRecords.create({
                data: { userId: testUser.id, ossFileId: ossFileDoc.id, status: 2, summary: '文档摘要', markdownContent: 'x' },
            })
            await prisma.imageRecognitionRecords.create({
                data: { userId: testUser.id, ossFileId: ossFileImg.id, status: 2, summary: '图片摘要', markdownContent: 'x' },
            })
            await prisma.asrRecords.create({
                data: { userId: testUser.id, ossFileId: ossFileAudio.id, status: 2, summary: '音频摘要', result: {} },
            })

            const map = await getMaterialSummariesByMaterials([
                { id: matText.id, type: CaseMaterialType.CASE_CONTENT, ossFileId: null },
                { id: matDoc.id, type: CaseMaterialType.DOCUMENT, ossFileId: ossFileDoc.id },
                { id: matImg.id, type: CaseMaterialType.IMAGE, ossFileId: ossFileImg.id },
                { id: matAudio.id, type: CaseMaterialType.AUDIO, ossFileId: ossFileAudio.id },
            ])

            expect(map.get(matText.id)).toBe('文字摘要')
            expect(map.get(matDoc.id)).toBe('文档摘要')
            expect(map.get(matImg.id)).toBe('图片摘要')
            expect(map.get(matAudio.id)).toBe('音频摘要')
        })

        it('空数组直接返回空 Map', async () => {
            const map = await getMaterialSummariesByMaterials([])
            expect(map.size).toBe(0)
        })

        it('找不到识别记录的材料：Map 不含该 materialId', async () => {
            const ossFile = await createTestOssFile({ userId: testUser.id }, testIds)
            const mat = await createTestMaterial({
                caseId: testCase.id, type: CaseMaterialType.DOCUMENT, ossFileId: ossFile.id,
            })
            testIds.materialIds.push(mat.id)
            const map = await getMaterialSummariesByMaterials([
                { id: mat.id, type: CaseMaterialType.DOCUMENT, ossFileId: ossFile.id },
            ])
            expect(map.get(mat.id)).toBeUndefined()
        })
    })
})
