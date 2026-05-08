/**
 * Handler 测试公共基础设施
 *
 * 用于直接 import handler default export 后调用，跳过 Nitro 路由 + middleware 全栈，
 * 聚焦于 handler 自身的鉴权 / 参数校验 / 业务分支 / 响应 shape。
 *
 * 使用方式（在测试文件最顶部）：
 * ```ts
 * import './_helpers/handler-test'  // 副作用 import：注入全局 stub
 * import { makeEvent } from './_helpers/handler-test'
 * ```
 *
 * 设计取舍：
 * - 用 globalThis 注入而非 vi.mock：handler 通过 Nitro 自动导入访问这些函数，
 *   不能用模块 mock 拦截；globalThis 注入与生产 Nitro 行为一致
 * - readValidatedBody 实际调用 validate 函数（模拟 Nitro 真实行为），
 *   保证 zod 抛错路径在测试中能跑到
 * - prisma / 业务 service 仍由测试文件用 vi.mock 单独打桩，本 helper 不碰
 */
import { vi } from 'vitest'

const resError = (_event: unknown, code: number, message: string) => ({
    code,
    success: false,
    message,
    data: null,
})

const resSuccess = (_event: unknown, message: string, data: unknown) => ({
    code: 0,
    success: true,
    message,
    data,
})

interface MockEventInternals {
    __body?: unknown
    __query?: Record<string, unknown>
    __params?: Record<string, string>
    __cookies?: Record<string, string>
    __headers?: Record<string, string>
    __responseHeaders?: Record<string, string>
    __setCookies?: Array<{ name: string; value: string; options?: unknown }>
}

;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).readValidatedBody = async (event: any, validate: any) => validate(event.__body)
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).getRouterParams = (event: any) => event.__params ?? {}
;(globalThis as any).getCookie = (event: any, name: string) => event.__cookies?.[name]
;(globalThis as any).setCookie = (event: any, name: string, value: string, options?: unknown) => {
    if (!event.__setCookies) event.__setCookies = []
    event.__setCookies.push({ name, value, options })
}
;(globalThis as any).getHeader = (event: any, name: string) => event.__headers?.[name.toLowerCase()]
;(globalThis as any).getHeaders = (event: any) => event.__headers ?? {}
;(globalThis as any).readRawBody = async (event: any) => event.__rawBody ?? null
;(globalThis as any).readMultipartFormData = async (event: any) => event.__formData ?? null
;(globalThis as any).setHeader = (event: any, name: string, value: string) => {
    if (!event.__responseHeaders) event.__responseHeaders = {}
    event.__responseHeaders[name] = value
}
;(globalThis as any).setResponseHeaders = (event: any, headers: Record<string, string>) => {
    if (!event.__responseHeaders) event.__responseHeaders = {}
    Object.assign(event.__responseHeaders, headers)
}
;(globalThis as any).setResponseHeader = (event: any, name: string, value: string) => {
    if (!event.__responseHeaders) event.__responseHeaders = {}
    event.__responseHeaders[name] = value
}
;(globalThis as any).getRequestURL = (event: any) =>
    new URL(event.__url ?? 'http://localhost/api/v1/test')
;(globalThis as any).getRequestIP = (event: any) => event.__ip ?? '127.0.0.1'
;(globalThis as any).setResponseStatus = (event: any, code: number) => {
    event.__responseStatus = code
}
;(globalThis as any).createError = (opts: any) => {
    const err: any = new Error(opts?.message ?? opts?.statusMessage ?? 'error')
    err.statusCode = opts?.statusCode ?? 500
    err.statusMessage = opts?.statusMessage ?? err.message
    err.data = opts?.data
    return err
}
;(globalThis as any).useRuntimeConfig = () => ({
    auth: {
        cookieName: 'test_token',
        jwtSecret: 'test_secret',
        expiresIn: '7d',
    },
    public: { baseUrl: 'http://localhost:3000' },
    oss: { region: 'cn-shanghai', bucket: 'test', baseUrl: 'https://oss.test', accessKeyId: '', accessKeySecret: '' },
    storage: {
        aliyunOss: { region: 'cn-shanghai', bucket: 'test-bucket', accessKeyId: 'AK', accessKeySecret: 'SK' },
        basePath: 'lexseek/',
        callbackUrl: 'https://api.test/callback',
    },
    wechatPay: { notifyUrl: 'https://api.test/wxpay/notify' },
    weChatPay: {},
    aliyun: {
        sms: {
            rateLimitMs: 60,    // 秒，handler 会乘 1000
            codeExpireMs: 300,
            enable: false,
        },
    },
    wechat: {
        authRedirectWhitelist: 'https://app.test',
    },
})
;(globalThis as any).logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}
;(globalThis as any).useStorage = () => ({
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
    getKeys: vi.fn().mockResolvedValue([]),
})

// 服务端 utils 中常用全局——server/utils/password.ts 与 server/utils/jwt.ts 默认导出 + named
;(globalThis as any).generatePassword = vi.fn(async (pw: string) => `hashed:${pw}`)
;(globalThis as any).comparePassword = vi.fn(async (pw: string, hashed: string) =>
    hashed === `hashed:${pw}` || hashed === pw,
)
;(globalThis as any).generateUniqueInviteCode = vi.fn(async () => 'INV1234')
;(globalThis as any).JwtUtil = {
    verifyToken: vi.fn((_token: string) => ({ exp: Math.floor(Date.now() / 1000) + 86400 })),
    signToken: vi.fn(() => 'mock_token'),
}
;(globalThis as any).md5 = vi.fn((s: string) => `md5:${s}`)
;(globalThis as any).sendRedirect = vi.fn(async (_event: any, url: string, code = 302) => ({ __redirect: url, __code: code }))
;(globalThis as any).generateSmsCode = vi.fn(() => '123456')
;(globalThis as any).AliSms = {
    sendCaptchaSms: vi.fn(async () => ({ ok: true })),
}

export interface MakeEventOpts {
    userId?: number | null
    roles?: number[]
    body?: unknown
    query?: Record<string, unknown>
    params?: Record<string, string>
    cookies?: Record<string, string>
    headers?: Record<string, string>
    token?: string
    url?: string
    ip?: string
}

export interface MockEvent extends MockEventInternals {
    context: {
        auth?: { user?: { id: number; phone?: string; roles?: number[]; exp?: number; status?: number }; token?: string }
        isPublicApi?: boolean
        requestId?: string
    }
    __url?: string
    __ip?: string
    __responseStatus?: number
}

export function makeEvent(opts: MakeEventOpts = {}): MockEvent {
    return {
        context: opts.userId
            ? {
                auth: {
                    user: {
                        id: opts.userId,
                        phone: '13000000000',
                        roles: opts.roles ?? [1],
                        status: 1,
                        exp: Math.floor(Date.now() / 1000) + 86400,
                    },
                    token: opts.token,
                },
                requestId: 'test-req-1',
            }
            : { requestId: 'test-req-1' },
        __body: opts.body,
        __query: opts.query,
        __params: opts.params,
        __cookies: opts.cookies,
        __headers: opts.headers
            ? Object.fromEntries(Object.entries(opts.headers).map(([k, v]) => [k.toLowerCase(), v]))
            : undefined,
        __url: opts.url,
        __ip: opts.ip,
    }
}

/** 通用响应断言：检查业务状态码 */
export function expectSuccess(res: any, dataMatcher?: (d: any) => void) {
    if (!res?.success) {
        throw new Error(`expected success, got code=${res?.code} message=${res?.message}`)
    }
    if (dataMatcher) dataMatcher(res.data)
    return res.data
}

export function expectError(res: any, code: number, messagePart?: string) {
    if (res?.success) {
        throw new Error(`expected error code=${code}, got success`)
    }
    if (res?.code !== code) {
        throw new Error(`expected code=${code}, got ${res?.code} (${res?.message})`)
    }
    if (messagePart && !String(res.message ?? '').includes(messagePart)) {
        throw new Error(`expected message containing "${messagePart}", got "${res.message}"`)
    }
}
