/**
 * 封装 useFetch 的 composable
 * 统一处理 API 请求、错误处理和响应格式
 */

// API 错误类型
export interface ApiError {
    code: number
    message: string
    requestId?: string
}

// useApi 返回类型
export interface UseApiReturn<T> {
    data: Ref<T | null>
    error: Ref<ApiError | null>
    pending: Ref<boolean>
    refresh: () => Promise<void>
    execute: () => Promise<void>
}

// HTTP 方法类型
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

// useApi 配置选项
export interface UseApiOptions {
    method?: HttpMethod
    body?: any
    query?: Record<string, any>
    headers?: Record<string, string>
    // 是否延迟执行（默认 false，立即执行）
    lazy?: boolean
    // 是否显示错误提示（默认 true）
    showError?: boolean
}

/**
 * 封装 useFetch，统一处理 API 响应和错误
 * @param url 请求地址
 * @param options 请求配置
 */
export function useApi<T = any>(
    url: string | (() => string),
    options: UseApiOptions = {}
): UseApiReturn<T> {
    const {
        method = 'GET',
        body,
        query,
        headers,
        lazy = false,
        showError = true,
    } = options

    // 响应数据
    const data = ref<T | null>(null) as Ref<T | null>
    // 错误信息
    const error = ref<ApiError | null>(null) as Ref<ApiError | null>
    // 加载状态
    const pending = ref(false)

    // 执行请求
    const execute = async () => {
        pending.value = true
        error.value = null

        try {
            const urlValue = typeof url === 'function' ? url() : url

            const response = await $fetch<ApiBaseResponse<T>>(urlValue, {
                method,
                body,
                query,
                headers,
            })

            // 处理业务逻辑错误（success: false）
            if (response.success === false) {
                const apiError: ApiError = {
                    code: response.code,
                    message: response.message,
                    requestId: response.requestId,
                }
                error.value = apiError

                if (showError) {
                    toast.error(response.message)
                }
                return
            }

            // 请求成功
            data.value = response.data as T
        } catch (err: any) {
            // 处理网络错误或服务器错误
            // $fetch 对于非 2xx 状态码会抛出 FetchError，响应体在 err.data 中
            const responseData = err.data as ApiBaseResponse<T> | undefined

            // 如果响应体符合 ApiBaseResponse 格式，使用其中的错误信息
            if (responseData && responseData.success === false) {
                const apiError: ApiError = {
                    code: responseData.code,
                    message: responseData.message,
                    requestId: responseData.requestId,
                }
                error.value = apiError

                if (showError) {
                    toast.error(responseData.message)
                }
            } else {
                // 其他网络错误
                const apiError: ApiError = {
                    code: err.statusCode || -1,
                    message: err.data?.message || err.message || '网络请求失败，请稍后重试',
                    requestId: err.data?.requestId,
                }
                error.value = apiError

                if (showError) {
                    toast.error(apiError.message)
                }
            }
        } finally {
            pending.value = false
        }
    }

    // 刷新请求
    const refresh = async () => {
        await execute()
    }

    // 如果不是 lazy 模式，立即执行
    if (!lazy) {
        execute()
    }

    return {
        data,
        error,
        pending,
        refresh,
        execute,
    }
}

/**
 * 封装 POST 请求
 */
export function useApiPost<T = any>(
    url: string,
    body?: any,
    options: Omit<UseApiOptions, 'method' | 'body'> = {}
): UseApiReturn<T> {
    return useApi<T>(url, {
        method: 'POST',
        body,
        lazy: true,
        ...options,
    })
}

/**
 * 封装 GET 请求
 */
export function useApiGet<T = any>(
    url: string | (() => string),
    options: Omit<UseApiOptions, 'method'> = {}
): UseApiReturn<T> {
    return useApi<T>(url, {
        method: 'GET',
        ...options,
    })
}

/**
 * 封装 PUT 请求
 */
export function useApiPut<T = any>(
    url: string,
    body?: any,
    options: Omit<UseApiOptions, 'method' | 'body'> = {}
): UseApiReturn<T> {
    return useApi<T>(url, {
        method: 'PUT',
        body,
        lazy: true,
        ...options,
    })
}

/**
 * 封装 DELETE 请求
 */
export function useApiDelete<T = any>(
    url: string,
    options: Omit<UseApiOptions, 'method'> = {}
): UseApiReturn<T> {
    return useApi<T>(url, {
        method: 'DELETE',
        lazy: true,
        ...options,
    })
}
