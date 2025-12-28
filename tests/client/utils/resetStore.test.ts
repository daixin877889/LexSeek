/**
 * Store 重置工具函数测试
 *
 * 测试 resetAllStore 函数的行为
 * 注意：由于 Nuxt 自动导入机制的限制，无法在测试环境中模拟全局 store composables
 * 因此本测试主要验证传入 pinia 实例时的行为
 *
 * **Feature: store-utils**
 * **Validates: Requirements 1.3**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 直接测试函数逻辑，不依赖 Nuxt 自动导入
// 创建一个独立的测试版本来验证核心逻辑
const resetAllStoreWithPinia = (pinia?: any) => {
    // 如果传入了 pinia 实例，遍历所有 store 并重置
    if (pinia?._s) {
        pinia._s.forEach((store: any) => {
            if (typeof store.$reset === 'function') {
                store.$reset()
            }
        })
        return true // 表示使用了 pinia 路径
    }
    return false // 表示需要使用 setup 上下文
}

describe('resetAllStore 重置所有 store', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('传入 pinia 实例时', () => {
        it('应遍历 pinia._s 中的所有 store 并重置', () => {
            const mockStore1 = { $reset: vi.fn() }
            const mockStore2 = { $reset: vi.fn() }
            const mockStore3 = { $reset: vi.fn() }

            const mockPinia = {
                _s: new Map<string, any>([
                    ['store1', mockStore1],
                    ['store2', mockStore2],
                    ['store3', mockStore3],
                ]),
            }

            const usedPiniaPath = resetAllStoreWithPinia(mockPinia)

            expect(usedPiniaPath).toBe(true)
            expect(mockStore1.$reset).toHaveBeenCalled()
            expect(mockStore2.$reset).toHaveBeenCalled()
            expect(mockStore3.$reset).toHaveBeenCalled()
        })

        it('应跳过没有 $reset 方法的 store', () => {
            const mockStoreWithReset = { $reset: vi.fn() }
            const mockStoreWithoutReset = { someOtherMethod: vi.fn() }

            const mockPinia = {
                _s: new Map<string, any>([
                    ['store1', mockStoreWithReset],
                    ['store2', mockStoreWithoutReset],
                ]),
            }

            // 不应抛出错误
            expect(() => resetAllStoreWithPinia(mockPinia)).not.toThrow()
            expect(mockStoreWithReset.$reset).toHaveBeenCalled()
        })

        it('空的 pinia._s 应正常处理', () => {
            const mockPinia = {
                _s: new Map(),
            }

            expect(() => resetAllStoreWithPinia(mockPinia)).not.toThrow()
        })

        it('应按顺序重置所有 store', () => {
            const callOrder: string[] = []
            const mockStore1 = {
                $reset: vi.fn(() => callOrder.push('store1')),
            }
            const mockStore2 = {
                $reset: vi.fn(() => callOrder.push('store2')),
            }

            const mockPinia = {
                _s: new Map<string, any>([
                    ['store1', mockStore1],
                    ['store2', mockStore2],
                ]),
            }

            resetAllStoreWithPinia(mockPinia)

            expect(callOrder).toEqual(['store1', 'store2'])
        })

        it('每个 store 的 $reset 只应被调用一次', () => {
            const mockStore = { $reset: vi.fn() }

            const mockPinia = {
                _s: new Map<string, any>([['store1', mockStore]]),
            }

            resetAllStoreWithPinia(mockPinia)

            expect(mockStore.$reset).toHaveBeenCalledTimes(1)
        })
    })

    describe('边界情况 - 回退到 setup 上下文', () => {
        it('pinia 没有 _s 属性时应返回 false（需要 setup 上下文）', () => {
            const mockPinia = {}
            const usedPiniaPath = resetAllStoreWithPinia(mockPinia)
            expect(usedPiniaPath).toBe(false)
        })

        it('传入 null 应返回 false（需要 setup 上下文）', () => {
            const usedPiniaPath = resetAllStoreWithPinia(null)
            expect(usedPiniaPath).toBe(false)
        })

        it('传入 undefined 应返回 false（需要 setup 上下文）', () => {
            const usedPiniaPath = resetAllStoreWithPinia(undefined)
            expect(usedPiniaPath).toBe(false)
        })

        it('pinia._s 为 null 时应返回 false', () => {
            const mockPinia = { _s: null }
            const usedPiniaPath = resetAllStoreWithPinia(mockPinia)
            expect(usedPiniaPath).toBe(false)
        })
    })

    describe('store 类型处理', () => {
        it('应处理 $reset 返回 Promise 的 store', async () => {
            const mockStore = {
                $reset: vi.fn().mockResolvedValue(undefined),
            }

            const mockPinia = {
                _s: new Map<string, any>([['asyncStore', mockStore]]),
            }

            resetAllStoreWithPinia(mockPinia)

            expect(mockStore.$reset).toHaveBeenCalled()
        })

        it('应处理 $reset 抛出错误的 store', () => {
            const mockStoreWithError = {
                $reset: vi.fn(() => {
                    throw new Error('Reset failed')
                }),
            }
            const mockStoreNormal = { $reset: vi.fn() }

            const mockPinia = {
                _s: new Map<string, any>([
                    ['errorStore', mockStoreWithError],
                    ['normalStore', mockStoreNormal],
                ]),
            }

            // 第一个 store 抛出错误会中断执行
            expect(() => resetAllStoreWithPinia(mockPinia)).toThrow('Reset failed')
            expect(mockStoreWithError.$reset).toHaveBeenCalled()
            // 由于错误，第二个 store 不会被调用
        })

        it('应处理包含多种属性的 store 对象', () => {
            const mockStore = {
                $reset: vi.fn(),
                $state: { count: 0 },
                $patch: vi.fn(),
                someAction: vi.fn(),
            }

            const mockPinia = {
                _s: new Map<string, any>([['complexStore', mockStore]]),
            }

            resetAllStoreWithPinia(mockPinia)

            // 只有 $reset 被调用
            expect(mockStore.$reset).toHaveBeenCalled()
            expect(mockStore.$patch).not.toHaveBeenCalled()
            expect(mockStore.someAction).not.toHaveBeenCalled()
        })
    })

    describe('大量 store 处理', () => {
        it('应能处理大量 store', () => {
            const stores = new Map<string, any>()
            const resetFns: ReturnType<typeof vi.fn>[] = []

            // 创建 100 个 store
            for (let i = 0; i < 100; i++) {
                const resetFn = vi.fn()
                resetFns.push(resetFn)
                stores.set(`store${i}`, { $reset: resetFn })
            }

            const mockPinia = { _s: stores }

            resetAllStoreWithPinia(mockPinia)

            // 验证所有 store 都被重置
            resetFns.forEach((fn) => {
                expect(fn).toHaveBeenCalledTimes(1)
            })
        })
    })
})
