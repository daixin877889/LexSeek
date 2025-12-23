// @ts-ignore
import OSS from 'ali-oss'
import type { OssConfig, OssClientInstance, StsCredentials } from '~~/shared/types/oss'
import { validateConfig } from './validator'
import { OssStsError } from './errors'
import { getStandardRegion } from './utils'

/**
 * 使用 STS 获取临时凭证
 */
async function getStsCredentials(config: OssConfig): Promise<StsCredentials> {
    if (!config.sts) {
        throw new OssStsError('STS configuration is required')
    }

    const sts = new OSS.STS({
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret
    })

    try {
        // assumeRole 参数顺序: roleArn, policy, expirationSeconds, sessionName
        // policy 传空字符串表示使用角色默认权限
        const result = await sts.assumeRole(
            config.sts.roleArn,
            '',  // policy - 空字符串使用角色默认权限
            config.sts.durationSeconds?.toString() || '3600',
            config.sts.roleSessionName || 'oss-session'
        )

        return {
            accessKeyId: result.credentials.AccessKeyId,
            accessKeySecret: result.credentials.AccessKeySecret,
            securityToken: result.credentials.SecurityToken,
            expiration: new Date(result.credentials.Expiration)
        }
    } catch (error: any) {
        throw new OssStsError(`Failed to assume role: ${error.message}`)
    }
}

/**
 * 创建 OSS 客户端实例
 * 如果配置了 STS，会自动获取临时凭证
 */
export async function createOssClient(config: OssConfig): Promise<OssClientInstance> {
    // 验证配置
    validateConfig(config)

    let credentials: StsCredentials | undefined
    let clientConfig: any

    if (config.sts) {
        // 使用 STS 获取临时凭证
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
        // 直接使用 AK/SK
        clientConfig = {
            bucket: config.bucket,
            region: `oss-${getStandardRegion(config.region)}`,
            accessKeyId: config.accessKeyId,
            accessKeySecret: config.accessKeySecret
        }
    }

    const client = new OSS(clientConfig)

    return {
        client,
        config,
        credentials
    }
}
