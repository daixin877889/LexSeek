/**
 * 案件材料 DAO 层测试
 *
 * **Feature: case-material-dao**
 * **Validates: Requirements 7.1, 7.2**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
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
import {
    batchAddCaseMaterialsDAO,
    findByCaseIdDAO,
} from '../../../server/services/case/caseMaterial.dao'
import { MaterialStatus } from '../../../shared/types/material'
import { CaseMaterialType } from '../../../shared/types/case'

describe('案件材料 DAO 层', () => {
    let testIds: CaseTestIds
    let testUser: Awaited<ReturnType<typeof createTestUser>>
    let testCaseType: Awaited<ReturnType<typeof createTestCaseType>>
    let testCase: Awaited<ReturnType<typeof createTestCase>>

    beforeAll(async () => {
        testIds = createEmptyTestIds()
        // 创建测试用户和案件类型
        testUser = await createTestUser()
        testIds.userIds.push(testUser.id)
        testCaseType = await createTestCaseType({ status: 1 })
        testIds.caseTypeIds.push(testCaseType.id)
        // 创建测试案件
        testCase = await createTestCase({
            userId: testUser.id,
            caseTypeId: testCaseType.id,
        })
        testIds.caseIds.push(testCase.id)
    })

    afterEach(async () => {
        // 清理每个测试创建的材料
        const materialIdsToClean = [...testIds.materialIds]

        if (materialIdsToClean.length > 0) {
            await cleanupTestData({
                ...createEmptyTestIds(),
                materialIds: materialIdsToClean,
            })
        }

        // 重置材料追踪
        testIds.materialIds = []
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    describe('batchAddCaseMaterialsDAO - 批量创建材料', () => {
        it('应该成功批量创建文本材料', async () => {
            const materials = [
                {
                    name: '案情描述',
                    type: CaseMaterialType.CASE_CONTENT,
                    ossFileId: null,
                    isEncrypted: false,
                    status: MaterialStatus.PENDING,
                },
                {
                    name: '补充说明',
                    type: CaseMaterialType.CASE_CONTENT,
                    ossFileId: null,
                    isEncrypted: false,
                    status: MaterialStatus.PENDING,
                },
            ]

            await batchAddCaseMaterialsDAO(testCase.id, materials)

            // 查询验证
            const savedMaterials = await findByCaseIdDAO(testCase.id)
            expect(savedMaterials.length).toBe(2)
            expect(savedMaterials[0].name).toBe('案情描述')
            expect(savedMaterials[0].type).toBe(CaseMaterialType.CASE_CONTENT)
            expect(savedMaterials[1].name).toBe('补充说明')

            // 记录 ID 以便清理
            testIds.materialIds.push(...savedMaterials.map(m => m.id))
        })

        it('应该成功批量创建文件材料', async () => {
            // 创建测试 OSS 文件
            const ossFile1 = await createTestOssFile({
                fileName: 'test_doc.pdf',
                userId: testUser.id,
            })
            testIds.ossFileIds.push(ossFile1.id)

            const ossFile2 = await createTestOssFile({
                fileName: 'test_image.jpg',
                userId: testUser.id,
            })
            testIds.ossFileIds.push(ossFile2.id)

            const materials = [
                {
                    name: '证据文档',
                    type: CaseMaterialType.DOCUMENT,
                    ossFileId: ossFile1.id,
                    isEncrypted: false,
                    status: MaterialStatus.PENDING,
                },
                {
                    name: '证据图片',
                    type: CaseMaterialType.IMAGE,
                    ossFileId: ossFile2.id,
                    isEncrypted: false,
                    status: MaterialStatus.PENDING,
                },
            ]

            await batchAddCaseMaterialsDAO(testCase.id, materials)

            // 查询验证
            const savedMaterials = await findByCaseIdDAO(testCase.id)
            expect(savedMaterials.length).toBe(2)
            expect(savedMaterials[0].type).toBe(CaseMaterialType.DOCUMENT)
            expect(savedMaterials[0].ossFileId).toBe(ossFile1.id)
            expect(savedMaterials[1].type).toBe(CaseMaterialType.IMAGE)
            expect(savedMaterials[1].ossFileId).toBe(ossFile2.id)

            // 记录 ID 以便清理
            testIds.materialIds.push(...savedMaterials.map(m => m.id))
        })

        it('应该支持创建加密材料', async () => {
            const materials = [
                {
                    name: '加密内容',
                    type: CaseMaterialType.CASE_CONTENT,
                    ossFileId: null,
                    isEncrypted: true,
                    status: MaterialStatus.PENDING,
                },
            ]

            await batchAddCaseMaterialsDAO(testCase.id, materials)

            // 查询验证
            const savedMaterials = await findByCaseIdDAO(testCase.id)
            expect(savedMaterials.length).toBe(1)
            expect(savedMaterials[0].isEncrypted).toBe(true)

            // 记录 ID 以便清理
            testIds.materialIds.push(...savedMaterials.map(m => m.id))
        })

        it('应该支持创建不同状态的材料', async () => {
            const materials = [
                {
                    name: '待处理材料',
                    type: CaseMaterialType.CASE_CONTENT,
                    ossFileId: null,
                    isEncrypted: false,
                    status: MaterialStatus.PENDING,
                },
                {
                    name: '处理中材料',
                    type: CaseMaterialType.CASE_CONTENT,
                    ossFileId: null,
                    isEncrypted: false,
                    status: MaterialStatus.PROCESSING,
                },
            ]

            await batchAddCaseMaterialsDAO(testCase.id, materials)

            // 查询验证
            const savedMaterials = await findByCaseIdDAO(testCase.id)
            expect(savedMaterials.length).toBe(2)
            expect(savedMaterials[0].status).toBe(MaterialStatus.PENDING)
            expect(savedMaterials[1].status).toBe(MaterialStatus.PROCESSING)

            // 记录 ID 以便清理
            testIds.materialIds.push(...savedMaterials.map(m => m.id))
        })

        it('应该支持创建空材料列表', async () => {
            await batchAddCaseMaterialsDAO(testCase.id, [])

            // 查询验证
            const savedMaterials = await findByCaseIdDAO(testCase.id)
            expect(savedMaterials.length).toBe(0)
        })

        it('应该正确设置创建时间和更新时间', async () => {
            const beforeCreate = new Date()

            const materials = [
                {
                    name: '时间戳测试',
                    type: CaseMaterialType.CASE_CONTENT,
                    ossFileId: null,
                    isEncrypted: false,
                    status: MaterialStatus.PENDING,
                },
            ]

            await batchAddCaseMaterialsDAO(testCase.id, materials)

            const afterCreate = new Date()

            // 查询验证
            const savedMaterials = await findByCaseIdDAO(testCase.id)
            expect(savedMaterials.length).toBe(1)
            expect(savedMaterials[0].createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime())
            expect(savedMaterials[0].createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime())
            expect(savedMaterials[0].updatedAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime())
            expect(savedMaterials[0].updatedAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime())

            // 记录 ID 以便清理
            testIds.materialIds.push(...savedMaterials.map(m => m.id))
        })
    })

    describe('findByCaseIdDAO - 查询案件材料', () => {
        it('应该返回指定案件的所有材料', async () => {
            // 创建多个材料
            const materials = [
                {
                    name: '材料1',
                    type: CaseMaterialType.CASE_CONTENT,
                    ossFileId: null,
                    isEncrypted: false,
                    status: MaterialStatus.PENDING,
                },
                {
                    name: '材料2',
                    type: CaseMaterialType.CASE_CONTENT,
                    ossFileId: null,
                    isEncrypted: false,
                    status: MaterialStatus.PENDING,
                },
                {
                    name: '材料3',
                    type: CaseMaterialType.CASE_CONTENT,
                    ossFileId: null,
                    isEncrypted: false,
                    status: MaterialStatus.PENDING,
                },
            ]

            await batchAddCaseMaterialsDAO(testCase.id, materials)

            // 查询验证
            const savedMaterials = await findByCaseIdDAO(testCase.id)
            expect(savedMaterials.length).toBe(3)
            expect(savedMaterials[0].name).toBe('材料1')
            expect(savedMaterials[1].name).toBe('材料2')
            expect(savedMaterials[2].name).toBe('材料3')

            // 记录 ID 以便清理
            testIds.materialIds.push(...savedMaterials.map(m => m.id))
        })

        it('应该按创建时间升序排序', async () => {
            // 创建多个材料（有时间间隔）
            const materials1 = [
                {
                    name: '第一个材料',
                    type: CaseMaterialType.CASE_CONTENT,
                    ossFileId: null,
                    isEncrypted: false,
                    status: MaterialStatus.PENDING,
                },
            ]
            await batchAddCaseMaterialsDAO(testCase.id, materials1)

            // 等待一小段时间
            await new Promise(resolve => setTimeout(resolve, 10))

            const materials2 = [
                {
                    name: '第二个材料',
                    type: CaseMaterialType.CASE_CONTENT,
                    ossFileId: null,
                    isEncrypted: false,
                    status: MaterialStatus.PENDING,
                },
            ]
            await batchAddCaseMaterialsDAO(testCase.id, materials2)

            // 查询验证
            const savedMaterials = await findByCaseIdDAO(testCase.id)
            expect(savedMaterials.length).toBe(2)
            expect(savedMaterials[0].name).toBe('第一个材料')
            expect(savedMaterials[1].name).toBe('第二个材料')
            expect(savedMaterials[0].createdAt.getTime()).toBeLessThan(
                savedMaterials[1].createdAt.getTime()
            )

            // 记录 ID 以便清理
            testIds.materialIds.push(...savedMaterials.map(m => m.id))
        })

        it('应该返回空数组当案件没有材料', async () => {
            // 创建一个新案件（没有材料）
            const newCase = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(newCase.id)

            const savedMaterials = await findByCaseIdDAO(newCase.id)
            expect(savedMaterials).toEqual([])
        })

        it('应该返回空数组当案件不存在', async () => {
            const savedMaterials = await findByCaseIdDAO(999999)
            expect(savedMaterials).toEqual([])
        })
    })

    // ==================== 属性测试 ====================

    describe('属性测试', () => {
        describe('Property 1: 批量创建-查询往返一致性', () => {
            it('批量创建材料后查询应返回等价的材料数据', async () => {
                const materialArbitrary = fc.record({
                    name: fc.string({ minLength: 1, maxLength: 50 }),
                    type: fc.constantFrom(
                        CaseMaterialType.CASE_CONTENT,
                        CaseMaterialType.DOCUMENT,
                        CaseMaterialType.IMAGE,
                        CaseMaterialType.AUDIO
                    ),
                    isEncrypted: fc.boolean(),
                    status: fc.constantFrom(
                        MaterialStatus.PENDING,
                        MaterialStatus.PROCESSING,
                        MaterialStatus.COMPLETED,
                        MaterialStatus.FAILED
                    ),
                })

                await fc.assert(
                    fc.asyncProperty(
                        fc.array(materialArbitrary, { minLength: 1, maxLength: 5 }),
                        async (materialsData) => {
                            // 创建一个独立的测试案件，避免数据污染
                            const propertyTestCase = await createTestCase({
                                userId: testUser.id,
                                caseTypeId: testCaseType.id,
                            })
                            testIds.caseIds.push(propertyTestCase.id)

                            const materials = materialsData.map(m => ({
                                name: m.name,
                                type: m.type,
                                ossFileId: null,
                                isEncrypted: m.isEncrypted,
                                status: m.status,
                            }))

                            await batchAddCaseMaterialsDAO(propertyTestCase.id, materials)

                            const savedMaterials = await findByCaseIdDAO(propertyTestCase.id)

                            // 验证数量一致
                            expect(savedMaterials.length).toBe(materials.length)

                            // 验证每个材料的数据一致
                            for (let i = 0; i < materials.length; i++) {
                                expect(savedMaterials[i].name).toBe(materials[i].name)
                                expect(savedMaterials[i].type).toBe(materials[i].type)
                                expect(savedMaterials[i].isEncrypted).toBe(materials[i].isEncrypted)
                                expect(savedMaterials[i].status).toBe(materials[i].status)
                                expect(savedMaterials[i].caseId).toBe(propertyTestCase.id)
                            }

                            // 记录 ID 以便清理
                            testIds.materialIds.push(...savedMaterials.map(m => m.id))

                            return true
                        }
                    ),
                    { numRuns: 20 }
                )
            })
        })

        describe('Property 2: 材料创建时间单调递增', () => {
            it('后创建的材料的创建时间应该大于或等于先创建的材料', async () => {
                await fc.assert(
                    fc.asyncProperty(
                        fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
                            minLength: 2,
                            maxLength: 5,
                        }),
                        async (names) => {
                            // 创建一个独立的测试案件，避免数据污染
                            const propertyTestCase = await createTestCase({
                                userId: testUser.id,
                                caseTypeId: testCaseType.id,
                            })
                            testIds.caseIds.push(propertyTestCase.id)

                            const materials = names.map(name => ({
                                name,
                                type: CaseMaterialType.CASE_CONTENT,
                                ossFileId: null,
                                isEncrypted: false,
                                status: MaterialStatus.PENDING,
                            }))

                            await batchAddCaseMaterialsDAO(propertyTestCase.id, materials)

                            const savedMaterials = await findByCaseIdDAO(propertyTestCase.id)

                            // 验证创建时间单调递增（或相等，因为批量创建可能在同一时刻）
                            for (let i = 1; i < savedMaterials.length; i++) {
                                expect(savedMaterials[i].createdAt.getTime()).toBeGreaterThanOrEqual(
                                    savedMaterials[i - 1].createdAt.getTime()
                                )
                            }

                            // 记录 ID 以便清理
                            testIds.materialIds.push(...savedMaterials.map(m => m.id))

                            return true
                        }
                    ),
                    { numRuns: 20 }
                )
            })
        })

        describe('Property 3: 不同案件的材料隔离', () => {
            it('查询案件材料应只返回该案件的材料，不包含其他案件的材料', async () => {
                await fc.assert(
                    fc.asyncProperty(
                        fc.tuple(
                            fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
                                minLength: 1,
                                maxLength: 3,
                            }),
                            fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
                                minLength: 1,
                                maxLength: 3,
                            })
                        ),
                        async ([names1, names2]) => {
                            // 为每次属性测试创建独立的案件，避免数据污染
                            const propertyTestCase1 = await createTestCase({
                                userId: testUser.id,
                                caseTypeId: testCaseType.id,
                            })
                            testIds.caseIds.push(propertyTestCase1.id)

                            const propertyTestCase2 = await createTestCase({
                                userId: testUser.id,
                                caseTypeId: testCaseType.id,
                            })
                            testIds.caseIds.push(propertyTestCase2.id)

                            // 为第一个案件创建材料
                            const materials1 = names1.map(name => ({
                                name: `案件1_${name}`,
                                type: CaseMaterialType.CASE_CONTENT,
                                ossFileId: null,
                                isEncrypted: false,
                                status: MaterialStatus.PENDING,
                            }))
                            await batchAddCaseMaterialsDAO(propertyTestCase1.id, materials1)

                            // 为第二个案件创建材料
                            const materials2 = names2.map(name => ({
                                name: `案件2_${name}`,
                                type: CaseMaterialType.CASE_CONTENT,
                                ossFileId: null,
                                isEncrypted: false,
                                status: MaterialStatus.PENDING,
                            }))
                            await batchAddCaseMaterialsDAO(propertyTestCase2.id, materials2)

                            // 查询第一个案件的材料
                            const savedMaterials1 = await findByCaseIdDAO(propertyTestCase1.id)
                            expect(savedMaterials1.length).toBe(materials1.length)
                            expect(savedMaterials1.every(m => m.caseId === propertyTestCase1.id)).toBe(true)
                            expect(savedMaterials1.every(m => m.name.startsWith('案件1_'))).toBe(true)

                            // 查询第二个案件的材料
                            const savedMaterials2 = await findByCaseIdDAO(propertyTestCase2.id)
                            expect(savedMaterials2.length).toBe(materials2.length)
                            expect(savedMaterials2.every(m => m.caseId === propertyTestCase2.id)).toBe(true)
                            expect(savedMaterials2.every(m => m.name.startsWith('案件2_'))).toBe(true)

                            // 记录 ID 以便清理
                            testIds.materialIds.push(...savedMaterials1.map(m => m.id))
                            testIds.materialIds.push(...savedMaterials2.map(m => m.id))

                            return true
                        }
                    ),
                    { numRuns: 20 }
                )
            })
        })
    })
})
