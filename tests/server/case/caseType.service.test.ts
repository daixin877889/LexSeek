/**
 * 案件类型服务层测试
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import './test-setup'
import {
    createTestUser,
    createTestCaseType,
    createTestCase,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    type CaseTestIds,
} from './test-db-helper'
import { PBT_CONFIG, caseTypeDataArbitrary } from './test-generators'
import {
    createCaseTypeService,
    getCaseTypeByIdService,
    getCaseTypesService,
    getEnabledCaseTypesService,
    updateCaseTypeService,
    updateCaseTypeStatusService,
    deleteCaseTypeService,
} from '../../../server/services/case/caseType.service'

describe('案件类型服务层', () => {
    let testIds: CaseTestIds
    let testUser: Awaited<ReturnType<typeof createTestUser>>

    beforeAll(async () => {
        testIds = createEmptyTestIds()
        testUser = await createTestUser()
        testIds.userIds.push(testUser.id)
    })

    afterEach(async () => {
        // 清理案件（需要先删除案件才能删除案件类型）
        if (testIds.caseIds.length > 0) {
            await cleanupTestData({
                ...createEmptyTestIds(),
                caseIds: [...testIds.caseIds],
            })
            testIds.caseIds = []
        }
        // 清理案件类型
        if (testIds.caseTypeIds.length > 0) {
            await cleanupTestData({
                ...createEmptyTestIds(),
                caseTypeIds: [...testIds.caseTypeIds],
            })
            testIds.caseTypeIds = []
        }
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })


    describe('createCaseTypeService - 创建案件类型', () => {
        it('应该成功创建案件类型', async () => {
            const caseType = await createCaseTypeService({
                name: `测试类型_创建测试_${Date.now()}`,
                description: '测试描述',
            })
            testIds.caseTypeIds.push(caseType.id)

            expect(caseType).toBeDefined()
            expect(caseType.id).toBeGreaterThan(0)
            expect(caseType.status).toBe(1)
        })

        it('应该在名称已存在时抛出错误', async () => {
            const name = `测试类型_重复名称_${Date.now()}`
            const caseType = await createCaseTypeService({ name })
            testIds.caseTypeIds.push(caseType.id)

            await expect(
                createCaseTypeService({ name })
            ).rejects.toThrow('案件类型名称已存在')
        })
    })

    describe('getCaseTypeByIdService - 获取案件类型详情', () => {
        it('应该返回存在的案件类型', async () => {
            const caseType = await createCaseTypeService({
                name: `测试类型_获取详情_${Date.now()}`,
            })
            testIds.caseTypeIds.push(caseType.id)

            const found = await getCaseTypeByIdService(caseType.id)

            expect(found).toBeDefined()
            expect(found?.id).toBe(caseType.id)
        })

        it('应该返回 null 当案件类型不存在', async () => {
            const found = await getCaseTypeByIdService(999999)
            expect(found).toBeNull()
        })
    })

    describe('getCaseTypesService - 获取案件类型列表', () => {
        it('应该返回分页的案件类型列表', async () => {
            for (let i = 0; i < 3; i++) {
                const ct = await createCaseTypeService({
                    name: `测试类型_列表测试_${Date.now()}_${i}`,
                })
                testIds.caseTypeIds.push(ct.id)
            }

            const result = await getCaseTypesService({ page: 1, pageSize: 10 })

            expect(result.list).toBeDefined()
            expect(result.total).toBeGreaterThanOrEqual(3)
        })

        it('应该支持按状态筛选', async () => {
            const enabledType = await createCaseTypeService({
                name: `测试类型_启用_${Date.now()}`,
                status: 1,
            })
            testIds.caseTypeIds.push(enabledType.id)

            const disabledType = await createCaseTypeService({
                name: `测试类型_禁用_${Date.now()}`,
                status: 0,
            })
            testIds.caseTypeIds.push(disabledType.id)

            const result = await getCaseTypesService({ status: 1 })

            expect(result.list.every(ct => ct.status === 1)).toBe(true)
        })

        it('应该支持关键词搜索', async () => {
            const uniqueKeyword = `唯一关键词_${Date.now()}`
            const caseType = await createCaseTypeService({
                name: `测试类型_${uniqueKeyword}`,
            })
            testIds.caseTypeIds.push(caseType.id)

            const result = await getCaseTypesService({ keyword: uniqueKeyword })

            expect(result.list.length).toBeGreaterThanOrEqual(1)
            expect(result.list.some(ct => ct.name.includes(uniqueKeyword))).toBe(true)
        })
    })

    describe('getEnabledCaseTypesService - 获取启用的案件类型', () => {
        it('应该只返回启用状态的案件类型', async () => {
            const enabledType = await createCaseTypeService({
                name: `测试类型_启用查询_${Date.now()}`,
                status: 1,
            })
            testIds.caseTypeIds.push(enabledType.id)

            const disabledType = await createCaseTypeService({
                name: `测试类型_禁用查询_${Date.now()}`,
                status: 0,
            })
            testIds.caseTypeIds.push(disabledType.id)

            const result = await getEnabledCaseTypesService()

            expect(result.every(ct => ct.status === 1)).toBe(true)
            expect(result.some(ct => ct.id === enabledType.id)).toBe(true)
            expect(result.every(ct => ct.id !== disabledType.id)).toBe(true)
        })
    })

    describe('updateCaseTypeService - 更新案件类型', () => {
        it('应该成功更新案件类型', async () => {
            const caseType = await createCaseTypeService({
                name: `测试类型_更新前_${Date.now()}`,
            })
            testIds.caseTypeIds.push(caseType.id)

            const newName = `测试类型_更新后_${Date.now()}`
            const updated = await updateCaseTypeService(caseType.id, { name: newName })

            expect(updated.name).toBe(newName)
        })

        it('应该在案件类型不存在时抛出错误', async () => {
            await expect(
                updateCaseTypeService(999999, { name: '测试' })
            ).rejects.toThrow('案件类型不存在')
        })

        it('应该在更新为已存在的名称时抛出错误', async () => {
            const name1 = `测试类型_名称1_${Date.now()}`
            const name2 = `测试类型_名称2_${Date.now()}`

            const ct1 = await createCaseTypeService({ name: name1 })
            testIds.caseTypeIds.push(ct1.id)

            const ct2 = await createCaseTypeService({ name: name2 })
            testIds.caseTypeIds.push(ct2.id)

            await expect(
                updateCaseTypeService(ct2.id, { name: name1 })
            ).rejects.toThrow('案件类型名称已存在')
        })
    })

    describe('updateCaseTypeStatusService - 更新案件类型状态', () => {
        it('应该成功更新状态', async () => {
            const caseType = await createCaseTypeService({
                name: `测试类型_状态更新_${Date.now()}`,
                status: 1,
            })
            testIds.caseTypeIds.push(caseType.id)

            const updated = await updateCaseTypeStatusService(caseType.id, 0)

            expect(updated.status).toBe(0)
        })
    })

    describe('deleteCaseTypeService - 删除案件类型', () => {
        it('应该成功软删除未使用的案件类型', async () => {
            const caseType = await createCaseTypeService({
                name: `测试类型_删除测试_${Date.now()}`,
            })
            testIds.caseTypeIds.push(caseType.id)

            await deleteCaseTypeService(caseType.id)

            const found = await getCaseTypeByIdService(caseType.id)
            expect(found).toBeNull()
        })

        it('应该在案件类型不存在时抛出错误', async () => {
            await expect(deleteCaseTypeService(999999)).rejects.toThrow('案件类型不存在')
        })

        it('应该在案件类型被使用时抛出错误', async () => {
            const caseType = await createCaseTypeService({
                name: `测试类型_被使用_${Date.now()}`,
                status: 1,
            })
            testIds.caseTypeIds.push(caseType.id)

            // 创建使用该类型的案件
            const caseRecord = await createTestCase({
                userId: testUser.id,
                caseTypeId: caseType.id,
            })
            testIds.caseIds.push(caseRecord.id)

            await expect(
                deleteCaseTypeService(caseType.id)
            ).rejects.toThrow('该案件类型正在被使用，无法删除')
        })
    })

    // ==================== 属性测试 ====================

    describe('属性测试', () => {
        describe('Property 11: 案件类型名称唯一性', () => {
            it('如果名称已存在应抛出错误，否则应成功创建', async () => {
                await fc.assert(
                    fc.asyncProperty(caseTypeDataArbitrary, async (data) => {
                        const uniqueName = `${data.name}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`

                        // 第一次创建应该成功
                        const first = await createCaseTypeService({
                            name: uniqueName,
                            description: data.description,
                        })
                        testIds.caseTypeIds.push(first.id)

                        expect(first.name).toBe(uniqueName)

                        // 第二次创建相同名称应该失败
                        await expect(
                            createCaseTypeService({ name: uniqueName })
                        ).rejects.toThrow('案件类型名称已存在')

                        return true
                    }),
                    PBT_CONFIG
                )
            })
        })
    })
})
