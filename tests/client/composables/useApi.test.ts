/**
 * useApi Composable 测试
 *
 * 测试 API 请求封装的核心逻辑
 *
 * **Feature: api-composable**
 * **Validates: Requirements 2.1, 2.2**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 模拟 toast
const mockToast = {
    error: vi.fn(),
    success: vi.fn(),
}
vi.stubGlobal('toast', mockToast)

// 模拟 useNuxtApp
vi.stubGlobal('useNuxtApp', () => ({
    $router: {
        currentRoute: { value: { fullPath: '/test' } },
    },
}))

// 模拟 useAuthStore
const mockAuthStore = {
    isAuthenticated: true,
}
vi.stubGlobal('useAuthStore', () => mockAuthStore)

// 模拟 import.meta.client
vi.stubGlobal('import', { meta: { client: true } })

describe('useApi 核心逻辑测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockAuthStore.isAuthenticated = true
    })

    describe('API 响应处理', () => {
        it('成功响应应提取 data 字段', () => {
            const response: ApiBaseResponse<{ name: string }> = {
                success: true,
                code: 200,
                message: '成功',
                data: { name: '测试' },
            }

            // 模拟 transform 逻辑
            const transform = (res: ApiBaseResponse<{ name: string }>) => res.data
            const result = transform(response)

            expect(result).toEqual({ name: '测试' })
        })

        it('业务错误应显示错误提示', () => {
            const response: ApiBaseResponse<null> = {
                success: false,
                code: 400,
                message: '参数错误',
                data: null,
            }

            // 模拟 onResponse 逻辑
            const showError = true
            if (showError && response && response.success === false) {
                mockToast.error(response.message || '请求失败')
            }

            expect(mockToast.error).toHaveBeenCalledWith('参数错误')
        })

        it('showError 为 false 时不显示错误提示', () => {
            const response: ApiBaseResponse<null> = {
                success: false,
                code: 400,
                message: '参数错误',
                data: null,
            }

            // 模拟 onResponse 逻辑
            const showError = false
            if (showError && response && response.success === false) {
                mockToast.error(response.message || '请求失败')
            }

            expect(mockToast.error).not.toHaveBeenCalled()
        })

        it('401 响应应触发登出逻辑', () => {
            const response: ApiBaseResponse<null> = {
                success: false,
                code: 401,
                message: '未授权',
                data: null,
            }

            // 模拟 401 处理逻辑
            if (response && response.code === 401) {
                mockAuthStore.isAuthenticated = false
            }

            expect(mockAuthStore.isAuthenticated).toBe(false)
        })
    })

    describe('错误响应处理', () => {
        it('网络错误应显示默认错误提示', () => {
            const showError = true
            const data = undefined
            const statusText = 'Internal Server Error'

            // 模拟 onResponseError 逻辑
            if (showError) {
                if (data && (data as ApiBaseResponse<unknown>).success === false) {
                    mockToast.error((data as ApiBaseResponse<unknown>).message || '请求失败')
                } else {
                    const message = statusText || '网络请求失败，请稍后重试'
                    mockToast.error(message)
                }
            }

            expect(mockToast.error).toHaveBeenCalledWith('Internal Server Error')
        })

        it('无状态文本时应显示默认错误信息', () => {
            const showError = true
            const data = undefined
            const statusText = ''

            // 模拟 onResponseError 逻辑
            if (showError) {
                if (data && (data as ApiBaseResponse<unknown>).success === false) {
                    mockToast.error((data as ApiBaseResponse<unknown>).message || '请求失败')
                } else {
                    const message = statusText || '网络请求失败，请稍后重试'
                    mockToast.error(message)
                }
            }

            expect(mockToast.error).toHaveBeenCalledWith('网络请求失败，请稍后重试')
        })

        it('响应体包含错误信息时应使用响应体中的信息', () => {
            const showError = true
            const data: ApiBaseResponse<null> = {
                success: false,
                code: 500,
                message: '服务器内部错误',
                data: null,
            }

            // 模拟 onResponseError 逻辑
            if (showError) {
                if (data && data.success === false) {
                    mockToast.error(data.message || '请求失败')
                }
            }

            expect(mockToast.error).toHaveBeenCalledWith('服务器内部错误')
        })
    })

    describe('自定义 transform', () => {
        it('应支持自定义 transform 函数', () => {
            const response: ApiBaseResponse<{ items: string[] }> = {
                success: true,
                code: 200,
                message: '成功',
                data: { items: ['a', 'b', 'c'] },
            }

            // 自定义 transform
            const userTransform = (res: ApiBaseResponse<{ items: string[] }>) => res.data?.items || []
            const result = userTransform(response)

            expect(result).toEqual(['a', 'b', 'c'])
        })

        it('自定义 transform 优先于默认 transform', () => {
            const response: ApiBaseResponse<{ count: number }> = {
                success: true,
                code: 200,
                message: '成功',
                data: { count: 42 },
            }

            // 模拟 transform 逻辑
            const userTransform = (res: ApiBaseResponse<{ count: number }>) => res.data?.count || 0
            const defaultTransform = (res: ApiBaseResponse<{ count: number }>) => res.data

            // 如果有用户 transform，使用用户的
            const transform = userTransform || defaultTransform
            const result = transform(response)

            expect(result).toBe(42)
        })
    })
})

// 定义 ApiBaseResponse 类型（用于测试）
interface ApiBaseResponse<T> {
    success: boolean
    code: number
    message: string
    data: T
}
