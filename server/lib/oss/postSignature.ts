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
 * 自动将 callbackVar 中的变量添加到 callbackBody 中
 * 自动为没有 x: 前缀的变量添加前缀
 * 
 * 注意：OSS 回调的工作方式：
 * 1. callback JSON 中只包含 callbackUrl、callbackBody、callbackBodyType
 * 2. callbackBody 中使用 ${x:varName} 引用自定义变量
 * 3. 自定义变量的值由前端在 FormData 中传递（key 为 x:varName）
 */
function buildCallbackString(callback: CallbackConfig): { callbackBase64: string, normalizedCallbackVar?: Record<string, string> } {
    let callbackBody = callback.callbackBody || 'filename=${object}&size=${size}&mimeType=${mimeType}&etag=${etag}'

    // 标准化 callbackVar 的键名（自动添加 x: 前缀）
    let normalizedCallbackVar: Record<string, string> | undefined
    if (callback.callbackVar) {
        normalizedCallbackVar = {}
        for (const [key, value] of Object.entries(callback.callbackVar)) {
            // 如果键名没有 x: 前缀，自动添加
            const normalizedKey = key.startsWith('x:') ? key : `x:${key}`
            normalizedCallbackVar[normalizedKey] = String(value)
        }
    }

    // 自动将 callbackVar 中的变量添加到 callbackBody
    if (normalizedCallbackVar) {
        for (const key of Object.keys(normalizedCallbackVar)) {
            // 检查 callbackBody 中是否已包含该变量
            const varRef = `\${${key}}`
            if (!callbackBody.includes(varRef)) {
                // 添加变量引用到 callbackBody
                callbackBody += `&${key}=${varRef}`
            }
        }
    }

    // callback JSON 只包含基本配置，不包含自定义变量的值
    const callbackObj: Record<string, string> = {
        callbackUrl: callback.callbackUrl,
        callbackBody,
        callbackBodyType: callback.callbackBodyType || 'application/x-www-form-urlencoded'
    }

    return {
        callbackBase64: encodeBase64(JSON.stringify(callbackObj)),
        normalizedCallbackVar
    }
}

/**
 * 生成文件名
 * @param options 文件名生成选项
 * @returns 生成的文件名（不含目录）
 */
function generateFileName(options: FileKeyOptions): string {
    const { originalFileName, strategy = 'uuid', customFileName } = options

    // 自定义文件名策略
    if (strategy === 'custom') {
        if (!customFileName) {
            throw new Error('使用 custom 策略时必须提供 customFileName')
        }
        return customFileName
    }

    // 其他策略需要 originalFileName 来提取扩展名
    if (!originalFileName) {
        throw new Error('使用 uuid/timestamp/original 策略时必须提供 originalFileName')
    }

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
 * 注意：PostObject 表单上传时，自定义回调变量直接作为表单字段传递，不需要在 Policy 中声明
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

    // 先处理回调配置，获取标准化的 callbackVar
    let callbackBase64: string | undefined
    let normalizedCallbackVar: Record<string, string> | undefined
    if (options.callback) {
        const callbackResult = buildCallbackString(options.callback)
        callbackBase64 = callbackResult.callbackBase64
        normalizedCallbackVar = callbackResult.normalizedCallbackVar
    }

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
        host: getOssHost(config.bucket, config.region, config.customDomain),
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
    if (callbackBase64) {
        result.callback = callbackBase64
        // 返回标准化后的自定义变量及其 Base64 编码
        // 前端需要将 callbackVarBase64 作为 callback-var 表单字段传递
        // 根据阿里云 OSS 文档，自定义变量必须通过 callback-var 表单字段传递（Base64 编码的 JSON）
        if (normalizedCallbackVar && Object.keys(normalizedCallbackVar).length > 0) {
            result.callbackVar = normalizedCallbackVar
            result.callbackVarBase64 = encodeBase64(JSON.stringify(normalizedCallbackVar))
        }
    }

    // 添加 STS Token
    if (securityToken) {
        result.securityToken = securityToken
    }

    return result
}
