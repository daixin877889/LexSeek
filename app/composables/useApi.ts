/**
 * 封装 useFetch 的 composable
 * 通过拦截器统一处理错误，使用方式与原生 useFetch 一致
 */

interface UseApiOptions {
    // 是否显示错误提示（默认 true）
    showError?: boolean
}

/**
 * 封装 useFetch，通过拦截器统一处理 API 错误
 * 使用方式与原生 useFetch 完全一致
 *
 * @param url 请求地址
 * @param options useFetch 配置选项，额外支持 showError 选项
 */
export function useApi<T = any>(
    url: string | (() => string) | Ref<string>,
    options: Parameters<typeof useFetch>[1] & UseApiOptions = {}
) {
    const {
        showError = true,
        onResponse: userOnResponse,
        onResponseError: userOnResponseError,
        transform: userTransform,
        ...restOptions
    } = options as any

    return useFetch(url, {
        ...restOptions,
        // 响应拦截器：处理业务逻辑错误
        onResponse(ctx: any) {
            const data = ctx.response._data as ApiBaseResponse<T>

            // 处理 401 未授权：重置所有 store 并跳转登录页
            if (data && data.code === 401) {
                // 仅在客户端执行
                if (import.meta.client) {
                    // 通过 nuxtApp 获取 pinia 和路由
                    const nuxtApp = useNuxtApp()

                    // 重置所有 store（传入 pinia 实例）
                    // const pinia = nuxtApp.$pinia
                    // resetAllStore(pinia)

                    // 使用 window.location 强制跳转（确保在非 setup 上下文中生效）
                    const currentPath = nuxtApp.$router.currentRoute.value.fullPath
                    window.location.replace(`/login?redirect=${encodeURIComponent(currentPath)}`)
                }
                return
            }

            // 处理业务逻辑错误（success: false）
            if (showError && data && data.success === false) {
                toast.error(data.message || '请求失败')
            }

            // 调用用户自定义的 onResponse
            if (typeof userOnResponse === 'function') {
                userOnResponse(ctx)
            }
        },
        // 响应错误拦截器：处理网络错误或服务器错误
        onResponseError(ctx: any) {
            if (!showError) {
                // 调用用户自定义的 onResponseError
                if (typeof userOnResponseError === 'function') {
                    userOnResponseError(ctx)
                }
                return
            }

            const data = ctx.response._data as ApiBaseResponse<T> | undefined

            // 如果响应体符合 ApiBaseResponse 格式，使用其中的错误信息
            if (data && data.success === false) {
                toast.error(data.message || '请求失败')
            } else {
                // 其他网络错误
                const message = data?.message || ctx.response.statusText || '网络请求失败，请稍后重试'
                toast.error(message)
            }

            // 调用用户自定义的 onResponseError
            if (typeof userOnResponseError === 'function') {
                userOnResponseError(ctx)
            }
        },
        // 提取 data 字段作为返回数据
        transform: (response: any): T => {
            // 如果用户提供了自定义 transform，先执行
            if (userTransform) {
                return userTransform(response)
            }
            // 默认提取 data 字段
            return (response as ApiBaseResponse<T>).data as T
        },
    }) as ReturnType<typeof useFetch<T>>
}
