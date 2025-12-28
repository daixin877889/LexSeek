/**
 * 封装 $fetch 的 composable
 * 用于组件挂载后的事件处理函数中调用 API
 * 通过拦截器统一处理错误，使用方式与原生 $fetch 类似
 *
 * 错误处理方式与 useApi 保持一致：
 * - 业务错误时返回 null，不抛出异常
 * - 自动显示错误 toast（可通过 showError: false 禁用）
 * - 调用方需要检查返回值是否为 null 来判断请求是否成功
 */

import type { FetchOptions } from 'ofetch'

interface UseApiFetchOptions<T> extends Omit<FetchOptions, 'onResponse' | 'onResponseError'> {
    /** 是否显示错误提示（默认 true） */
    showError?: boolean
    /** 自定义数据转换 */
    transform?: (response: ApiBaseResponse<T>) => T
}

/**
 * 封装 $fetch，通过拦截器统一处理 API 错误
 * 适用于组件挂载后的事件处理函数中调用
 *
 * 当 API 返回 success: false 时：
 * - 自动显示错误 toast（除非 showError: false）
 * - 返回 null，调用方需要检查返回值
 *
 * @param url 请求地址
 * @param options $fetch 配置选项
 * @returns Promise<T | null> 成功返回 data 字段数据，失败返回 null
 *
 * @example
 * ```typescript
 * // 基本用法：需要检查返回值
 * const data = await useApiFetch('/api/v1/users/me')
 * if (data) {
 *     // 请求成功，处理数据
 * }
 * // 请求失败时 toast 已自动显示，无需额外处理
 *
 * // 需要在失败时执行特定逻辑
 * const data = await useApiFetch('/api/v1/redemption-codes/redeem', {
 *     method: 'POST',
 *     body: { code },
 * })
 * if (data) {
 *     toast.success('兑换成功')
 *     // 刷新数据等操作
 * }
 * // 失败时不会执行 toast.success
 * ```
 */
export async function useApiFetch<T = unknown>(
    url: string,
    options: UseApiFetchOptions<T> = {}
): Promise<T | null> {
    const {
        showError = true,
        transform: userTransform,
        ...restOptions
    } = options

    const response = await $fetch<ApiBaseResponse<T>>(url, {
        ...(restOptions as Record<string, unknown>),
        credentials: 'include', // 确保携带 cookie
        onResponse(ctx) {
            const data = ctx.response._data as ApiBaseResponse<T>

            // 处理 401 未授权：重置所有 store 并跳转登录页
            if (data && data.code === 401) {
                if (import.meta.client) {
                    const nuxtApp = useNuxtApp()
                    const authStore = useAuthStore()

                    // 防止重复处理
                    if (!authStore.isAuthenticated) return

                    // 清理状态
                    authStore.isAuthenticated = false

                    const currentPath = nuxtApp.$router.currentRoute.value.fullPath
                    window.location.replace(`/login?redirect=${encodeURIComponent(currentPath)}`)
                }
                return
            }
        },
        onResponseError(ctx) {
            if (!showError) return

            const data = ctx.response._data as ApiBaseResponse<T> | undefined

            // 如果响应体符合 ApiBaseResponse 格式，使用其中的错误信息
            if (data && data.success === false) {
                toast.error(data.message || '请求失败')
            } else {
                // 其他网络错误
                const message = data?.message || ctx.response.statusText || '网络请求失败，请稍后重试'
                toast.error(message)
            }
        },
    })

    // 检查业务逻辑错误（success: false）
    if (response && response.success === false) {
        // 显示错误提示
        if (showError) {
            toast.error(response.message || '请求失败')
        }
        // 返回 null 表示请求失败
        return null
    }

    // 如果用户提供了自定义 transform，先执行
    if (userTransform) {
        return userTransform(response)
    }

    // 默认提取 data 字段
    return response.data as T
}
