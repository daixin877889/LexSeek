/**
 * 图片代理下载 API
 *
 * POST /api/v1/proxy/image
 *
 * 通过服务端代理下载远程图片，解决浏览器跨域限制
 * 返回图片的 base64 数据
 *
 * @requirements 支持 markdown 文件中的远程图片处理
 */

import { z } from 'zod'
import { assertSafeOutboundUrl } from '~~/server/utils/outboundUrlGuard'

// 请求体验证
const bodySchema = z.object({
    /** 图片 URL */
    url: z.string().url('无效的图片 URL'),
})

/** 响应数据 */
interface ProxyImageResponse {
    /** base64 数据（不含 data:xxx;base64, 前缀） */
    base64: string
    /** MIME 类型 */
    mimeType: string
}

/** 支持的图片 MIME 类型 */
const ALLOWED_MIME_TYPES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp',
    'image/x-icon',
]

/** 最大图片大小：10MB */
const MAX_IMAGE_SIZE = 10 * 1024 * 1024

/**
 * 从 URL 推断图片 MIME 类型
 */
const inferMimeTypeFromUrl = (url: string): string => {
    const ext = url.split('.').pop()?.toLowerCase().split('?')[0] || ''
    const mimeMap: Record<string, string> = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'bmp': 'image/bmp',
        'ico': 'image/x-icon',
    }
    return mimeMap[ext] || 'image/png'
}

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 验证请求体
    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body)
    if (!bodyResult.success) {
        return resError(event, 400, bodyResult.error.issues[0]!?.message || '参数错误')
    }

    const { url } = bodyResult.data

    // SSRF 防护：拒绝指向内网/保留地址或非 http(s) 的 URL
    try {
        await assertSafeOutboundUrl(url)
    } catch (guardError) {
        return resError(event, 400, guardError instanceof Error ? guardError.message : 'URL 不被允许')
    }

    try {
        // 下载图片
        const response = await fetch(url, {
            headers: {
                // 模拟浏览器请求
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/*,*/*;q=0.8',
            },
            // 设置超时
            signal: AbortSignal.timeout(30000),
        })

        if (!response.ok) {
            return resError(event, 400, `下载图片失败: HTTP ${response.status}`)
        }

        // 检查 Content-Type
        const contentType = response.headers.get('content-type') || inferMimeTypeFromUrl(url)
        const mimeType = contentType.split(';')[0]?.trim() || 'image/png'

        // 验证是否为图片类型
        if (!ALLOWED_MIME_TYPES.some(type => mimeType.startsWith(type.split('/')[0]!))) {
            return resError(event, 400, `不支持的文件类型: ${mimeType}`)
        }

        // 检查文件大小
        const contentLength = response.headers.get('content-length')
        if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
            return resError(event, 400, '图片文件过大，最大支持 10MB')
        }

        // 读取图片数据
        const arrayBuffer = await response.arrayBuffer()

        // 再次检查实际大小
        if (arrayBuffer.byteLength > MAX_IMAGE_SIZE) {
            return resError(event, 400, '图片文件过大，最大支持 10MB')
        }

        // 转换为 base64
        const base64 = Buffer.from(arrayBuffer).toString('base64')

        const responseData: ProxyImageResponse = {
            base64,
            mimeType,
        }

        return resSuccess(event, '获取成功', responseData)
    } catch (error) {
        if (error instanceof Error) {
            if (error.name === 'AbortError' || error.name === 'TimeoutError') {
                return resError(event, 408, '下载图片超时')
            }
            logger.error('代理下载图片失败:', error.message)
        }
        return resError(event, 500, '下载图片失败')
    }
})
