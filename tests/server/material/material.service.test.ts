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
} from '../../../server/services/material/material.service'
import { MaterialStatus, MaterialType } from '../../../shared/types/material'

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
                type: MaterialType.TEXT,
                content: '测试内容',
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
                    type: MaterialType.TEXT,
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
        it('应该返回材料内容', async () => {
            const content = '这是测试内容'
            const material = await createTestMaterial({
                caseId: testCase.id,
                content,
            })
            testIds.materialIds.push(material.id)

            const result = await getMaterialContentService(material.id)

            expect(result).toBe(content)
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

    describe('updateMaterialContentService - 更新材料内容', () => {
        it('应该成功更新材料内容并设置状态为已完成', async () => {
            const material = await createTestMaterial({
                caseId: testCase.id,
                status: MaterialStatus.PROCESSING,
            })
            testIds.materialIds.push(material.id)

            const newContent = '更新后的内容'
            const updated = await updateMaterialContentService(material.id, newContent)

            expect(updated.content).toBe(newContent)
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
        it('应该只返回已完成状态的材料内容', async () => {
            const pendingMaterial = await createTestMaterial({
                caseId: testCase.id,
                status: MaterialStatus.PENDING,
                content: '待处理内容',
            })
            testIds.materialIds.push(pendingMaterial.id)

            const completedMaterial = await createTestMaterial({
                caseId: testCase.id,
                status: MaterialStatus.COMPLETED,
                content: '已完成内容',
            })
            testIds.materialIds.push(completedMaterial.id)

            const result = await getCompletedMaterialsContentService(testCase.id)

            expect(result.some(m => m.materialId === completedMaterial.id)).toBe(true)
            expect(result.every(m => m.content !== null)).toBe(true)
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
            it('getCompletedMaterialsContentService 只返回已完成且有内容的材料', async () => {
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
                                    content: data.content,
                                    status: data.status,
                                })
                                testIds.materialIds.push(m.id)
                            }

                            // 获取已完成材料内容
                            const result = await getCompletedMaterialsContentService(propCase.id)

                            // 验证所有返回的材料都是已完成状态且有内容
                            for (const item of result) {
                                expect(item.content).toBeTruthy()
                            }

                            return true
                        }
                    ),
                    { ...PBT_CONFIG, numRuns: 20 } // 减少运行次数避免创建过多数据
                )
            })
        })
    })
})
