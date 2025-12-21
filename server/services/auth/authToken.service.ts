/**
 * 认证令牌服务
 *
 * 提供 JWT token 生成和 Cookie 设置的统一处理
 * 用于登录、注册等认证成功后的令牌管理
 */

import type { H3Event } from 'h3'

/**
 * Token 用户信息
 * 用于生成 JWT token 的用户数据
 */
export interface TokenUserInfo {
    /** 用户 ID */
    id: number
    /** 用户手机号 */
    phone: string
    /** 用户角色 */
    role: string
    /** 用户状态 */
    status: number
}

/**
 * Cookie 配置
 */
export interface CookieConfig {
    /** 是否仅 HTTP 访问 */
    httpOnly: boolean
    /** 是否仅 HTTPS 传输 */
    secure: boolean
    /** SameSite 策略 */
    sameSite: 'lax' | 'strict' | 'none'
    /** 过期时间（秒） */
    maxAge: number
}

/**
 * 获取 Cookie 配置
 *
 * 根据运行环境和配置返回适当的 Cookie 设置
 * - httpOnly: 始终为 true，防止 XSS 攻击
 * - secure: 生产环境为 true，确保仅通过 HTTPS 传输
 * - sameSite: 使用 'lax' 策略，平衡安全性和可用性
 * - maxAge: 从配置读取，默认 30 天
 *
 * @returns Cookie 配置对象
 */
export const getCookieConfig = (): CookieConfig => {
    const config = useRuntimeConfig()

    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: config.auth.cookieMaxAge,
    }
}

/**
 * 登录状态 Cookie 名称
 */
export const AUTH_STATUS_COOKIE = 'auth_status'

/**
 * 生成认证 token 并设置 Cookie
 *
 * 执行以下操作：
 * 1. 使用用户信息生成 JWT token
 * 2. 将 token 设置到 HttpOnly Cookie 中
 * 3. 设置一个非 httpOnly 的状态 cookie 供客户端判断登录状态
 *
 * @param event H3Event 对象，用于设置 Cookie
 * @param user 用户信息，包含 id、phone、role、status
 * @returns 生成的 JWT token 字符串
 */
export const generateAuthToken = (event: H3Event, user: TokenUserInfo): string => {
    const config = useRuntimeConfig()

    // 生成 JWT token
    const token = JwtUtil.generateToken({
        id: user.id,
        phone: user.phone,
        role: user.role,
        status: user.status,
    })

    // 获取 Cookie 配置
    const cookieConfig = getCookieConfig()

    // 设置 HttpOnly Cookie（用于服务端验证）
    setCookie(event, config.auth.cookieName, token, cookieConfig)

    // 设置非 httpOnly 的状态 cookie（用于客户端判断登录状态）
    setCookie(event, AUTH_STATUS_COOKIE, '1', {
        ...cookieConfig,
        httpOnly: false,
    })

    return token
}

/**
 * 清除认证 Cookie
 *
 * @param event H3Event 对象
 */
export const clearAuthCookies = (event: H3Event): void => {
    const config = useRuntimeConfig()

    // 清除 token cookie
    deleteCookie(event, config.auth.cookieName)
    // 清除状态 cookie
    deleteCookie(event, AUTH_STATUS_COOKIE)
}
