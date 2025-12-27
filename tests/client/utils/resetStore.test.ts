/**
 * Store 重置工具函数测试
 *
 * 测试 resetAllStore 函数的行为
 *
 * **Feature: store-utils**
 * **Validates: Requirements 1.3**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 模拟 store composables
const mockUserStore = {
    $reset: vi.fn(),
}

const mockAuthStore = {
    $reset: vi.fn(),
}

const mockRoleStore = {
    $reset: vi.fn(),
}

// 模拟 useUserStore, useAuthStore, useRoleStore
vi.stubGlobal('useUserStore', () => mockUserStore)
vi.stubGlobal('useAuthStore', () => mockAuthStore)
vi.stubGlobal('useRoleStore', () => mockRoleStore)

// 导入被测试的函数
import { resetAllStore } from '../../../app/utils/resetStore'

describe('resetAllStore 重置所有 store', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('在 setup 上下文中（无 pinia 参数）', () => {
        it('应重置 userStore', () => {
            resetAllStore()
            expect(mockUserStore.$reset).toHaveBeenCalled()
        })

        it('应重置 authStore', () => {
            resetAllStore()
            expect(mockAuthStore.$reset).toHaveBeenCalled()
        })

        it('应重置 roleStore', () => {
            resetAllStore()
            expect(mockRoleStore.$reset).toHaveBeenCalled()
        })

        it('应重置所有三个 store', () => {
            resetAllStore()
            expect(mockUserStore.$reset).toHaveBeenCalledTimes(1)
            expect(mockAuthStore.$reset).toHaveBeenCalledTimes(1)
            expect(mockRoleStore.$reset).toHaveBeenCalledTimes(1)
        })
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

            resetAllStore(mockPinia)

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
            expect(() => resetAllStore(mockPinia)).not.toThrow()
            expect(mockStoreWithReset.$reset).toHaveBeenCalled()
        })

        it('空的 pinia._s 应正常处理', () => {
            const mockPinia = {
                _s: new Map(),
            }

            expect(() => resetAllStore(mockPinia)).not.toThrow()
        })

        it('pinia 没有 _s 属性时应使用 setup 上下文', () => {
            const mockPinia = {}

            resetAllStore(mockPinia)

            // 应该调用 setup 上下文中的 store
            expect(mockUserStore.$reset).toHaveBeenCalled()
            expect(mockAuthStore.$reset).toHaveBeenCalled()
            expect(mockRoleStore.$reset).toHaveBeenCalled()
        })
    })

    describe('边界情况', () => {
        it('传入 null 应使用 setup 上下文', () => {
            resetAllStore(null)

            expect(mockUserStore.$reset).toHaveBeenCalled()
            expect(mockAuthStore.$reset).toHaveBeenCalled()
            expect(mockRoleStore.$reset).toHaveBeenCalled()
        })

        it('传入 undefined 应使用 setup 上下文', () => {
            resetAllStore(undefined)

            expect(mockUserStore.$reset).toHaveBeenCalled()
            expect(mockAuthStore.$reset).toHaveBeenCalled()
            expect(mockRoleStore.$reset).toHaveBeenCalled()
        })
    })
})
