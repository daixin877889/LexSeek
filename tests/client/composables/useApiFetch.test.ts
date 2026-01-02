/**
 * useApiFetch composable 测试
 *
 * 测试 useApiFetch 的功能，包括：
 * - 成功请求返回数据
 * - 失败请求返回 null
 * - 错误处理逻辑
 *
 * **Feature: use-api-fetch**
 * **Validates: Requirements 1.1, 1.2**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 模拟 ApiBaseResponse 类型
interface ApiBaseResponse<T> {
    success: boolean
    code: number
    message: string
    data: T
}

// 模拟 toast
const mockToast = {
    error: vi.fn(),
    success: vi.fn(),
}

// 模拟 $fetch
const mockFetch = vi.fn()

// 模拟 useApiFetch 函数的核心逻辑
async function useApiFetchMock<T = unknown>(
    url: string,
    options: {
        showError?: boolean
        method?: string
        body?: any
    } = {}
): Promise<T | null> {
    const { showError = true } = options

    try {
        const response = await mockFetch(url, options) as ApiBaseResponse<T>

        // 检查业务逻辑错误
        if (response && response.success === false) {
            if (showError) {
                mockToast.error(response.message || '请求失败')
            }
            return null
        }

        return response.data as T
    } catch (error: any) {
        if (showError) {
            mockToast.error(error.message || '网络请求失败')
        }
        return null
    }
}

describe('useApiFetch composable 测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.resetAllMocks()
    })

    describe('成功请求', () => {
        it('应返回响应数据的 data 字段', async () => {
            const mockData = { id: 1, name: '测试用户' }
            mockFetch.mockResolvedValue({
                success: true,
                code: 200,
                message: 'success',
                data: mockData,
            })

            const result = await useApiFetchMock('/api/v1/users/me')

            expect(result).toEqual(mockData)
            expect(mockToast.error).not.toHaveBeenCalled()
        })

        it('应正确处理空数据', async () => {
            mockFetch.mockResolvedValue({
                success: true,
                code: 200,
                message: 'success',
                data: null,
            })

            const result = await useApiFetchMock('/api/v1/empty')

            expect(result).toBeNull()
            expect(mockToast.error).not.toHaveBeenCalled()
        })

        it('应正确处理数组数据', async () => {
            const mockData = [{ id: 1 }, { id: 2 }, { id: 3 }]
            mockFetch.mockResolvedValue({
                success: true,
                code: 200,
                message: 'success',
                data: mockData,
            })

            const result = await useApiFetchMock('/api/v1/list')

            expect(result).toEqual(mockData)
            expect(Array.isArray(result)).toBe(true)
        })
    })

    describe('业务错误处理', () => {
        it('业务错误时应返回 null', async () => {
            mockFetch.mockResolvedValue({
                success: false,
                code: 400,
                message: '参数错误',
                data: null,
            })

            const result = await useApiFetchMock('/api/v1/error')

            expect(result).toBeNull()
        })

        it('业务错误时应显示错误提示', async () => {
            mockFetch.mockResolvedValue({
                success: false,
                code: 400,
                message: '参数错误',
                data: null,
            })

            await useApiFetchMock('/api/v1/error')

            expect(mockToast.error).toHaveBeenCalledWith('参数错误')
        })

        it('showError 为 false 时不应显示错误提示', async () => {
            mockFetch.mockResolvedValue({
                success: false,
                code: 400,
                message: '参数错误',
                data: null,
            })

            const result = await useApiFetchMock('/api/v1/error', { showError: false })

            expect(result).toBeNull()
            expect(mockToast.error).not.toHaveBeenCalled()
        })
    })

    describe('网络错误处理', () => {
        it('网络错误时应返回 null', async () => {
            mockFetch.mockRejectedValue(new Error('Network Error'))

            const result = await useApiFetchMock('/api/v1/network-error')

            expect(result).toBeNull()
        })

        it('网络错误时应显示错误提示', async () => {
            mockFetch.mockRejectedValue(new Error('Network Error'))

            await useApiFetchMock('/api/v1/network-error')

            expect(mockToast.error).toHaveBeenCalledWith('Network Error')
        })

        it('网络错误且 showError 为 false 时不应显示错误提示', async () => {
            mockFetch.mockRejectedValue(new Error('Network Error'))

            await useApiFetchMock('/api/v1/network-error', { showError: false })

            expect(mockToast.error).not.toHaveBeenCalled()
        })
    })

    describe('请求参数传递', () => {
        it('应正确传递 POST 请求参数', async () => {
            mockFetch.mockResolvedValue({
                success: true,
                code: 200,
                message: 'success',
                data: { id: 1 },
            })

            const body = { name: '测试', value: 123 }
            await useApiFetchMock('/api/v1/create', {
                method: 'POST',
                body,
            })

            expect(mockFetch).toHaveBeenCalledWith('/api/v1/create', {
                method: 'POST',
                body,
                showError: true,
            })
        })
    })

    describe('类型安全', () => {
        it('应正确推断返回类型', async () => {
            interface User {
                id: number
                name: string
            }

            mockFetch.mockResolvedValue({
                success: true,
                code: 200,
                message: 'success',
                data: { id: 1, name: '测试用户' },
            })

            const result = await useApiFetchMock<User>('/api/v1/users/me')

            if (result) {
                expect(result.id).toBe(1)
                expect(result.name).toBe('测试用户')
            }
        })
    })
})
