/**
 * 系统配置模块测试
 *
 * 测试系统配置 DAO 功能
 *
 * **Feature: system-module**
 * **Validates: Requirements 4.1, 4.2, 4.3**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    testPrisma,
    connectTestDb,
    disconnectTestDb,
} from '../membership/test-db-helper'

// 导入实际的业务函数
import {
    getConfigsByGroupAndKeyDao,
    getConfigsByKeyDao,
    getConfigsByPageDao,
    getAllConfigGroupsDao,
    getConfigsByGroupDao,
    getConfigByIdDao,
} from '../../../server/services/system/systemConfig.dao'

// 系统配置状态常量
const SystemConfigStatus = {
    DISABLED: 0,
    ENABLED: 1,
} as const

// 测试配置组前缀
const TEST_CONFIG_GROUP_PREFIX = 'TEST_GROUP_'

// 测试数据追踪
const createdConfigIds: number[] = []

// 生成唯一的配置组和键，避免与已有数据冲突
const generateUniqueGroupKey = () => {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 1000000)
    const uuid = crypto.randomUUID().replace(/-/g, '').substring(0, 8)
    return {
        configGroup: `${TEST_CONFIG_GROUP_PREFIX}${timestamp}_${random}_${uuid}`,
        key: `test_key_${timestamp}_${random}_${uuid}`,
    }
}

describe('系统配置模块测试', () => {
    beforeAll(async () => {
        await connectTestDb()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    beforeEach(() => {
        // 清空追踪数组
        createdConfigIds.length = 0
    })

    afterEach(async () => {
        // 清理测试数据
        if (createdConfigIds.length > 0) {
            await testPrisma.systemConfigs.deleteMany({
                where: { id: { in: createdConfigIds } },
            })
        }

        // 清理所有测试配置组
        await testPrisma.systemConfigs.deleteMany({
            where: { configGroup: { startsWith: TEST_CONFIG_GROUP_PREFIX } },
        })
    })

    describe('系统配置 DAO 测试', () => {
        describe('getConfigsByGroupAndKeyDao - 通过组和键查询配置', () => {
            it('应能通过组和键查询到配置', async () => {
                const { configGroup, key } = generateUniqueGroupKey()

                // 创建测试配置
                const config = await testPrisma.systemConfigs.create({
                    data: {
                        configGroup,
                        key,
                        value: { test: 'value' }, // JSON 类型
                        description: '测试配置',
                        status: SystemConfigStatus.ENABLED,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdConfigIds.push(config.id)

                // 查询
                const found = await getConfigsByGroupAndKeyDao(configGroup, key)

                expect(found).not.toBeNull()
                expect(found?.configGroup).toBe(configGroup)
                expect(found?.key).toBe(key)
            })

            it('查询不存在的配置应返回 null', async () => {
                const found = await getConfigsByGroupAndKeyDao('NON_EXISTENT_GROUP', 'non_existent_key')
                expect(found).toBeNull()
            })

            it('默认不应返回禁用状态的配置', async () => {
                const { configGroup, key } = generateUniqueGroupKey()

                // 创建禁用状态的配置
                const config = await testPrisma.systemConfigs.create({
                    data: {
                        configGroup,
                        key,
                        value: { disabled: true },
                        description: '禁用配置',
                        status: SystemConfigStatus.DISABLED,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdConfigIds.push(config.id)

                // 默认查询不应返回
                const found = await getConfigsByGroupAndKeyDao(configGroup, key)
                expect(found).toBeNull()

                // 包含禁用配置时应返回
                const foundWithDisabled = await getConfigsByGroupAndKeyDao(configGroup, key, true)
                expect(foundWithDisabled).not.toBeNull()
            })
        })

        describe('getConfigsByKeyDao - 通过键查询所有配置', () => {
            it('应能通过键查询到所有匹配的配置', async () => {
                const timestamp = Date.now()
                const random = Math.floor(Math.random() * 1000000)
                const sharedKey = `shared_key_${timestamp}_${random}`

                // 创建多个组的同名配置
                const config1 = await testPrisma.systemConfigs.create({
                    data: {
                        configGroup: `${TEST_CONFIG_GROUP_PREFIX}A_${timestamp}_${random}`,
                        key: sharedKey,
                        value: { source: 'a' },
                        status: SystemConfigStatus.ENABLED,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdConfigIds.push(config1.id)

                const config2 = await testPrisma.systemConfigs.create({
                    data: {
                        configGroup: `${TEST_CONFIG_GROUP_PREFIX}B_${timestamp}_${random}`,
                        key: sharedKey,
                        value: { source: 'b' },
                        status: SystemConfigStatus.ENABLED,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdConfigIds.push(config2.id)

                // 查询
                const configs = await getConfigsByKeyDao(sharedKey)

                expect(configs.length).toBeGreaterThanOrEqual(2)
            })
        })

        describe('getConfigsByPageDao - 分页查询配置', () => {
            it('应能分页查询配置列表', async () => {
                const timestamp = Date.now()
                const random = Math.floor(Math.random() * 1000000)
                const configGroup = `${TEST_CONFIG_GROUP_PREFIX}PAGE_${timestamp}_${random}`

                // 创建多个配置
                for (let i = 0; i < 5; i++) {
                    const config = await testPrisma.systemConfigs.create({
                        data: {
                            configGroup,
                            key: `key_${timestamp}_${random}_${i}`,
                            value: { index: i },
                            status: SystemConfigStatus.ENABLED,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        },
                    })
                    createdConfigIds.push(config.id)
                }

                // 分页查询
                const result = await getConfigsByPageDao(configGroup, 1, 3)

                expect(result.configs.length).toBeLessThanOrEqual(3)
                expect(result.page).toBe(1)
                expect(result.pageSize).toBe(3)
                expect(result.total).toBeGreaterThanOrEqual(5)
            })

            it('不指定组时应查询所有配置', async () => {
                const result = await getConfigsByPageDao(null, 1, 10)

                expect(result.configs).toBeDefined()
                expect(Array.isArray(result.configs)).toBe(true)
            })
        })

        describe('getAllConfigGroupsDao - 获取所有配置组', () => {
            it('应能获取所有不同的配置组', async () => {
                const timestamp = Date.now()
                const random = Math.floor(Math.random() * 1000000)

                // 创建不同组的配置
                const config1 = await testPrisma.systemConfigs.create({
                    data: {
                        configGroup: `${TEST_CONFIG_GROUP_PREFIX}UNIQUE_A_${timestamp}_${random}`,
                        key: `key_a_${timestamp}_${random}`,
                        value: { type: 'a' },
                        status: SystemConfigStatus.ENABLED,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdConfigIds.push(config1.id)

                const config2 = await testPrisma.systemConfigs.create({
                    data: {
                        configGroup: `${TEST_CONFIG_GROUP_PREFIX}UNIQUE_B_${timestamp}_${random}`,
                        key: `key_b_${timestamp}_${random}`,
                        value: { type: 'b' },
                        status: SystemConfigStatus.ENABLED,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdConfigIds.push(config2.id)

                // 获取所有组
                const groups = await getAllConfigGroupsDao()

                expect(Array.isArray(groups)).toBe(true)
                expect(groups.some(g => g.includes('UNIQUE_A'))).toBe(true)
                expect(groups.some(g => g.includes('UNIQUE_B'))).toBe(true)
            })
        })

        describe('getConfigsByGroupDao - 通过组查询所有配置', () => {
            it('应能通过组查询所有配置', async () => {
                const timestamp = Date.now()
                const random = Math.floor(Math.random() * 1000000)
                const configGroup = `${TEST_CONFIG_GROUP_PREFIX}GROUP_${timestamp}_${random}`

                // 创建多个配置
                for (let i = 0; i < 3; i++) {
                    const config = await testPrisma.systemConfigs.create({
                        data: {
                            configGroup,
                            key: `group_key_${timestamp}_${random}_${i}`,
                            value: { index: i },
                            status: SystemConfigStatus.ENABLED,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        },
                    })
                    createdConfigIds.push(config.id)
                }

                // 查询
                const configs = await getConfigsByGroupDao(configGroup)

                expect(configs.length).toBe(3)
                expect(configs.every(c => c.configGroup === configGroup)).toBe(true)
            })
        })

        describe('getConfigByIdDao - 通过 ID 查询配置', () => {
            it('应能通过 ID 查询到配置', async () => {
                const { configGroup, key } = generateUniqueGroupKey()

                const config = await testPrisma.systemConfigs.create({
                    data: {
                        configGroup,
                        key,
                        value: { id_test: true },
                        status: SystemConfigStatus.ENABLED,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
                createdConfigIds.push(config.id)

                // 查询
                const found = await getConfigByIdDao(config.id)

                expect(found).not.toBeNull()
                expect(found?.id).toBe(config.id)
            })

            it('查询不存在的 ID 应返回 null', async () => {
                const found = await getConfigByIdDao(999999999)
                expect(found).toBeNull()
            })
        })
    })

    describe('Property: 配置 CRUD 往返一致性', () => {
        it('创建的配置应能被正确查询到', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0 && !s.includes('\0')),
                    async (valueStr) => {
                        const { configGroup, key } = generateUniqueGroupKey()
                        const value = { data: valueStr }

                        // 创建
                        const config = await testPrisma.systemConfigs.create({
                            data: {
                                configGroup,
                                key,
                                value,
                                status: SystemConfigStatus.ENABLED,
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            },
                        })
                        createdConfigIds.push(config.id)

                        // 通过 ID 查询
                        const foundById = await getConfigByIdDao(config.id)
                        expect(foundById).not.toBeNull()

                        // 通过组和键查询
                        const foundByGroupKey = await getConfigsByGroupAndKeyDao(configGroup, key)
                        expect(foundByGroupKey).not.toBeNull()
                    }
                ),
                { numRuns: 10 }
            )
        })
    })
})
