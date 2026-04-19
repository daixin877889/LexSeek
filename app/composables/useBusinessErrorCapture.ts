/**
 * useBusinessErrorCapture
 *
 * 用途：配合 `useApiFetch.onBusinessError` 回调，在 await 之后根据业务错误码
 * （如 429 / 500）做分支处理时捕获完整响应。
 *
 * 为什么存在：项目里至少有 3 处 callsite（auth.login、auth.sendSmsCode、
 * useContractReview.onRebuildDocx）需要「业务错误码区分」，原先用 `let bizCode = null`
 * + 手写 setter 闭包；其中一个还因为泛型推导卡壳不得不 `as any`。抽象后三方共享
 * 同一套类型化 API，避免重复代码和类型裸奔。
 *
 * 用法：
 * ```ts
 * const capture = useBusinessErrorCapture<{ retryAfterSec: number }>()
 * const data = await useApiFetch<LoginResult>(url, {
 *     method: 'POST',
 *     body,
 *     showError: false,
 *     onBusinessError: capture.onBusinessError,
 * })
 * if (!data) {
 *     if (capture.code.value === 429) { ... }
 *     return { success: false, message: capture.message.value, retryAfterSec: capture.data.value?.retryAfterSec ?? null }
 * }
 * ```
 */

import { ref, type Ref } from 'vue'
import type { ApiBaseResponse } from '#shared/utils/apiResponse'

export interface BusinessErrorCapture<T = unknown> {
    /** 业务错误码，未触发时为 null */
    readonly code: Ref<number | null>
    /** 业务错误消息，未触发或缺省时为 null */
    readonly message: Ref<string | null>
    /** 业务错误附带的 data 载荷，未触发或缺省时为 null */
    readonly data: Ref<T | null>
    /** 传给 useApiFetch.onBusinessError 的回调 */
    onBusinessError: (response: ApiBaseResponse<T>) => void
    /** 复用 capture 前调用，清理上一次的残留状态 */
    reset: () => void
}

export function useBusinessErrorCapture<T = unknown>(): BusinessErrorCapture<T> {
    const code = ref<number | null>(null)
    const message = ref<string | null>(null)
    const data = ref<T | null>(null) as Ref<T | null>

    return {
        code,
        message,
        data,
        onBusinessError: (response) => {
            code.value = response.code
            message.value = response.message ?? null
            data.value = (response.data ?? null) as T | null
        },
        reset: () => {
            code.value = null
            message.value = null
            data.value = null
        },
    }
}
