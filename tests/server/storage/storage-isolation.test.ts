/**
 * 用户配置隔离属性测试
 *
 * 使用 fast-check 进行属性测试，验证用户配置隔离
 * Feature: storage-adapter
 * Property 7: 用户配置隔离
 * Validates: Requirements 7.5
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

/**
 * 模拟存储配置记录
 */
interface MockStorageConfig {
    id: number
    userId: number | null
    name: string
    type: string
    enabled: boolean
}

/**
 * 模拟配置数据库
 */
class MockConfigDatabase {
    private configs: MockStorageConfig[] = []
    private nextId = 1

    /** 添加配置 */
    add(config: Omit<MockStorageConfig, 'id'>): MockStorageConfig {
        const newConfig = { ...config, id: this.nextId++ }
        this.configs.push(newConfig)
        return newConfig
    }

    /** 获取用户可访问的配置 */
    getAccessibleConfigs(userId: number, includeSystem: boolean = true): MockStorageConfig[] {
        return this.configs.filter(c => {
            // 用户只能访问自己的配置
            if (c.userId === userId) return true
            // 如果包含系统配置，也返回系统配置
            if (includeSystem && c.userId === null) return true
            return false
        })
    }

    /** 检查用户是否可以访问指定配置 */
    canAccess(userId: number, configId: number): boolean {
        const config = this.configs.find(c => c.id === configId)
        if (!config) return false
        // 用户只能访问自己的配置或系统配置
        return config.userId === userId || config.userId === null
    }

    /** 检查用户是否可以修改指定配置 */
    canModify(userId: number, configId: number): boolean {
        const config = this.configs.find(c => c.id === configId)
        if (!config) return false
        // 用户只能修改自己的配置
        return config.userId === userId
    }

    /** 清空数据库 */
    clear(): void {
        this.configs = []
        this.nextId = 1
    }
}

/**
 * 生成用户 ID
 */
const userIdArb = fc.integer({ min: 1, max: 1000 })

/**
 * 生成不同的用户 ID 对
 */
const differentUserIdsArb = fc.tuple(
    fc.integer({ min: 1, max: 500 }),
    fc.integer({ min: 501, max: 1000 })
)

/**
 * 生成配置名称
 */
const configNameArb = fc.string({ minLength: 1, maxLength: 50 })

/**
 * 生成存储类型
 */
const storageTypeArb = fc.constantFrom('aliyun_oss', 'qiniu', 'tencent_cos')

describe('Property 7: 用户配置隔离', () => {
    const db = new MockConfigDatabase()

    describe('配置访问隔离', () => {
        it('用户只能访问自己的配置', () => {
            fc.assert(
                fc.property(
                    differentUserIdsArb,
                    configNameArb,
                    storageTypeArb,
                    ([userA, userB], name, type) => {
                        db.clear()

                        // 用户 A 创建配置
                        const configA = db.add({
                            userId: userA,
                            name: `${name}-A`,
                            type,
                            enabled: true
                        })

                        // 用户 B 创建配置
                        const configB = db.add({
                            userId: userB,
                            name: `${name}-B`,
                            type,
                            enabled: true
                        })

                        // 用户 A 只能访问自己的配置
                        const accessibleByA = db.getAccessibleConfigs(userA, false)
                        expect(accessibleByA).toContainEqual(configA)
                        expect(accessibleByA).not.toContainEqual(configB)

                        // 用户 B 只能访问自己的配置
                        const accessibleByB = db.getAccessibleConfigs(userB, false)
                        expect(accessibleByB).toContainEqual(configB)
                        expect(accessibleByB).not.toContainEqual(configA)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('用户可以访问系统配置', () => {
            fc.assert(
                fc.property(
                    userIdArb,
                    configNameArb,
                    storageTypeArb,
                    (userId, name, type) => {
                        db.clear()

                        // 创建系统配置
                        const systemConfig = db.add({
                            userId: null,
                            name: `${name}-system`,
                            type,
                            enabled: true
                        })

                        // 用户可以访问系统配置
                        const accessible = db.getAccessibleConfigs(userId, true)
                        expect(accessible).toContainEqual(systemConfig)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('用户不能访问其他用户的配置', () => {
            fc.assert(
                fc.property(
                    differentUserIdsArb,
                    configNameArb,
                    storageTypeArb,
                    ([userA, userB], name, type) => {
                        db.clear()

                        // 用户 A 创建配置
                        const configA = db.add({
                            userId: userA,
                            name,
                            type,
                            enabled: true
                        })

                        // 用户 B 不能访问用户 A 的配置
                        expect(db.canAccess(userB, configA.id)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('配置修改隔离', () => {
        it('用户只能修改自己的配置', () => {
            fc.assert(
                fc.property(
                    differentUserIdsArb,
                    configNameArb,
                    storageTypeArb,
                    ([userA, userB], name, type) => {
                        db.clear()

                        // 用户 A 创建配置
                        const configA = db.add({
                            userId: userA,
                            name,
                            type,
                            enabled: true
                        })

                        // 用户 A 可以修改自己的配置
                        expect(db.canModify(userA, configA.id)).toBe(true)

                        // 用户 B 不能修改用户 A 的配置
                        expect(db.canModify(userB, configA.id)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('用户不能修改系统配置', () => {
            fc.assert(
                fc.property(
                    userIdArb,
                    configNameArb,
                    storageTypeArb,
                    (userId, name, type) => {
                        db.clear()

                        // 创建系统配置
                        const systemConfig = db.add({
                            userId: null,
                            name,
                            type,
                            enabled: true
                        })

                        // 普通用户不能修改系统配置
                        expect(db.canModify(userId, systemConfig.id)).toBe(false)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('配置列表隔离', () => {
        it('获取配置列表时只返回用户自己的配置和系统配置', () => {
            fc.assert(
                fc.property(
                    differentUserIdsArb,
                    fc.array(configNameArb, { minLength: 1, maxLength: 5 }),
                    storageTypeArb,
                    ([userA, userB], names, type) => {
                        db.clear()

                        // 创建系统配置
                        const systemConfig = db.add({
                            userId: null,
                            name: 'system-config',
                            type,
                            enabled: true
                        })

                        // 用户 A 创建多个配置
                        const configsA = names.map((name, i) =>
                            db.add({
                                userId: userA,
                                name: `${name}-A-${i}`,
                                type,
                                enabled: true
                            })
                        )

                        // 用户 B 创建多个配置
                        const configsB = names.map((name, i) =>
                            db.add({
                                userId: userB,
                                name: `${name}-B-${i}`,
                                type,
                                enabled: true
                            })
                        )

                        // 用户 A 获取配置列表
                        const listA = db.getAccessibleConfigs(userA, true)

                        // 应该包含系统配置
                        expect(listA).toContainEqual(systemConfig)

                        // 应该包含用户 A 的所有配置
                        for (const config of configsA) {
                            expect(listA).toContainEqual(config)
                        }

                        // 不应该包含用户 B 的任何配置
                        for (const config of configsB) {
                            expect(listA).not.toContainEqual(config)
                        }
                    }
                ),
                { numRuns: 50 }
            )
        })
    })
})
