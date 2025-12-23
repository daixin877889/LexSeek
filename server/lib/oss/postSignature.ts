import type {
    OssConfig,
    PostSignatureOptions,
    PostSignatureResult,
    CallbackConfig,
    PolicyConditions,
    FileKeyOptions
} from '~~/shared/types/oss'
import { randomUUID } from 'crypto'
import { createOssClient } from './client'
import {
    formatDateToUTC,
    getStandardRegion,
    getCredential,
    policy2Str,
    encodeBase64,
    getOssHost
} from './utils'

/**
 * 构建回调配置的 Base64 编码字符串
 */
function buildCallbackString(callback: CallbackConfig): string {
    const callbackObj: Record<string, string> = {
        callbackUrl: callback.callbackUrl,
        callbackBody: callback.callbackBody || 'filename=${object}&size=${size}&mimeType=${mimeType}&etag=${etag}',
        callbackBodyType: callback.callbackBodyType || 'application/x-www-form-urlencoded'
    }

    // 添加自定义回调参数
    if (callback.callbackVar) {
        for (const [key, value] of Object.entries(callback.callbackVar)) {
            callbackObj[`callbackVar.${key}`] = value
        }
    }

    return encodeBase64(JSON.stringify(callbackObj))
}

/**
 * 生成文件名
 * @param options 文件名生成选项
 * @returns 生成的文件名（不含目录）
 */
function generateFileName(options: FileKeyOptions): string {
    const { originalFileName, strategy = 'uuid' } = options

    // 提取扩展名
    const lastDotIndex = originalFileName.lastIndexOf('.')
    const ext = lastDotIndex > 0 ? originalFileName.substring(lastDotIndex) : ''

    switch (strategy) {
        case 'uuid':
            return randomUUID() + ext
        case 'timestamp':
            return Date.now().toString() + ext
        case 'original':
            return originalFileName
        default:
            return randomUUID() + ext
    }
}

/**
 * 构建策略条件数组
 */
function buildPolicyConditions(
    bucket: string,
    credential: string,
    formattedDate: string,
    securityToken?: string,
    conditions?: PolicyConditions
): Array<Record<string, any> | string[]> {
    const policyConditions: Array<Record<string, any> | string[]> = [
        { bucket },
        { 'x-oss-credential': credential },
        { 'x-oss-signature-version': 'OSS4-HMAC-SHA256' },
        { 'x-oss-date': formattedDate }
    ]

    // 添加 STS Token 条件
    if (securityToken) {
        policyConditions.push({ 'x-oss-security-token': securityToken })
    }

    // 添加文件大小限制
    if (conditions?.contentLengthRange) {
        policyConditions.push([
            'content-length-range',
            conditions.contentLengthRange[0],
            conditions.contentLengthRange[1]
        ])
    }

    // 添加文件类型限制
    // 使用 starts-with 匹配 Content-Type 前缀
    // 如果提供了多个类型，取它们的公共前缀；如果没有公共前缀，则使用空字符串（允许所有类型）
    if (conditions?.contentType && conditions.contentType.length > 0) {
        // 找出所有类型的公共前缀
        const types = conditions.contentType
        let commonPrefix = ''

        if (types.length === 1) {
            // 单个类型，使用完整类型作为前缀
            commonPrefix = types[0]
        } else {
            // 多个类型，找出公共前缀（如 image/、video/ 等）
            const firstType = types[0]
            for (let i = 0; i < firstType.length; i++) {
                const char = firstType[i]
                if (types.every(t => t[i] === char)) {
                    commonPrefix += char
                } else {
                    break
                }
            }
        }

        // 添加 starts-with 条件
        policyConditions.push(['starts-with', '$Content-Type', commonPrefix])
    }

    return policyConditions
}

/**
 * 生成客户端直传签名
 * @param config OSS 配置
 * @param options 签名选项
 * @returns 签名结果，用于前端直传
 */
export async function generatePostSignature(
    config: OssConfig,
    options: PostSignatureOptions = {}
): Promise<PostSignatureResult> {
    // 创建 OSS 客户端
    const { client, credentials } = await createOssClient(config)

    // 设置签名过期时间
    const expirationMinutes = options.expirationMinutes ?? 10
    const date = new Date()
    const expirationDate = new Date(date)
    expirationDate.setMinutes(date.getMinutes() + expirationMinutes)

    // 格式化日期
    const formattedDate = formatDateToUTC(expirationDate)
    const dateStr = formattedDate.split('T')[0]

    // 获取凭证信息
    const accessKeyId = credentials?.accessKeyId || config.accessKeyId
    const securityToken = credentials?.securityToken

    // 生成 credential
    const credential = getCredential(
        dateStr,
        getStandardRegion(config.region),
        accessKeyId
    )

    // 构建策略条件
    const policyConditions = buildPolicyConditions(
        config.bucket,
        credential,
        formattedDate,
        securityToken,
        options.conditions
    )

    // 创建策略对象
    const policy = {
        expiration: expirationDate.toISOString(),
        conditions: policyConditions
    }

    // 生成签名
    const signature = client.signPostObjectPolicyV4(policy, date)
    const policyStr = policy2Str(policy)
    const policyBase64 = encodeBase64(policyStr)

    // 构建结果
    const result: PostSignatureResult = {
        host: getOssHost(config.bucket, config.region),
        policy: policyBase64,
        signatureVersion: 'OSS4-HMAC-SHA256',
        credential,
        date: formattedDate,
        signature,
        dir: options.dir ?? ''
    }

    // 生成完整的文件路径
    if (options.fileKey) {
        const fileName = generateFileName(options.fileKey)
        result.key = (options.dir ?? '') + fileName
    }

    // 添加回调配置
    if (options.callback) {
        result.callback = buildCallbackString(options.callback)
    }

    // 添加 STS Token
    if (securityToken) {
        result.securityToken = securityToken
    }

    return result
}
