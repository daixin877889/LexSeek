/**
 * API 测试客户端
 *
 * 封装 HTTP 请求，用于 API 集成测试
 * 支持发送真实的 HTTP 请求到运行中的服务器
 *
 * **Feature: api-integration-tests**
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 */

import { $fetch, type FetchOptions } from 'ofetch'

// 服务器基础 URL（从环境变量获取或使用默认值）
const BASE_URL = process.env.TEST_API_BASE_URL || 'http://localhost:3000'

/** API 响应基础结构 */
export interface ApiResponse<T = any> {
    success: boolean
    message: string
    data: T
    code?: number  // 业务错误码
    requestId?: string
    timestamp?: number
}

/** 完整响应信息 */
export interface FullResponse<T = any> {
    status: number
    headers: Headers
    body: ApiResponse<T>
}

/** 请求选项 */
export interface RequestOptions {
    headers?: Record<string, string>
    query?: Record<string, string | number | boolean>
}

/**
 * API 测试客户端类
 *
 * 提供发送 HTTP 请求的能力，支持认证令牌管理
 */
export class ApiTestClient {
    private authToken: string | null = null
    private lastResponse: FullResponse | null = null

    /**
     * 设置认证令牌
     * @param token JWT 令牌
     */
    setAuthToken(token: string): void {
        this.authToken = token
    }

    /**
     * 清除认证令牌
     */
    clearAuthToken(): void {
        this.authToken = null
    }

    /**
     * 获取当前认证令牌
     */
    getAuthToken(): string | null {
        return this.authToken
    }

    /**
     * 获取最后一次请求的完整响应
     */
    getLastResponse(): FullResponse | null {
        return this.lastResponse
    }

    /**
     * 构建请求头
     */
    private buildHeaders(options?: RequestOptions): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...options?.headers,
        }

        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`
        }

        return headers
    }

    /**
     * 发送请求并处理响应
     */
    private async request<T>(
        method: string,
        url: string,
        body?: any,
        options?: RequestOptions
    ): Promise<ApiResponse<T>> {
        const fullUrl = `${BASE_URL}${url}`
        const headers = this.buildHeaders(options)

        const fetchOptions: FetchOptions = {
            method,
            headers,
            query: options?.query,
            // 不自动抛出错误，我们需要处理所有响应
            ignoreResponseError: true,
            // 获取原始响应
            onResponse: ({ response }) => {
                this.lastResponse = {
                    status: response.status,
                    headers: response.headers,
                    body: response._data,
                }
            },
        }

        if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
            fetchOptions.body = body
        }

        try {
            const response = await $fetch<ApiResponse<T>>(fullUrl, fetchOptions)
            return response
        } catch (error: any) {
            // 如果有响应数据，返回它
            if (this.lastResponse?.body) {
                return this.lastResponse.body as ApiResponse<T>
            }
            // 否则构造错误响应
            return {
                success: false,
                message: error.message || '请求失败',
                data: null as T,
            }
        }
    }

    /**
     * GET 请求
     */
    async get<T = any>(url: string, options?: RequestOptions): Promise<ApiResponse<T>> {
        return this.request<T>('GET', url, undefined, options)
    }

    /**
     * POST 请求
     */
    async post<T = any>(url: string, body?: any, options?: RequestOptions): Promise<ApiResponse<T>> {
        return this.request<T>('POST', url, body, options)
    }

    /**
     * PUT 请求
     */
    async put<T = any>(url: string, body?: any, options?: RequestOptions): Promise<ApiResponse<T>> {
        return this.request<T>('PUT', url, body, options)
    }

    /**
     * DELETE 请求
     */
    async delete<T = any>(url: string, options?: RequestOptions): Promise<ApiResponse<T>> {
        return this.request<T>('DELETE', url, undefined, options)
    }

    /**
     * PATCH 请求
     */
    async patch<T = any>(url: string, body?: any, options?: RequestOptions): Promise<ApiResponse<T>> {
        return this.request<T>('PATCH', url, body, options)
    }
}

/** 创建新的 API 测试客户端实例 */
export const createApiClient = (): ApiTestClient => {
    return new ApiTestClient()
}

/** 默认的 API 测试客户端实例 */
export const apiClient = new ApiTestClient()
