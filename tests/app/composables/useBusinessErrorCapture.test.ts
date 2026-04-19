/**
 * useBusinessErrorCapture 单元测试
 *
 * 目的：把三个 callsite（auth.login / auth.sendSmsCode / useContractReview.onRebuildDocx）
 * 里重复的 `let bizCode / businessErrorMessage` + onBusinessError 闭包赋值套路抽象成
 * 带类型的 composable，避免 `as any` 强转。
 */

import { describe, it, expect } from 'vitest'
import { useBusinessErrorCapture } from '~/composables/useBusinessErrorCapture'

describe('useBusinessErrorCapture', () => {
    it('初始状态：code / message / data 均为 null', () => {
        const c = useBusinessErrorCapture()
        expect(c.code.value).toBeNull()
        expect(c.message.value).toBeNull()
        expect(c.data.value).toBeNull()
    })

    it('onBusinessError 应把完整响应写入 code / message / data', () => {
        const c = useBusinessErrorCapture<{ retryAfterSec: number }>()
        c.onBusinessError({
            success: false,
            code: 429,
            message: '频率过高',
            data: { retryAfterSec: 60 },
        } as any)
        expect(c.code.value).toBe(429)
        expect(c.message.value).toBe('频率过高')
        expect(c.data.value).toEqual({ retryAfterSec: 60 })
    })

    it('message 不存在时回落为 null', () => {
        const c = useBusinessErrorCapture()
        c.onBusinessError({ success: false, code: 500 } as any)
        expect(c.code.value).toBe(500)
        expect(c.message.value).toBeNull()
        expect(c.data.value).toBeNull()
    })

    it('reset 应清空 code / message / data', () => {
        const c = useBusinessErrorCapture()
        c.onBusinessError({ success: false, code: 500, message: 'x', data: 1 } as any)
        c.reset()
        expect(c.code.value).toBeNull()
        expect(c.message.value).toBeNull()
        expect(c.data.value).toBeNull()
    })

    it('多次 onBusinessError 应以最后一次为准', () => {
        const c = useBusinessErrorCapture()
        c.onBusinessError({ success: false, code: 400, message: 'a' } as any)
        c.onBusinessError({ success: false, code: 500, message: 'b' } as any)
        expect(c.code.value).toBe(500)
        expect(c.message.value).toBe('b')
    })
})
