/**
 * 微信浏览器检测和授权工具函数
 */

/**
 * 授权回调 state 参数结构
 */
export interface AuthCallbackState {
    /** 目标重定向 URL（完整 URL） */
    targetUrl: string
    /** 可选：来源标识 */
    source?: string
}

/**
 * 检测是否在微信浏览器中
 * @returns 是否在微信浏览器中
 */
export function isWeChatBrowser(): boolean {
    // 服务端渲染时返回 false
    if (typeof window === 'undefined') return false;

    const ua = window.navigator.userAgent.toLowerCase();
    return ua.includes('micromessenger');
}

/**
 * 获取微信 OAuth 授权 URL
 * 用于在微信浏览器中获取用户 openid
 * @param redirectPath - 授权后重定向的路径（相对路径，如 /dashboard/buy/1）
 * @returns 微信授权 URL
 */
export function getWechatAuthUrl(redirectPath: string): string {
    const config = useRuntimeConfig();

    // 从 runtimeConfig 获取微信公众号 appId
    const appId = config.public.wechatAppId || '';
    const baseUrl = config.public.baseUrl || '';

    // 如果没有配置 appId，返回空字符串
    if (!appId) {
        console.warn('[wechat] 未配置微信公众号 appId');
        return '';
    }

    // 构建重定向 URI
    const redirectUri = encodeURIComponent(`${baseUrl}${redirectPath}`);

    // 构建微信 OAuth 授权 URL
    // scope=snsapi_base: 静默授权，只获取 openid
    // scope=snsapi_userinfo: 需要用户确认，可获取用户信息
    return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_base&state=STATE#wechat_redirect`;
}

/**
 * 获取微信 OAuth 授权 URL（获取用户信息）
 * @param redirectPath - 授权后重定向的路径
 * @returns 微信授权 URL
 */
export function getWechatAuthUrlWithUserInfo(redirectPath: string): string {
    const config = useRuntimeConfig();

    const appId = config.public.wechatAppId || '';
    const baseUrl = config.public.baseUrl || '';

    if (!appId) {
        console.warn('[wechat] 未配置微信公众号 appId');
        return '';
    }

    const redirectUri = encodeURIComponent(`${baseUrl}${redirectPath}`);

    // scope=snsapi_userinfo: 需要用户确认，可获取用户信息
    return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_userinfo&state=STATE#wechat_redirect`;
}

/**
 * 编码 state 参数
 * @param state state 对象
 * @returns base64 编码的字符串
 */
export function encodeAuthState(state: AuthCallbackState): string {
    return btoa(JSON.stringify(state));
}

/**
 * 解码 state 参数
 * @param encoded base64 编码的字符串
 * @returns 解码后的 state 对象，解析失败返回 null
 */
export function decodeAuthState(encoded: string): AuthCallbackState | null {
    try {
        const decoded = atob(encoded);
        const parsed = JSON.parse(decoded);

        if (!parsed.targetUrl || typeof parsed.targetUrl !== 'string') {
            return null;
        }

        return parsed as AuthCallbackState;
    } catch {
        return null;
    }
}

/**
 * 获取微信 OAuth 授权 URL（通用回调模式）
 * 支持多公众号、多环境共用同一个回调地址
 * @param targetUrl - 授权后重定向的完整目标 URL
 * @param source - 可选的来源标识
 * @returns 微信授权 URL
 */
export function getWechatAuthUrlWithCallback(targetUrl: string, source?: string): string {
    const config = useRuntimeConfig();
    const appId = config.public.wechatAppId || '';
    const authCallbackUrl = config.public.wechatAuthCallbackUrl || '';

    if (!appId) {
        console.warn('[wechat] 未配置微信公众号 appId');
        return '';
    }

    if (!authCallbackUrl) {
        console.warn('[wechat] 未配置微信授权回调地址 wechatAuthCallbackUrl');
        return '';
    }

    // 构建 state 参数（JSON + base64 编码）
    const stateObj: AuthCallbackState = { targetUrl };
    if (source) {
        stateObj.source = source;
    }
    const state = encodeAuthState(stateObj);

    // 回调地址指向通用回调接口
    const redirectUri = encodeURIComponent(authCallbackUrl);

    return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_base&state=${state}#wechat_redirect`;
}
