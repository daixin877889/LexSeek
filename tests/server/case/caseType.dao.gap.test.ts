/**
 * 案件类型 DAO 层 catch 分支覆盖测试
 *
 * 补充 caseType.dao.ts 中各函数 catch 分支（Proxy 故障注入）。
 * 以及少量未覆盖的正常路径（findManyCaseTypesDao keyword + status 组合筛选）。
 *
 * **Feature: server-test-coverage**
 * **Validates: caseType.dao.ts catch 分支完整覆盖**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import './test-setup'
import {
    createTestCaseType,
    createTestUser,
    createTestCase,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    type CaseTestIds,
} from './test-db-helper'
import {
    createCaseTypeDao,
    findCaseTypeByIdDao,
    findCaseTypeByNameDao,
    findManyCaseTypesDao,
    findEnabledCaseTypesDao,
    updateCaseTypeDao,
    softDeleteCaseTypeDao,
    checkCaseTypeInUseDao,
    CaseTypeStatus,
} from '../../../server/services/case/caseType.dao'

/** 故障注入：使 globalThis.prisma 在访问任意属性时抛错 */
const withFaultyPrisma = async (fn: () => Promise<void>) => {
    const original = (globalThis as any).prisma
    ; (globalThis as any).prisma = new Proxy({}, {
        get: () => {
            throw new Error('injected-fault')
        },
    })
    try {
        await fn()
    } finally {
        ; (globalThis as any).prisma = original
    }
}

describe('案件类型 DAO - catch 分支与边界覆盖', () => {
    let testIds: CaseTestIds

    beforeAll(async () => {
        testIds = createEmptyTestIds()
    })

    afterEach(async () => {
        // 清理 case + caseType（caseType 依赖 case 先清）
        if (testIds.caseIds.length > 0 || testIds.caseTypeIds.length > 0 || testIds.userIds.length > 0) {
            await cleanupTestData({
                ...createEmptyTestIds(),
                caseIds: [...testIds.caseIds],
                caseTypeIds: [...testIds.caseTypeIds],
                userIds: [...testIds.userIds],
            })
            testIds.caseIds = []
            testIds.caseTypeIds = []
            testIds.userIds = []
        }
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    describe('findManyCaseTypesDao - keyword 与 status 组合', () => {
        it('应支持 keyword 搜索 name/description', async () => {
            const unique = `kw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            const ct = await createCaseTypeDao({
                name: `含${unique}的类型`,
                description: '测试描述',
                status: CaseTypeStatus.ENABLED,
            })
            testIds.caseTypeIds.push(ct.id)
            const result = await findManyCaseTypesDao({ keyword: unique })
            expect(result.list.some(x => x.id === ct.id)).toBe(true)
        })

        it('应支持 status 筛选', async () => {
            const ct = await createCaseTypeDao({
                name: `状态筛选_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                status: CaseTypeStatus.DISABLED,
            })
            testIds.caseTypeIds.push(ct.id)
            const result = await findManyCaseTypesDao({ status: CaseTypeStatus.DISABLED, pageSize: 1000 })
            for (const x of result.list) expect(x.status).toBe(CaseTypeStatus.DISABLED)
        })
    })

    describe('catch 分支 - prisma 抛错应透传', () => {
        it('createCaseTypeDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(createCaseTypeDao({ name: 'fail' })).rejects.toThrow('injected-fault')
            })
        })

        it('findCaseTypeByIdDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(findCaseTypeByIdDao(1)).rejects.toThrow('injected-fault')
            })
        })

        it('findCaseTypeByNameDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(findCaseTypeByNameDao('x')).rejects.toThrow('injected-fault')
            })
        })

        it('findManyCaseTypesDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(findManyCaseTypesDao({})).rejects.toThrow('injected-fault')
            })
        })

        it('findEnabledCaseTypesDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(findEnabledCaseTypesDao()).rejects.toThrow('injected-fault')
            })
        })

        it('updateCaseTypeDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(updateCaseTypeDao(1, { name: 'x' })).rejects.toThrow('injected-fault')
            })
        })

        it('softDeleteCaseTypeDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(softDeleteCaseTypeDao(1)).rejects.toThrow('injected-fault')
            })
        })

        it('checkCaseTypeInUseDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(checkCaseTypeInUseDao(1)).rejects.toThrow('injected-fault')
            })
        })
    })

    describe('checkCaseTypeInUseDao - 真实路径', () => {
        it('有案件使用该类型时应返回 true', async () => {
            const ct = await createTestCaseType({ status: 1 })
            testIds.caseTypeIds.push(ct.id)
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const c = await createTestCase({ userId: user.id, caseTypeId: ct.id })
            testIds.caseIds.push(c.id)

            expect(await checkCaseTypeInUseDao(ct.id)).toBe(true)
        })

        it('无关联案件时应返回 false', async () => {
            const ct = await createTestCaseType({ status: 1 })
            testIds.caseTypeIds.push(ct.id)
            expect(await checkCaseTypeInUseDao(ct.id)).toBe(false)
        })
    })
})
