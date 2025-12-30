/**
 * 微信浏览器检测和授权工具函数
 */

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
