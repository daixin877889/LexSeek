/**
 * 封装 useFetch 的 composable
 * 通过拦截器统一处理错误，使用方式与原生 useFetch 一致
 */

interface UseApiOptions {
    /** 是否显示错误提示（默认 true） */
    showError?: boolean
}

/**
 * 封装 useFetch，通过拦截器统一处理 API 错误
 * 使用方式与原生 useFetch 完全一致
 *
 * 当 API 返回 success: false 时：
 * - 自动显示错误 toast（除非 showError: false）
 * - error 会包含错误信息，可用于判断请求是否成功
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
        async onResponse(ctx: any) {
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
            if (data && data.success === false) {
                // 显示错误提示
                if (showError) {
                    toast.error(data.message || '请求失败')
                }

                // 标记响应为业务错误，通过 _data 传递错误标记
                // 注意：Response.ok 是只读属性，不能直接修改
                ctx.response._data = {
                    ...data,
                    _isBusinessError: true,
                }

                // 抛出错误让 useFetch 的 error 能够捕获
                throw createError({
                    statusCode: data.code || 400,
                    statusMessage: data.message || '请求失败',
                    data: ctx.response._data,
                })
            }

            // 调用用户自定义的 onResponse
            if (typeof userOnResponse === 'function') {
                userOnResponse(ctx)
            }
        },
        // 响应错误拦截器：处理网络错误或服务器错误
        onResponseError(ctx: any) {
            const data = ctx.response._data as (ApiBaseResponse<T> & { _isBusinessError?: boolean }) | undefined

            // 如果是业务错误，已经在 onResponse 中处理过了
            if (data?._isBusinessError) {
                if (typeof userOnResponseError === 'function') {
                    userOnResponseError(ctx)
                }
                return
            }

            if (!showError) {
                if (typeof userOnResponseError === 'function') {
                    userOnResponseError(ctx)
                }
                return
            }

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
