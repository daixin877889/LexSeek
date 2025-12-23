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
    const { client } = await createOssClient(config)

    // 默认过期时间 1 小时（3600 秒）
    const expires = options.expires ?? 3600
    const method = options.method ?? 'GET'

    // 构建签名选项
    const signOptions: Record<string, any> = {
        expires,
        method
    }

    // 添加响应头设置
    if (options.response) {
        if (options.response.contentType) {
            signOptions['response-content-type'] = options.response.contentType
        }
        if (options.response.contentDisposition) {
            signOptions['response-content-disposition'] = options.response.contentDisposition
        }
    }

    // 生成签名 URL
    const url = client.signatureUrl(objectPath, signOptions)

    return url
}
