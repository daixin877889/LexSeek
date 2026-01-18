/**
 * 案件材料服务层测试
 *
 * **Feature: case-material-service**
 * **Validates: Requirements 7.3**
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
import { batchAddCaseMaterialsService } from '../../../server/services/case/caseMaterial.service'
import { findByCaseIdDAO } from '../../../server/services/case/caseMaterial.dao'
import { CaseMaterialType, type CaseMaterialParam } from '../../../shared/types/case'

describe('案件材料服务层', () => {
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
        // 清理每个测试创建的材料和文件
        const materialIdsToClean = [...testIds.materialIds]
        const ossFileIdsToClean = [...testIds.ossFileIds]

        if (materialIdsToClean.length > 0 || ossFileIdsToClean.length > 0) {
            await cleanupTestData({
                ...createEmptyTestIds(),
                materialIds: materialIdsToClean,
                ossFileIds: ossFileIdsToClean,
            })
        }

        // 重置追踪
        testIds.materialIds = []
        testIds.ossFileIds = []
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    describe('batchAddCaseMaterialsService - 批量添加材料', () => {
        describe('文本材料处理', () => {
            it('应该成功添加文本材料', async () => {
                const materials: CaseMaterialParam[] = [
                    {
                        type: CaseMaterialType.CASE_CONTENT,
                        name: '案情描述',
                        content: '这是一个测试案情描述',
                    },
                ]

                await batchAddCaseMaterialsService(
                    testCase.id,
                    testUser.id,
                    materials
                )

                // 验证材料已创建
                const savedMaterials = await findByCaseIdDAO(testCase.id)
                expect(savedMaterials.length).toBe(1)
                expect(savedMaterials[0].name).toBe('案情描述')
                expect(savedMaterials[0].type).toBe(CaseMaterialType.CASE_CONTENT)
                expect(savedMaterials[0].content).toBe('这是一个测试案情描述')
                expect(savedMaterials[0].status).toBe(1) // 待处理

                testIds.materialIds.push(...savedMaterials.map(m => m.id))
            })

            it('应该使用默认名称当未提供材料名称', async () => {
                const materials: CaseMaterialParam[] = [
                    {
                        type: CaseMaterialType.CASE_CONTENT,
                        content: '测试内容',
                    },
                ]

                await batchAddCaseMaterialsService(
                    testCase.id,
                    testUser.id,
                    materials
                )

                const savedMaterials = await findByCaseIdDAO(testCase.id)
                expect(savedMaterials.length).toBe(1)
                expect(savedMaterials[0].name).toBe('案情描述')

                testIds.materialIds.push(...savedMaterials.map(m => m.id))
            })

            it('应该拒绝空内容的文本材料', async () => {
                const materials: CaseMaterialParam[] = [
                    {
                        type: CaseMaterialType.CASE_CONTENT,
                        content: '',
                    },
                ]

                await expect(
                    batchAddCaseMaterialsService(testCase.id, testUser.id, materials)
                ).rejects.toThrow('文本材料必须包含内容')
            })

            it('应该拒绝只有空格的文本材料', async () => {
                const materials: CaseMaterialParam[] = [
                    {
                        type: CaseMaterialType.CASE_CONTENT,
                        content: '   ',
                    },
                ]

                await expect(
                    batchAddCaseMaterialsService(testCase.id, testUser.id, materials)
                ).rejects.toThrow('文本材料必须包含内容')
            })

            it('应该拒绝缺少 content 字段的文本材料', async () => {
                const materials: CaseMaterialParam[] = [
                    {
                        type: CaseMaterialType.CASE_CONTENT,
                        name: '测试',
                    },
                ]

                await expect(
                    batchAddCaseMaterialsService(testCase.id, testUser.id, materials)
                ).rejects.toThrow('文本材料必须包含内容')
            })
        })

        describe('文件材料处理', () => {
            it('应该成功添加文档材料', async () => {
                // 创建测试 OSS 文件
                const ossFile = await createTestOssFile({
                    fileName: 'test_document.pdf',
                    userId: testUser.id,
                })
                testIds.ossFileIds.push(ossFile.id)

                const materials: CaseMaterialParam[] = [
                    {
                        type: CaseMaterialType.DOCUMENT,
                        name: '证据文档',
                        ossFileId: ossFile.id,
                    },
                ]

                await batchAddCaseMaterialsService(
                    testCase.id,
                    testUser.id,
                    materials
                )

                const savedMaterials = await findByCaseIdDAO(testCase.id)
                expect(savedMaterials.length).toBe(1)
                expect(savedMaterials[0].name).toBe('证据文档')
                expect(savedMaterials[0].type).toBe(CaseMaterialType.DOCUMENT)
                expect(savedMaterials[0].ossFileId).toBe(ossFile.id)

                testIds.materialIds.push(...savedMaterials.map(m => m.id))
            })

            it('应该成功添加图片材料', async () => {
                const ossFile = await createTestOssFile({
                    fileName: 'evidence.jpg',
                    userId: testUser.id,
                })
                testIds.ossFileIds.push(ossFile.id)

                const materials: CaseMaterialParam[] = [
                    {
                        type: CaseMaterialType.IMAGE,
                        ossFileId: ossFile.id,
                    },
                ]

                await batchAddCaseMaterialsService(
                    testCase.id,
                    testUser.id,
                    materials
                )

                const savedMaterials = await findByCaseIdDAO(testCase.id)
                expect(savedMaterials.length).toBe(1)
                expect(savedMaterials[0].type).toBe(CaseMaterialType.IMAGE)
                expect(savedMaterials[0].name).toBe('evidence.jpg') // 使用文件名

                testIds.materialIds.push(...savedMaterials.map(m => m.id))
            })

            it('应该成功添加音频材料', async () => {
                const ossFile = await createTestOssFile({
                    fileName: 'recording.mp3',
                    userId: testUser.id,
                })
                testIds.ossFileIds.push(ossFile.id)

                const materials: CaseMaterialParam[] = [
                    {
                        type: CaseMaterialType.AUDIO,
                        ossFileId: ossFile.id,
                    },
                ]

                await batchAddCaseMaterialsService(
                    testCase.id,
                    testUser.id,
                    materials
                )

                const savedMaterials = await findByCaseIdDAO(testCase.id)
                expect(savedMaterials.length).toBe(1)
                expect(savedMaterials[0].type).toBe(CaseMaterialType.AUDIO)
                expect(savedMaterials[0].name).toBe('recording.mp3')

                testIds.materialIds.push(...savedMaterials.map(m => m.id))
            })

            it('应该使用文件名作为默认材料名称', async () => {
                const ossFile = await createTestOssFile({
                    fileName: '合同文件.pdf',
                    userId: testUser.id,
                })
                testIds.ossFileIds.push(ossFile.id)

                const materials: CaseMaterialParam[] = [
                    {
                        type: CaseMaterialType.DOCUMENT,
                        ossFileId: ossFile.id,
                    },
                ]

                await batchAddCaseMaterialsService(
                    testCase.id,
                    testUser.id,
                    materials
                )

                const savedMaterials = await findByCaseIdDAO(testCase.id)
                expect(savedMaterials[0].name).toBe('合同文件.pdf')

                testIds.materialIds.push(...savedMaterials.map(m => m.id))
            })

            it('应该拒绝缺少 ossFileId 的文件材料', async () => {
                const materials: CaseMaterialParam[] = [
                    {
                        type: CaseMaterialType.DOCUMENT,
                        name: '文档',
                    },
                ]

                await expect(
                    batchAddCaseMaterialsService(testCase.id, testUser.id, materials)
                ).rejects.toThrow('文件材料必须提供 OSS 文件 ID')
            })

            it('应该拒绝不存在的 OSS 文件', async () => {
                const materials: CaseMaterialParam[] = [
                    {
                        type: CaseMaterialType.DOCUMENT,
                        ossFileId: 999999,
                    },
                ]

                await expect(
                    batchAddCaseMaterialsService(testCase.id, testUser.id, materials)
                ).rejects.toThrow('OSS 文件不存在')
            })

            it('应该拒绝不属于当前用户的文件', async () => {
                // 创建另一个用户的文件
                const otherUser = await createTestUser()
                testIds.userIds.push(otherUser.id)

                const ossFile = await createTestOssFile({
                    fileName: 'other_user_file.pdf',
                    userId: otherUser.id,
                })
                testIds.ossFileIds.push(ossFile.id)

                const materials: CaseMaterialParam[] = [
                    {
                        type: CaseMaterialType.DOCUMENT,
                        ossFileId: ossFile.id,
                    },
                ]

                await expect(
                    batchAddCaseMaterialsService(testCase.id, testUser.id, materials)
                ).rejects.toThrow('无权使用该文件，请检查文件权限')
            })
        })

        describe('混合材料处理', () => {
            it('应该成功批量添加混合类型材料', async () => {
                // 创建测试文件
                const docFile = await createTestOssFile({
                    fileName: 'contract.pdf',
                    userId: testUser.id,
                })
                testIds.ossFileIds.push(docFile.id)

                const imageFile = await createTestOssFile({
                    fileName: 'photo.jpg',
                    userId: testUser.id,
                })
                testIds.ossFileIds.push(imageFile.id)

                const materials: CaseMaterialParam[] = [
                    {
                        type: CaseMaterialType.CASE_CONTENT,
                        name: '案情说明',
                        content: '这是案情说明',
                    },
                    {
                        type: CaseMaterialType.DOCUMENT,
                        name: '合同文件',
                        ossFileId: docFile.id,
                    },
                    {
                        type: CaseMaterialType.IMAGE,
                        ossFileId: imageFile.id,
                    },
                ]

                await batchAddCaseMaterialsService(
                    testCase.id,
                    testUser.id,
                    materials
                )

                const savedMaterials = await findByCaseIdDAO(testCase.id)
                expect(savedMaterials.length).toBe(3)
                expect(savedMaterials[0].type).toBe(CaseMaterialType.CASE_CONTENT)
                expect(savedMaterials[1].type).toBe(CaseMaterialType.DOCUMENT)
                expect(savedMaterials[2].type).toBe(CaseMaterialType.IMAGE)

                testIds.materialIds.push(...savedMaterials.map(m => m.id))
            })
        })

        describe('边界情况处理', () => {
            it('应该处理空材料列表', async () => {
                await batchAddCaseMaterialsService(testCase.id, testUser.id, [])

                const savedMaterials = await findByCaseIdDAO(testCase.id)
                expect(savedMaterials.length).toBe(0)
            })

            it('应该拒绝无效的材料类型', async () => {
                const materials: CaseMaterialParam[] = [
                    {
                        type: 999 as CaseMaterialType,
                        content: '测试',
                    },
                ]

                await expect(
                    batchAddCaseMaterialsService(testCase.id, testUser.id, materials)
                ).rejects.toThrow('无效的材料类型')
            })
        })
    })

    // ==================== 属性测试 ====================

    describe('属性测试', () => {
        describe('Property 1: 文本材料添加-查询一致性', () => {
            it('添加的文本材料应该能够完整查询回来', async () => {
                const materialArbitrary = fc.record({
                    name: fc.string({ minLength: 1, maxLength: 50 }),
                    content: fc.string({ minLength: 1, maxLength: 200 }),
                })

                await fc.assert(
                    fc.asyncProperty(
                        fc.array(materialArbitrary, { minLength: 1, maxLength: 5 }),
                        async (materialsData) => {
                            // 创建独立的测试案件
                            const propertyTestCase = await createTestCase({
                                userId: testUser.id,
                                caseTypeId: testCaseType.id,
                            })
                            testIds.caseIds.push(propertyTestCase.id)

                            const materials: CaseMaterialParam[] = materialsData.map(m => ({
                                type: CaseMaterialType.CASE_CONTENT,
                                name: m.name,
                                content: m.content,
                            }))

                            await batchAddCaseMaterialsService(
                                propertyTestCase.id,
                                testUser.id,
                                materials
                            )

                            const savedMaterials = await findByCaseIdDAO(propertyTestCase.id)

                            // 验证数量一致
                            expect(savedMaterials.length).toBe(materials.length)

                            // 验证每个材料的数据一致
                            for (let i = 0; i < materials.length; i++) {
                                expect(savedMaterials[i].name).toBe(materials[i].name)
                                expect(savedMaterials[i].content).toBe(materials[i].content)
                                expect(savedMaterials[i].type).toBe(CaseMaterialType.CASE_CONTENT)
                            }

                            testIds.materialIds.push(...savedMaterials.map(m => m.id))

                            return true
                        }
                    ),
                    { numRuns: 20 }
                )
            })
        })

        describe('Property 2: 文件权限验证', () => {
            it('只能添加属于当前用户的文件', async () => {
                await fc.assert(
                    fc.asyncProperty(
                        fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
                            minLength: 1,
                            maxLength: 3,
                        }),
                        async (fileNames) => {
                            // 创建独立的测试案件
                            const propertyTestCase = await createTestCase({
                                userId: testUser.id,
                                caseTypeId: testCaseType.id,
                            })
                            testIds.caseIds.push(propertyTestCase.id)

                            // 为当前用户创建文件
                            const ossFiles = await Promise.all(
                                fileNames.map(name =>
                                    createTestOssFile({
                                        fileName: `${name}.pdf`,
                                        userId: testUser.id,
                                    })
                                )
                            )
                            testIds.ossFileIds.push(...ossFiles.map(f => f.id))

                            const materials: CaseMaterialParam[] = ossFiles.map(file => ({
                                type: CaseMaterialType.DOCUMENT,
                                ossFileId: file.id,
                            }))

                            // 应该成功添加
                            await batchAddCaseMaterialsService(
                                propertyTestCase.id,
                                testUser.id,
                                materials
                            )

                            const savedMaterials = await findByCaseIdDAO(propertyTestCase.id)
                            expect(savedMaterials.length).toBe(materials.length)

                            testIds.materialIds.push(...savedMaterials.map(m => m.id))

                            return true
                        }
                    ),
                    { numRuns: 20 }
                )
            })
        })

        describe('Property 3: 材料类型正确性', () => {
            it('保存的材料类型应该与输入的类型一致', async () => {
                const materialTypeArbitrary = fc.constantFrom(
                    CaseMaterialType.CASE_CONTENT,
                    CaseMaterialType.DOCUMENT,
                    CaseMaterialType.IMAGE,
                    CaseMaterialType.AUDIO
                )

                await fc.assert(
                    fc.asyncProperty(
                        fc.array(materialTypeArbitrary, { minLength: 1, maxLength: 5 }),
                        async (types) => {
                            // 创建独立的测试案件
                            const propertyTestCase = await createTestCase({
                                userId: testUser.id,
                                caseTypeId: testCaseType.id,
                            })
                            testIds.caseIds.push(propertyTestCase.id)

                            const materials: CaseMaterialParam[] = []

                            for (const type of types) {
                                if (type === CaseMaterialType.CASE_CONTENT) {
                                    materials.push({
                                        type,
                                        content: '测试内容',
                                    })
                                } else {
                                    // 创建文件
                                    const ossFile = await createTestOssFile({
                                        fileName: `test_${type}.file`,
                                        userId: testUser.id,
                                    })
                                    testIds.ossFileIds.push(ossFile.id)

                                    materials.push({
                                        type,
                                        ossFileId: ossFile.id,
                                    })
                                }
                            }

                            await batchAddCaseMaterialsService(
                                propertyTestCase.id,
                                testUser.id,
                                materials
                            )

                            const savedMaterials = await findByCaseIdDAO(propertyTestCase.id)

                            // 验证类型一致
                            for (let i = 0; i < materials.length; i++) {
                                expect(savedMaterials[i].type).toBe(materials[i].type)
                            }

                            testIds.materialIds.push(...savedMaterials.map(m => m.id))

                            return true
                        }
                    ),
                    { numRuns: 20 }
                )
            })
        })
    })
})
