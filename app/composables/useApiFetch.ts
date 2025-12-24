/**
 * 封装 $fetch 的 composable
 * 用于组件挂载后的事件处理函数中调用 API
 * 通过拦截器统一处理错误，使用方式与原生 $fetch 类似
 */

import type { FetchOptions } from 'ofetch'

interface UseApiFetchOptions<T> extends Omit<FetchOptions, 'onResponse' | 'onResponseError'> {
    // 是否显示错误提示（默认 true）
    showError?: boolean
    // 自定义数据转换
    transform?: (response: ApiBaseResponse<T>) => T
}

/**
 * 封装 $fetch，通过拦截器统一处理 API 错误
 * 适用于组件挂载后的事件处理函数中调用
 *
 * @param url 请求地址
 * @param options $fetch 配置选项，额外支持 showError 选项
 * @returns Promise<T> 返回 data 字段的数据
 */
export async function useApiFetch<T = unknown>(
    url: string,
    options: UseApiFetchOptions<T> = {}
): Promise<T> {
    const {
        showError = true,
        transform: userTransform,
        ...restOptions
    } = options

    const response = await $fetch<ApiBaseResponse<T>>(url, {
        ...(restOptions as Record<string, unknown>),
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

            // 处理业务逻辑错误（success: false）
            if (showError && data && data.success === false) {
                toast.error(data.message || '请求失败')
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

    // 如果用户提供了自定义 transform，先执行
    if (userTransform) {
        return userTransform(response)
    }

    // 默认提取 data 字段
    return response.data as T
}
