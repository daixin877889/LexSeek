/**
 * 微信服务
 *
 * 提供微信公众号相关功能：
 * - 使用授权码获取用户 OpenID
 */

/** 微信 API 基础响应 */
interface WechatBaseResult {
    errcode?: number
    errmsg?: string
}

/** 微信 OAuth 响应 */
interface WechatAccessTokenResult extends WechatBaseResult {
    access_token: string
    expires_in: number
    refresh_token?: string
    openid: string
    scope: string
    unionid?: string
}

/**
 * 使用授权码获取用户 OpenID
 * @param code 微信授权 code
 * @returns openid 和 unionid
 */
export async function getMpOpenid(code: string): Promise<{
    openid: string
    unionid?: string
}> {
    const config = useRuntimeConfig()
    const appId = config.public.wechatAppId
    const secret = config.wechat.mpSecret

    if (!appId || !secret) {
        logger.error('微信公众号配置不完整', { hasAppId: !!appId, hasSecret: !!secret })
        throw new Error('微信公众号配置不完整')
    }

    const url = 'https://api.weixin.qq.com/sns/oauth2/access_token'
    const params = new URLSearchParams({
        appid: appId,
        secret: secret,
        code: code,
        grant_type: 'authorization_code'
    })

    logger.debug('请求微信公众号 OpenID', { appid: appId, code })

    try {
        const rawResponse = await $fetch<WechatAccessTokenResult | string>(`${url}?${params.toString()}`)

        // 处理可能的双重序列化问题（微信 API 有时返回的 Content-Type 不标准）
        let response: WechatAccessTokenResult
        if (typeof rawResponse === 'string') {
            try {
                response = JSON.parse(rawResponse)
            } catch {
                logger.error('微信 API 响应解析失败', { rawResponse })
                throw new Error('微信 API 响应格式错误')
            }
        } else {
            response = rawResponse
        }

        logger.debug('微信 API 响应', { response })

        // 检查微信返回的错误
        if (response.errcode) {
            logger.error('微信 API 返回错误', {
                errcode: response.errcode,
                errmsg: response.errmsg,
                code
            })
            throw new Error(`获取 OpenID 失败: ${response.errmsg}`)
        }

        // 检查返回数据是否包含必要字段
        if (!response.openid) {
            logger.error('微信返回数据缺少 openid 字段', { response })
            throw new Error('微信返回数据缺少 openid 字段')
        }

        logger.info('获取微信公众号 OpenID 成功', {
            openid: response.openid ? '已获取' : '未获取',
            scope: response.scope,
            unionid: response.unionid ? '已获取' : '未获取'
        })

        return {
            openid: response.openid,
            unionid: response.unionid
        }
    } catch (error) {
        // 如果是已知错误，直接抛出
        if (error instanceof Error && error.message.includes('获取 OpenID 失败')) {
            throw error
        }

        logger.error('获取微信 OpenID 失败', {
            code,
            error: error instanceof Error ? error.message : String(error)
        })

        throw new Error('获取微信 OpenID 失败，请重新授权')
    }
}
