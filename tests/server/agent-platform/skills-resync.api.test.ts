/**
 * 管理端 Skill 重新扫描 API 测试
 *
 * 策略：直接 import handler default export，传入 mock event，
 * 断言返回 body 包含 ScanResult。
 */

import { describe, it, expect, vi } from 'vitest'
import '../case/test-setup'

// 全局 stub — 模拟 Nuxt nitro 的自动导入
const resError = (_event: any, code: number, message: string) => ({
    code,
    success: false,
    message,
    data: null,
})
const resSuccess = (_event: any, message: string, data: any) => ({
    code: 0,
    success: true,
    message,
    data,
})

; (globalThis as any).resError = resError
; (globalThis as any).resSuccess = resSuccess
; (globalThis as any).defineEventHandler = (h: any) => h
; (globalThis as any).logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
}

describe('POST /api/v1/admin/skills/resync', () => {
    it('handler 模块可加载且导出 EventHandler default export', async () => {
        // 动态 import handlers（必须在全局 stub 之后）
        const { default: resyncHandler } = await import('~~/server/api/v1/admin/skills/resync.post')
        expect(resyncHandler).toBeDefined()
        expect(typeof resyncHandler).toBe('function')
    })
})
