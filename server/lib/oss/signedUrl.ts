import type { OssConfig, SignedUrlOptions } from '~~/shared/types/oss'
import { createOssClient } from './client'

/**
 * 生成私有文件的签名 URL
 * @param config OSS 配置
 * @param objectPath 文件路径
 * @param options URL 选项
 * @returns 带签名的 URL
 */
export async function generateSignedUrl(
    config: OssConfig,
    objectPath: string,
    options: SignedUrlOptions = {}
): Promise<string> {
    // 如果配置了自定义域名，使用 cname 模式创建客户端
    const useCname = !!config.customDomain
    const { client, credentials } = await createOssClient(config, useCname)

    // 默认过期时间 1 小时（3600 秒）
    const expires = options.expires ?? 3600
    const method = options.method ?? 'GET'

    // 构建签名选项
    // 注意：ali-oss 的 signatureUrl 要求 response-* 头放在 `response` 子对象里，
    // 子 key 用不带 `response-` 前缀的标准 HTTP 头名（`content-disposition` / `content-type`），
    // ali-oss 会自动加前缀拼到 URL 查询串。
    // 此前顶层平铺成 `response-content-disposition` 会被 signatureUrl 静默丢弃，
    // 导致 OSS 返回的 Content-Disposition 为空，浏览器只能退回用 URL 最后一段当文件名。
    const signOptions: Record<string, any> = {
        expires,
        method
    }

    if (options.response) {
        const responseHeaders: Record<string, string> = {}
        if (options.response.contentType) {
            responseHeaders['content-type'] = options.response.contentType
        }
        if (options.response.contentDisposition) {
            responseHeaders['content-disposition'] = options.response.contentDisposition
        }
        if (Object.keys(responseHeaders).length > 0) {
            signOptions.response = responseHeaders
        }
    }

    // 生成签名 URL
    // ali-oss 的 signatureUrl 方法会将 signOptions 中的 response-* 参数添加到 URL 查询字符串中
    let url = client.signatureUrl(objectPath, signOptions)

    // 如果使用 STS 临时凭证，需要手动添加 security-token 参数
    // ali-oss 的 signatureUrl 方法在某些版本可能不会自动添加
    if (credentials?.securityToken && !url.includes('security-token')) {
        const separator = url.includes('?') ? '&' : '?'
        url = `${url}${separator}security-token=${encodeURIComponent(credentials.securityToken)}`
    }

    return url
}
