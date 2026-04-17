/**
 * 系统配置 DAO 真实 DB 补充覆盖测试
 *
 * 针对 server/services/system/systemConfig.dao.ts 中
 * 现有 system.test.ts 未覆盖的分支与 catch 路径进行补齐，目标覆盖率 ≥ 90%。
 *
 * 覆盖内容：
 * - includeDisabled=true 分支（getConfigsByGroupAndKeyDao、getConfigsByKeyDao、getConfigsByGroupDao）
 * - getConfigsByPageDao 各分支（含 group=null、catch 返回空结果）
 * - getAllConfigGroupsDao 正常路径与错误路径
 * - 各函数的 catch 分支：通过 fault injection 临时替换 globalThis.prisma
 *   为会抛错的对象触发 catch；注意此替换仅用于错误路径覆盖，
 *   并在每个 it 结束后立即恢复真实 prisma，不影响其它测试。
 *
 * **Feature: system-config-dao-coverage**
 * **Target: server/services/system/systemConfig.dao.ts (>=90%)**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    testPrisma,
    connectTestDb,
    disconnectTestDb,
} from '../membership/test-db-helper'
import { mockLogger } from '../membership/test-setup'
import { SystemConfigStatus } from '../../../shared/types/system'

// DAO 内部引用了全局 SystemConfigStatus / prisma / logger（Nuxt 自动导入）
;(globalThis as any).SystemConfigStatus = SystemConfigStatus
if (typeof window === 'undefined' && process.env.NODE_ENV === 'test') {
    ;(globalThis as any).prisma = testPrisma
    ;(globalThis as any).logger = mockLogger
}

import {
    getConfigsByGroupAndKeyDao,
    getConfigsByKeyDao,
    getConfigsByPageDao,
    getAllConfigGroupsDao,
    getConfigsByGroupDao,
    getConfigByIdDao,
} from '../../../server/services/system/systemConfig.dao'

// ==================== 测试数据追踪 ====================

// configGroup 字段为 VarChar(50)，前缀保持尽量短
const TEST_GROUP_PREFIX = 'TGR_'
const createdConfigIds: number[] = []

/** 生成较短的唯一后缀，保证 prefix+suffix 后 configGroup 不超过 50 字符 */
const uniqueSuffix = () => {
    // 6 位时间戳末尾 + 6 位 uuid 前缀 = 12 字符，稳定唯一
    const ts = String(Date.now()).slice(-6)
    const uuid = crypto.randomUUID().replace(/-/g, '').slice(0, 6)
    return `${ts}${uuid}`
}

/**
 * 故障注入：临时把 globalThis.prisma 换为会抛错的 proxy，
 * 回调结束后恢复原值。仅用于覆盖 DAO 的 catch 分支。
 */
const withFaultyPrisma = async <T>(fn: () => Promise<T>): Promise<T> => {
    const original = (globalThis as any).prisma
    const faulty = new Proxy(
        {},
        {
            get() {
                return new Proxy(
                    {},
                    {
                        get() {
                            return () => {
                                throw new Error('injected-fault: prisma unavailable')
                            }
                        },
                    }
                )
            },
        }
    )
    ;(globalThis as any).prisma = faulty
    try {
        return await fn()
    } finally {
        ;(globalThis as any).prisma = original
    }
}

describe('系统配置 DAO 真实 DB 补充覆盖', () => {
    beforeAll(async () => {
        await connectTestDb()
    })

    afterAll(async () => {
        if (createdConfigIds.length > 0) {
            await testPrisma.systemConfigs.deleteMany({
                where: { id: { in: createdConfigIds } },
            })
            createdConfigIds.length = 0
        }
        // 兜底：清理本轮残留（按前缀）
        await testPrisma.systemConfigs.deleteMany({
            where: { configGroup: { startsWith: TEST_GROUP_PREFIX } },
        })
        await disconnectTestDb()
    })

    afterEach(async () => {
        // 每个用例结束后按前缀兜底清理，确保跨用例数据不影响
        await testPrisma.systemConfigs.deleteMany({
            where: { configGroup: { startsWith: TEST_GROUP_PREFIX } },
        })
        createdConfigIds.length = 0
    })

    // ========================================================================
    // getConfigsByGroupAndKeyDao
    // ========================================================================
    describe('getConfigsByGroupAndKeyDao includeDisabled 分支', () => {
        it('includeDisabled=true 时应能查到禁用状态的配置', async () => {
            const suffix = uniqueSuffix()
            const group = `${TEST_GROUP_PREFIX}GK_${suffix}`
            const key = `key_${suffix}`

            const config = await testPrisma.systemConfigs.create({
                data: {
                    configGroup: group,
                    key,
                    value: { x: 1 },
                    status: SystemConfigStatus.DISABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdConfigIds.push(config.id)

            // includeDisabled=true：应能查到
            const found = await getConfigsByGroupAndKeyDao(group, key, true)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(config.id)
            expect(found!.status).toBe(SystemConfigStatus.DISABLED)
        })
    })

    describe('getConfigsByGroupAndKeyDao catch 分支', () => {
        it('prisma 抛错时应 throw 并走 catch 分支', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    getConfigsByGroupAndKeyDao('any', 'any')
                ).rejects.toThrow(/injected-fault/)
            })
        })

        it('catch 分支中 error 非 Error 实例时应按 String(error) 记录', async () => {
            // 通过 Proxy 抛出字符串（非 Error 实例）验证 error.message ?? String(error) 的分支
            const original = (globalThis as any).prisma
            ;(globalThis as any).prisma = new Proxy(
                {},
                {
                    get() {
                        return new Proxy(
                            {},
                            {
                                get() {
                                    return () => {
                                        // eslint-disable-next-line no-throw-literal
                                        throw 'plain-string-error'
                                    }
                                },
                            }
                        )
                    },
                }
            )
            try {
                await expect(
                    getConfigsByGroupAndKeyDao('any', 'any')
                ).rejects.toBeDefined()
            } finally {
                ;(globalThis as any).prisma = original
            }
        })
    })

    // ========================================================================
    // getConfigsByKeyDao
    // ========================================================================
    describe('getConfigsByKeyDao includeDisabled 分支', () => {
        it('includeDisabled=true 时应同时返回启用和禁用状态的配置', async () => {
            const suffix = uniqueSuffix()
            const key = `shared_key_${suffix}`

            const enabled = await testPrisma.systemConfigs.create({
                data: {
                    configGroup: `${TEST_GROUP_PREFIX}K_A_${suffix}`,
                    key,
                    value: { on: true },
                    status: SystemConfigStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            const disabled = await testPrisma.systemConfigs.create({
                data: {
                    configGroup: `${TEST_GROUP_PREFIX}K_B_${suffix}`,
                    key,
                    value: { on: false },
                    status: SystemConfigStatus.DISABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdConfigIds.push(enabled.id, disabled.id)

            const onlyEnabled = await getConfigsByKeyDao(key)
            expect(onlyEnabled.length).toBe(1)
            expect(onlyEnabled[0]!.status).toBe(SystemConfigStatus.ENABLED)

            const all = await getConfigsByKeyDao(key, true)
            const ids = all.map(c => c.id)
            expect(ids).toEqual(expect.arrayContaining([enabled.id, disabled.id]))
        })
    })

    describe('getConfigsByKeyDao catch 分支', () => {
        it('prisma 抛错时应 throw', async () => {
            await withFaultyPrisma(async () => {
                await expect(getConfigsByKeyDao('any')).rejects.toThrow()
            })
        })
    })

    // ========================================================================
    // getConfigsByPageDao
    // ========================================================================
    describe('getConfigsByPageDao 默认参数与边界', () => {
        it('不传任何参数应使用默认 page=1 pageSize=10', async () => {
            // 准备一条数据以确保 total > 0
            const suffix = uniqueSuffix()
            const group = `${TEST_GROUP_PREFIX}DEFAULT_${suffix}`
            const c = await testPrisma.systemConfigs.create({
                data: {
                    configGroup: group,
                    key: `k_${suffix}`,
                    value: { d: 1 },
                    status: SystemConfigStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdConfigIds.push(c.id)

            const result = await getConfigsByPageDao()
            expect(result.page).toBe(1)
            expect(result.pageSize).toBe(10)
            expect(result.total).toBeGreaterThanOrEqual(1)
            expect(result.configs.length).toBeLessThanOrEqual(10)
        })

        it('group 指定存在时应按 configGroup 精确筛选', async () => {
            const suffix = uniqueSuffix()
            const group = `${TEST_GROUP_PREFIX}PAGE_GRP_${suffix}`
            for (let i = 0; i < 3; i++) {
                const c = await testPrisma.systemConfigs.create({
                    data: {
                        configGroup: group,
                        key: `k_${suffix}_${i}`,
                        value: { i },
                        status: SystemConfigStatus.ENABLED,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdConfigIds.push(c.id)
            }
            const result = await getConfigsByPageDao(group, 1, 2)
            expect(result.total).toBe(3)
            expect(result.configs.length).toBeLessThanOrEqual(2)
            expect(result.configs.every(c => c.configGroup === group)).toBe(true)
        })
    })

    describe('getConfigsByPageDao catch 分支', () => {
        it('prisma 抛错时应返回空结果（而非抛出）', async () => {
            await withFaultyPrisma(async () => {
                const result = await getConfigsByPageDao(null, 1, 5)
                expect(result.configs).toEqual([])
                expect(result.total).toBe(0)
                expect(result.page).toBe(1)
                expect(result.pageSize).toBe(5)
            })
        })
    })

    // ========================================================================
    // getAllConfigGroupsDao
    // ========================================================================
    describe('getAllConfigGroupsDao 正常与 catch 分支', () => {
        it('应按 configGroup 升序返回去重列表', async () => {
            const suffix = uniqueSuffix()
            const gA = `${TEST_GROUP_PREFIX}AAA_${suffix}`
            const gB = `${TEST_GROUP_PREFIX}BBB_${suffix}`
            const c1 = await testPrisma.systemConfigs.create({
                data: {
                    configGroup: gA,
                    key: `k1_${suffix}`,
                    value: {},
                    status: SystemConfigStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            // 同组内第二条，验证 distinct 去重
            const c2 = await testPrisma.systemConfigs.create({
                data: {
                    configGroup: gA,
                    key: `k2_${suffix}`,
                    value: {},
                    status: SystemConfigStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            const c3 = await testPrisma.systemConfigs.create({
                data: {
                    configGroup: gB,
                    key: `k3_${suffix}`,
                    value: {},
                    status: SystemConfigStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdConfigIds.push(c1.id, c2.id, c3.id)

            const groups = await getAllConfigGroupsDao()
            // 本组两条属于 gA，应被去重
            const occurA = groups.filter(g => g === gA).length
            const occurB = groups.filter(g => g === gB).length
            expect(occurA).toBe(1)
            expect(occurB).toBe(1)
        })

        it('prisma 抛错时应 throw', async () => {
            await withFaultyPrisma(async () => {
                await expect(getAllConfigGroupsDao()).rejects.toThrow()
            })
        })
    })

    // ========================================================================
    // getConfigsByGroupDao
    // ========================================================================
    describe('getConfigsByGroupDao includeDisabled 与 catch 分支', () => {
        it('includeDisabled=false（默认）应过滤禁用项', async () => {
            const suffix = uniqueSuffix()
            const group = `${TEST_GROUP_PREFIX}GONLY_${suffix}`
            const enabled = await testPrisma.systemConfigs.create({
                data: {
                    configGroup: group,
                    key: `e_${suffix}`,
                    value: {},
                    status: SystemConfigStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            const disabled = await testPrisma.systemConfigs.create({
                data: {
                    configGroup: group,
                    key: `d_${suffix}`,
                    value: {},
                    status: SystemConfigStatus.DISABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdConfigIds.push(enabled.id, disabled.id)

            const onlyEnabled = await getConfigsByGroupDao(group)
            expect(onlyEnabled.length).toBe(1)
            expect(onlyEnabled[0]!.id).toBe(enabled.id)
        })

        it('includeDisabled=true 时应返回组内所有配置', async () => {
            const suffix = uniqueSuffix()
            const group = `${TEST_GROUP_PREFIX}GALL_${suffix}`
            const c1 = await testPrisma.systemConfigs.create({
                data: {
                    configGroup: group,
                    key: `a_${suffix}`,
                    value: {},
                    status: SystemConfigStatus.ENABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            const c2 = await testPrisma.systemConfigs.create({
                data: {
                    configGroup: group,
                    key: `b_${suffix}`,
                    value: {},
                    status: SystemConfigStatus.DISABLED,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdConfigIds.push(c1.id, c2.id)

            const all = await getConfigsByGroupDao(group, true)
            expect(all.length).toBe(2)
        })

        it('prisma 抛错时应 throw', async () => {
            await withFaultyPrisma(async () => {
                await expect(getConfigsByGroupDao('any')).rejects.toThrow()
            })
        })
    })

    // ========================================================================
    // getConfigByIdDao
    // ========================================================================
    describe('getConfigByIdDao catch 分支', () => {
        it('prisma 抛错时应 throw', async () => {
            await withFaultyPrisma(async () => {
                await expect(getConfigByIdDao(1)).rejects.toThrow()
            })
        })
    })
})
