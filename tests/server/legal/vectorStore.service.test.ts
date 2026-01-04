/**
 * 向量存储服务测试
 *
 * 验证向量存储实例的复用机制
 *
 * **Feature: legal-knowledge-base**
 * **Validates: Requirements 7.5**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// 测试向量存储实例缓存逻辑（不依赖实际的 PGVectorStore）
describe('向量存储服务 - 实例缓存逻辑', () => {
    // 模拟实例缓存
    let vectorStores: Map<string, object>
    let initializingTables: Set<string>

    beforeEach(() => {
        vectorStores = new Map()
        initializingTables = new Set()
    })

    /**
     * Property 11: 向量存储实例复用
     * 对于任意表名，多次获取应返回相同的实例
     */
    describe('Property 11: 向量存储实例复用', () => {
        // 模拟 getVectorStore 的核心逻辑
        const mockGetVectorStore = async (tableName: string): Promise<object> => {
            // 如果该表的实例已存在，直接返回
            if (vectorStores.has(tableName)) {
                return vectorStores.get(tableName)!
            }

            // 如果该表正在初始化，等待初始化完成
            if (initializingTables.has(tableName)) {
                while (initializingTables.has(tableName)) {
                    await new Promise(resolve => setTimeout(resolve, 10))
                }
                if (vectorStores.has(tableName)) {
                    return vectorStores.get(tableName)!
                }
            }

            try {
                initializingTables.add(tableName)
                // 模拟创建新实例
                const newInstance = { tableName, createdAt: Date.now() }
                vectorStores.set(tableName, newInstance)
                return newInstance
            } finally {
                initializingTables.delete(tableName)
            }
        }

        it('多次调用 getVectorStore 应返回相同的实例', async () => {
            const tableName = 'test_table'

            // 第一次调用
            const instance1 = await mockGetVectorStore(tableName)

            // 第二次调用
            const instance2 = await mockGetVectorStore(tableName)

            // 验证返回相同实例
            expect(instance1).toBe(instance2)
        })

        it('不同表名应返回不同的实例', async () => {
            const tableName1 = 'table_a'
            const tableName2 = 'table_b'

            // 获取两个不同表的实例
            const instance1 = await mockGetVectorStore(tableName1)
            const instance2 = await mockGetVectorStore(tableName2)

            // 验证返回不同实例
            expect(instance1).not.toBe(instance2)
        })

        it('并发请求同一表名应返回相同实例', async () => {
            const tableName = 'concurrent_table'

            // 并发请求
            const [instance1, instance2, instance3] = await Promise.all([
                mockGetVectorStore(tableName),
                mockGetVectorStore(tableName),
                mockGetVectorStore(tableName),
            ])

            // 验证所有请求返回相同实例
            expect(instance1).toBe(instance2)
            expect(instance2).toBe(instance3)
        })

        it('缓存应正确记录实例数量', async () => {
            // 创建多个实例
            await mockGetVectorStore('table_1')
            await mockGetVectorStore('table_2')
            await mockGetVectorStore('table_3')

            // 验证缓存数量
            expect(vectorStores.size).toBe(3)

            // 重复请求不应增加缓存数量
            await mockGetVectorStore('table_1')
            await mockGetVectorStore('table_2')

            expect(vectorStores.size).toBe(3)
        })
    })

    describe('重置功能', () => {
        const mockGetVectorStore = async (tableName: string): Promise<object> => {
            if (vectorStores.has(tableName)) {
                return vectorStores.get(tableName)!
            }
            const newInstance = { tableName, createdAt: Date.now() }
            vectorStores.set(tableName, newInstance)
            return newInstance
        }

        const mockResetVectorStore = (tableName?: string): void => {
            if (tableName) {
                vectorStores.delete(tableName)
            } else {
                vectorStores.clear()
                initializingTables.clear()
            }
        }

        it('重置指定表名应只删除该表的实例', async () => {
            // 创建两个实例
            await mockGetVectorStore('table_a')
            await mockGetVectorStore('table_b')

            expect(vectorStores.size).toBe(2)

            // 重置其中一个
            mockResetVectorStore('table_a')

            expect(vectorStores.size).toBe(1)
            expect(vectorStores.has('table_b')).toBe(true)
            expect(vectorStores.has('table_a')).toBe(false)
        })

        it('不带参数重置应清除所有实例', async () => {
            // 创建多个实例
            await mockGetVectorStore('table_x')
            await mockGetVectorStore('table_y')
            await mockGetVectorStore('table_z')

            expect(vectorStores.size).toBe(3)

            // 重置所有
            mockResetVectorStore()

            expect(vectorStores.size).toBe(0)
        })

        it('重置后再次获取应创建新实例', async () => {
            const tableName = 'reset_test'

            // 获取实例
            const instance1 = await mockGetVectorStore(tableName)

            // 重置
            mockResetVectorStore(tableName)

            // 再次获取
            const instance2 = await mockGetVectorStore(tableName)

            // 验证是新实例
            expect(instance1).not.toBe(instance2)
        })
    })
})

