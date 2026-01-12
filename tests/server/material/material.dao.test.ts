/**
 * 材料 DAO 层测试
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**
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
    createMaterialDao,
    findMaterialByIdDao,
    findManyMaterialsDao,
    findMaterialsByCaseIdDao,
    updateMaterialDao,
    deleteMaterialDao,
} from '../../../server/services/material/material.dao'
import { MaterialStatus, MaterialType } from '../../../shared/types/material'

describe('材料 DAO 层', () => {
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


    describe('createMaterialDao - 创建材料', () => {
        it('应该成功创建材料', async () => {
            const material = await createMaterialDao({
                caseId: testCase.id,
                name: '测试材料_创建测试',
                type: MaterialType.TEXT,
                content: '测试内容',
            })
            testIds.materialIds.push(material.id)

            expect(material).toBeDefined()
            expect(material.id).toBeGreaterThan(0)
            expect(material.caseId).toBe(testCase.id)
            expect(material.name).toBe('测试材料_创建测试')
            expect(material.type).toBe(MaterialType.TEXT)
            expect(material.status).toBe(MaterialStatus.PENDING)
        })

        it('应该支持创建带 OSS 文件关联的材料', async () => {
            const ossFile = await createTestOssFile({ userId: testUser.id }, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const material = await createMaterialDao({
                caseId: testCase.id,
                name: '测试材料_OSS关联',
                type: MaterialType.DOCUMENT,
                ossFileId: ossFile.id,
            })
            testIds.materialIds.push(material.id)

            expect(material.ossFileId).toBe(ossFile.id)
        })

        it('应该支持创建加密材料', async () => {
            const material = await createMaterialDao({
                caseId: testCase.id,
                name: '测试材料_加密',
                type: MaterialType.TEXT,
                content: '加密内容',
                isEncrypted: true,
            })
            testIds.materialIds.push(material.id)

            expect(material.isEncrypted).toBe(true)
        })
    })

    describe('findMaterialByIdDao - 通过 ID 查询材料', () => {
        it('应该返回存在的材料', async () => {
            const material = await createTestMaterial({ caseId: testCase.id })
            testIds.materialIds.push(material.id)

            const found = await findMaterialByIdDao(material.id)

            expect(found).toBeDefined()
            expect(found?.id).toBe(material.id)
        })

        it('应该返回 null 当材料不存在', async () => {
            const found = await findMaterialByIdDao(999999)
            expect(found).toBeNull()
        })

        it('应该返回 null 当材料已删除', async () => {
            const material = await createTestMaterial({ caseId: testCase.id })
            testIds.materialIds.push(material.id)

            await deleteMaterialDao(material.id)

            const found = await findMaterialByIdDao(material.id)
            expect(found).toBeNull()
        })
    })

    describe('findManyMaterialsDao - 查询材料列表', () => {
        it('应该返回分页的材料列表', async () => {
            for (let i = 0; i < 3; i++) {
                const m = await createTestMaterial({
                    caseId: testCase.id,
                    name: `测试材料_列表测试_${i}`,
                })
                testIds.materialIds.push(m.id)
            }

            const result = await findManyMaterialsDao({
                caseId: testCase.id,
                page: 1,
                pageSize: 10,
            })

            expect(result.list).toBeDefined()
            expect(result.total).toBeGreaterThanOrEqual(3)
        })

        it('应该支持按案件 ID 筛选', async () => {
            const anotherCase = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(anotherCase.id)

            const m1 = await createTestMaterial({ caseId: testCase.id })
            testIds.materialIds.push(m1.id)

            const m2 = await createTestMaterial({ caseId: anotherCase.id })
            testIds.materialIds.push(m2.id)

            const result = await findManyMaterialsDao({ caseId: testCase.id })

            expect(result.list.every(m => m.caseId === testCase.id)).toBe(true)
        })

        it('应该支持按类型筛选', async () => {
            const textMaterial = await createTestMaterial({
                caseId: testCase.id,
                type: MaterialType.TEXT,
            })
            testIds.materialIds.push(textMaterial.id)

            const docMaterial = await createTestMaterial({
                caseId: testCase.id,
                type: MaterialType.DOCUMENT,
            })
            testIds.materialIds.push(docMaterial.id)

            const result = await findManyMaterialsDao({
                caseId: testCase.id,
                type: MaterialType.TEXT,
            })

            expect(result.list.every(m => m.type === MaterialType.TEXT)).toBe(true)
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

            const result = await findManyMaterialsDao({
                caseId: testCase.id,
                status: MaterialStatus.COMPLETED,
            })

            expect(result.list.every(m => m.status === MaterialStatus.COMPLETED)).toBe(true)
        })
    })

    describe('findMaterialsByCaseIdDao - 通过案件 ID 查询材料', () => {
        it('应该返回案件的所有材料', async () => {
            for (let i = 0; i < 3; i++) {
                const m = await createTestMaterial({
                    caseId: testCase.id,
                    name: `测试材料_案件查询_${i}`,
                })
                testIds.materialIds.push(m.id)
            }

            const materials = await findMaterialsByCaseIdDao(testCase.id)

            expect(materials.length).toBeGreaterThanOrEqual(3)
            expect(materials.every(m => m.caseId === testCase.id)).toBe(true)
        })

        it('应该自动过滤已删除的材料', async () => {
            const m = await createTestMaterial({ caseId: testCase.id })
            testIds.materialIds.push(m.id)

            await deleteMaterialDao(m.id)

            const materials = await findMaterialsByCaseIdDao(testCase.id)

            expect(materials.every(item => item.id !== m.id)).toBe(true)
        })
    })

    describe('updateMaterialDao - 更新材料', () => {
        it('应该成功更新材料名称', async () => {
            const material = await createTestMaterial({ caseId: testCase.id })
            testIds.materialIds.push(material.id)

            const newName = '测试材料_更新后名称'
            const updated = await updateMaterialDao(material.id, { name: newName })

            expect(updated.name).toBe(newName)
        })

        it('应该成功更新材料状态', async () => {
            const material = await createTestMaterial({
                caseId: testCase.id,
                status: MaterialStatus.PENDING,
            })
            testIds.materialIds.push(material.id)

            const updated = await updateMaterialDao(material.id, {
                status: MaterialStatus.COMPLETED,
            })

            expect(updated.status).toBe(MaterialStatus.COMPLETED)
        })

        it('应该成功更新材料内容', async () => {
            const material = await createTestMaterial({ caseId: testCase.id })
            testIds.materialIds.push(material.id)

            const newContent = '更新后的内容'
            const updated = await updateMaterialDao(material.id, { content: newContent })

            expect(updated.content).toBe(newContent)
        })
    })

    describe('deleteMaterialDao - 软删除材料', () => {
        it('应该成功软删除材料', async () => {
            const material = await createTestMaterial({ caseId: testCase.id })
            testIds.materialIds.push(material.id)

            await deleteMaterialDao(material.id)

            const found = await findMaterialByIdDao(material.id)
            expect(found).toBeNull()
        })
    })

    // ==================== 属性测试 ====================

    describe('属性测试', () => {
        describe('Property 5: 材料创建-查询往返一致性', () => {
            it('创建材料后通过 ID 查询应返回等价的材料数据', async () => {
                await fc.assert(
                    fc.asyncProperty(materialDataArbitrary, async (data) => {
                        const material = await createMaterialDao({
                            caseId: testCase.id,
                            name: data.name,
                            type: data.type,
                            content: data.content,
                            isEncrypted: data.isEncrypted,
                            status: data.status,
                        })
                        testIds.materialIds.push(material.id)

                        const found = await findMaterialByIdDao(material.id)

                        expect(found).not.toBeNull()
                        expect(found?.name).toBe(data.name)
                        expect(found?.type).toBe(data.type)
                        expect(found?.content).toBe(data.content)
                        expect(found?.isEncrypted).toBe(data.isEncrypted)
                        expect(found?.status).toBe(data.status)

                        return true
                    }),
                    PBT_CONFIG
                )
            })
        })

        describe('Property 7: 材料软删除过滤正确性', () => {
            it('软删除后所有查询操作应自动过滤该记录', async () => {
                await fc.assert(
                    fc.asyncProperty(materialDataArbitrary, async (data) => {
                        const material = await createMaterialDao({
                            caseId: testCase.id,
                            name: data.name,
                            type: data.type,
                        })
                        testIds.materialIds.push(material.id)

                        await deleteMaterialDao(material.id)

                        // 验证各种查询都不返回该记录
                        const byId = await findMaterialByIdDao(material.id)
                        expect(byId).toBeNull()

                        const byCaseId = await findMaterialsByCaseIdDao(testCase.id)
                        expect(byCaseId.every(m => m.id !== material.id)).toBe(true)

                        const list = await findManyMaterialsDao({ caseId: testCase.id })
                        expect(list.list.every(m => m.id !== material.id)).toBe(true)

                        return true
                    }),
                    PBT_CONFIG
                )
            })
        })
    })
})
