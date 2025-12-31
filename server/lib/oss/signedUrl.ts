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
    const signOptions: Record<string, any> = {
        expires,
        method
    }

    // 添加响应头设置（作为 URL 查询参数）
    if (options.response) {
        if (options.response.contentType) {
            signOptions['response-content-type'] = options.response.contentType
        }
        if (options.response.contentDisposition) {
            signOptions['response-content-disposition'] = options.response.contentDisposition
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
