/**
 * 微信支付 Composable
 *
 * 封装微信 JSAPI 支付相关逻辑：
 * - 微信环境检测
 * - OpenID 获取和缓存
 * - JSAPI 支付调用
 */

import { isWeChatBrowser, getWechatAuthUrlWithCallback } from '~/utils/wechat'

/** JSAPI 支付参数 */
export interface WechatPaymentParams {
    appId: string
    timeStamp: string
    nonceStr: string
    package: string
    signType: string
    paySign: string
}

/** JSAPI 支付结果 */
export type WechatPaymentResult = 'ok' | 'cancel' | 'fail'

/** OpenID 存储键名 */
const OPENID_STORAGE_KEY = 'wechat_openid'

/** OpenID 有效期（毫秒），默认 24 小时 */
const OPENID_EXPIRE_MS = 24 * 60 * 60 * 1000

/** 存储的 OpenID 结构 */
interface StoredOpenId {
    openid: string
    timestamp: number
}

/** WeixinJSBridge 类型声明 */
declare global {
    interface Window {
        WeixinJSBridge?: {
            invoke: (
                api: string,
                params: Record<string, unknown>,
                callback: (res: { err_msg: string }) => void
            ) => void
        }
    }
}

/**
 * 微信支付 Composable
 */
export function useWechatPayment() {
    const config = useRuntimeConfig()
    const route = useRoute()
    // const toast = useToast()

    /** 是否在微信浏览器中 */
    const isInWechat = computed(() => isWeChatBrowser())

    /** 当前 OpenID */
    const openId = ref<string | null>(null)

    /** 是否正在获取 OpenID */
    const isGettingOpenId = ref(false)

    /**
     * 从 sessionStorage 获取缓存的 OpenID
     */
    function getCachedOpenId(): string | null {
        if (typeof window === 'undefined') return null

        try {
            const stored = sessionStorage.getItem(OPENID_STORAGE_KEY)
            if (!stored) return null

            const data: StoredOpenId = JSON.parse(stored)

            // 检查是否过期
            if (Date.now() - data.timestamp > OPENID_EXPIRE_MS) {
                sessionStorage.removeItem(OPENID_STORAGE_KEY)
                return null
            }

            return data.openid
        } catch {
            return null
        }
    }

    /**
     * 缓存 OpenID 到 sessionStorage
     */
    function cacheOpenId(id: string): void {
        if (typeof window === 'undefined') return

        const data: StoredOpenId = {
            openid: id,
            timestamp: Date.now()
        }
        sessionStorage.setItem(OPENID_STORAGE_KEY, JSON.stringify(data))
    }

    /**
     * 使用 code 获取 OpenID
     */
    async function fetchOpenId(code: string): Promise<string | null> {
        isGettingOpenId.value = true

        try {
            const result = await useApiFetch<{ openid: string; unionid?: string }>(
                '/api/v1/wechat/openid',
                {
                    method: 'POST',
                    body: { code }
                }
            )

            if (result?.openid) {
                openId.value = result.openid
                cacheOpenId(result.openid)
                return result.openid
            }

            return null
        } catch (error) {
            console.error('[wechat] 获取 OpenID 失败:', error)
            return null
        } finally {
            isGettingOpenId.value = false
        }
    }

    /**
     * 确保获取 OpenID
     * 如果缓存中有则直接返回，否则检查 URL 中的 code 参数
     * 如果都没有则返回 null，调用方需要触发授权
     */
    async function ensureOpenId(): Promise<string | null> {
        // 1. 检查缓存
        const cached = getCachedOpenId()
        if (cached) {
            openId.value = cached
            return cached
        }

        // 2. 检查 URL 中的 code 参数
        const code = route.query.code as string | undefined
        if (code) {
            const id = await fetchOpenId(code)
            if (id) {
                // 清除 URL 中的 code 参数
                const newQuery = { ...route.query }
                delete newQuery.code
                navigateTo({ query: newQuery }, { replace: true })
                return id
            }
        }

        return null
    }

    /**
     * 重定向到微信授权页面
     * @param targetPath 授权后重定向的路径（可选，默认当前页面）
     */
    function redirectToAuth(targetPath?: string): void {
        const baseUrl = config.public.baseUrl || window.location.origin
        const path = targetPath || route.fullPath
        const targetUrl = `${baseUrl}${path}`

        const authUrl = getWechatAuthUrlWithCallback(targetUrl, 'jsapi_payment')

        if (!authUrl) {
            toast.error('微信授权配置错误')
            return
        }

        window.location.href = authUrl
    }

    /**
     * 等待 WeixinJSBridge 就绪
     */
    function waitForWeixinJSBridge(): Promise<void> {
        return new Promise((resolve) => {
            if (window.WeixinJSBridge) {
                resolve()
            } else {
                document.addEventListener('WeixinJSBridgeReady', () => resolve(), { once: true })
            }
        })
    }

    /**
     * 调用 JSAPI 支付
     * @param params 支付参数
     * @returns 支付结果
     */
    async function invokeJsapiPay(params: WechatPaymentParams): Promise<WechatPaymentResult> {
        if (!isInWechat.value) {
            console.warn('[wechat] 非微信浏览器环境，无法调用 JSAPI 支付')
            return 'fail'
        }

        // 等待 WeixinJSBridge 就绪
        await waitForWeixinJSBridge()

        return new Promise((resolve) => {
            window.WeixinJSBridge!.invoke(
                'getBrandWCPayRequest',
                {
                    appId: params.appId,
                    timeStamp: params.timeStamp,
                    nonceStr: params.nonceStr,
                    package: params.package,
                    signType: params.signType,
                    paySign: params.paySign
                },
                (res) => {
                    const errMsg = res.err_msg || ''

                    if (errMsg === 'get_brand_wcpay_request:ok') {
                        resolve('ok')
                    } else if (errMsg === 'get_brand_wcpay_request:cancel') {
                        resolve('cancel')
                    } else {
                        console.error('[wechat] JSAPI 支付失败:', errMsg)
                        resolve('fail')
                    }
                }
            )
        })
    }

    // 初始化时尝试从缓存获取 OpenID
    onMounted(() => {
        const cached = getCachedOpenId()
        if (cached) {
            openId.value = cached
        }
    })

    return {
        /** 是否在微信浏览器中 */
        isInWechat,
        /** 当前 OpenID */
        openId,
        /** 是否正在获取 OpenID */
        isGettingOpenId,
        /** 确保获取 OpenID */
        ensureOpenId,
        /** 重定向到微信授权页面 */
        redirectToAuth,
        /** 调用 JSAPI 支付 */
        invokeJsapiPay
    }
}
