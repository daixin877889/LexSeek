// @ts-ignore
import OSS from 'ali-oss'
import type { OssConfig, OssClientInstance, StsCredentials } from '~~/shared/types/oss'
import { validateConfig } from './validator'
import { OssStsError } from './errors'
import { getStandardRegion } from './utils'

/** STS 凭证缓存，key 为 accessKeyId:roleArn:roleSessionName */
const stsCredentialsCache = new Map<string, StsCredentials>()

/** 凭证到期前提前刷新的时间窗口（毫秒） */
const STS_REFRESH_BUFFER_MS = 5 * 60 * 1000

function isStsSocketError(message: string): boolean {
    return (
        message.includes('socket connection was closed') ||
        message.includes('ECONNRESET') ||
        message.includes('ECONNREFUSED') ||
        message.includes('socket hang up')
    )
}

/**
 * 使用 STS 获取临时凭证，内置缓存和 socket 错误重试
 */
async function getStsCredentials(config: OssConfig): Promise<StsCredentials> {
    if (!config.sts) {
        throw new OssStsError('STS configuration is required')
    }

    const stsConfig = config.sts
    const cacheKey = `${config.accessKeyId}:${config.accessKeySecret}:${stsConfig.roleArn}:${stsConfig.roleSessionName || 'oss-session'}`
    const cached = stsCredentialsCache.get(cacheKey)
    if (cached && cached.expiration.getTime() - Date.now() > STS_REFRESH_BUFFER_MS) {
        return cached
    }

    const sts = new OSS.STS({
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret
    })

    const doAssumeRole = async (): Promise<StsCredentials> => {
        const result = await sts.assumeRole(
            stsConfig.roleArn,
            '',
            stsConfig.durationSeconds?.toString() || '3600',
            stsConfig.roleSessionName || 'oss-session'
        )
        return {
            accessKeyId: result.credentials.AccessKeyId,
            accessKeySecret: result.credentials.AccessKeySecret,
            securityToken: result.credentials.SecurityToken,
            expiration: new Date(result.credentials.Expiration)
        }
    }

    try {
        let credentials: StsCredentials
        try {
            credentials = await doAssumeRole()
        } catch (err: any) {
            // socket 被服务端关闭属于瞬态网络错误，重试一次
            if (isStsSocketError(err?.message || '')) {
                credentials = await doAssumeRole()
            } else {
                throw err
            }
        }
        stsCredentialsCache.set(cacheKey, credentials)
        return credentials
    } catch (error: any) {
        throw new OssStsError(`Failed to assume role: ${error.message}`)
    }
}

/**
 * 创建 OSS 客户端实例
 * 如果配置了 STS，会自动获取临时凭证
 * @param config OSS 配置
 * @param useCname 是否使用自定义域名（用于生成签名 URL）
 */
export async function createOssClient(config: OssConfig, useCname: boolean = false): Promise<OssClientInstance> {
    validateConfig(config)

    let credentials: StsCredentials | undefined
    let clientConfig: any

    if (config.sts) {
        credentials = await getStsCredentials(config)
        clientConfig = {
            bucket: config.bucket,
            region: `oss-${getStandardRegion(config.region)}`,
            accessKeyId: credentials.accessKeyId,
            accessKeySecret: credentials.accessKeySecret,
            stsToken: credentials.securityToken,
            refreshSTSTokenInterval: 0
        }
    } else {
        clientConfig = {
            bucket: config.bucket,
            region: `oss-${getStandardRegion(config.region)}`,
            accessKeyId: config.accessKeyId,
            accessKeySecret: config.accessKeySecret
        }
    }

    if (useCname && config.customDomain) {
        const endpoint = config.customDomain
            .replace(/^https?:\/\//, '')
            .replace(/\/$/, '')
        clientConfig.endpoint = endpoint
        clientConfig.cname = true
        clientConfig.secure = true
        delete clientConfig.region
    }

    const client = new OSS(clientConfig)

    return {
        client,
        config,
        credentials
    }
}
