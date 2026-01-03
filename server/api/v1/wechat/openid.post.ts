/**
 * 获取微信 OpenID 接口
 *
 * 使用微信授权 code 换取用户 OpenID
 */

import { z } from 'zod'

// 请求参数验证
const requestSchema = z.object({
    code: z.string().min(1, 'code 不能为空')
})

export default defineEventHandler(async (event) => {
    // 解析请求体
    const body = await readBody(event)

    // 参数验证
    const result = requestSchema.safeParse(body)
    if (!result.success) {
        const errorMessage = result.error.issues[0]?.message || '参数错误'
        return resError(event, 400, errorMessage)
    }

    const { code } = result.data

    try {
        // 调用微信服务获取 OpenID
        const { openid, unionid } = await getMpOpenid(code)

        return resSuccess(event, '获取成功', {
            openid,
            unionid
        })
    } catch (error) {
        logger.error('获取微信 OpenID 失败', {
            code,
            error: error instanceof Error ? error.message : String(error)
        })

        const message = error instanceof Error ? error.message : '获取 OpenID 失败'
        return resError(event, 500, message)
    }
})
