/**
 * 微信授权回调接口
 *
 * 通用授权回调，支持多公众号、多环境共用同一个回调地址
 * 微信授权完成后会携带 code 和 state 参数回调到此接口
 * 接口解析 state 参数获取目标 URL，并携带 code 参数重定向
 */

/** state 参数结构 */
interface AuthCallbackState {
    /** 目标重定向 URL（完整 URL） */
    targetUrl: string
    /** 可选：来源标识 */
    source?: string
}

/**
 * 解析 state 参数
 * @param state base64 编码的 JSON 字符串
 * @returns 解析后的 state 对象，解析失败返回 null
 */
function parseState(state: string): AuthCallbackState | null {
    try {
        const decoded = Buffer.from(state, 'base64').toString('utf-8')
        const parsed = JSON.parse(decoded)

        // 验证必要字段
        if (!parsed.targetUrl || typeof parsed.targetUrl !== 'string') {
            return null
        }

        return parsed as AuthCallbackState
    } catch {
        return null
    }
}

/**
 * 验证目标 URL 是否在白名单中
 * @param targetUrl 目标 URL
 * @param whitelist 白名单（逗号分隔的域名列表）
 * @returns 是否在白名单中
 */
function isUrlInWhitelist(targetUrl: string, whitelist: string): boolean {
    if (!whitelist) {
        logger.warn('未配置授权回调白名单')
        return false
    }

    try {
        const url = new URL(targetUrl)
        const origin = url.origin
        const allowedOrigins = whitelist.split(',').map(s => s.trim()).filter(Boolean)

        // 严格匹配 origin，不使用 startsWith 避免子域名绕过
        return allowedOrigins.includes(origin)
    } catch {
        return false
    }
}

/**
 * 将 code 参数附加到目标 URL
 * @param targetUrl 目标 URL
 * @param code 微信授权 code
 * @returns 附加 code 参数后的 URL
 */
function appendCodeToUrl(targetUrl: string, code: string): string {
    const url = new URL(targetUrl)
    url.searchParams.set('code', code)
    return url.toString()
}

export default defineEventHandler(async (event) => {
    const query = getQuery(event)
    const code = query.code as string | undefined
    const state = query.state as string | undefined

    // 验证必要参数
    if (!code) {
        logger.warn('微信授权回调缺少 code 参数')
        return resError(event, 400, '授权失败：缺少 code 参数')
    }

    if (!state) {
        logger.warn('微信授权回调缺少 state 参数')
        return resError(event, 400, '授权失败：缺少 state 参数')
    }

    // 解析 state 参数
    const stateObj = parseState(state)
    if (!stateObj) {
        logger.warn('微信授权回调 state 参数解析失败', { state })
        return resError(event, 400, '授权失败：state 参数无效')
    }

    // 获取白名单配置
    const config = useRuntimeConfig()
    const whitelist = config.wechat.authRedirectWhitelist

    // 验证目标 URL 是否在白名单中
    if (!isUrlInWhitelist(stateObj.targetUrl, whitelist)) {
        logger.warn('微信授权回调目标 URL 不在白名单中', {
            targetUrl: stateObj.targetUrl,
            whitelist
        })
        return resError(event, 403, '授权失败：重定向地址不在允许范围内')
    }

    // 构建重定向 URL
    const redirectUrl = appendCodeToUrl(stateObj.targetUrl, code)

    logger.info('微信授权回调成功，重定向到目标页面', {
        targetUrl: stateObj.targetUrl,
        source: stateObj.source,
        hasCode: !!code
    })

    // 302 重定向
    return sendRedirect(event, redirectUrl, 302)
})
