import type { OssConfig } from '~~/shared/types/oss'
import { OssConfigError } from './errors'

/**
 * 必需的配置字段
 */
const REQUIRED_FIELDS: (keyof OssConfig)[] = [
    'accessKeyId',
    'accessKeySecret',
    'bucket',
    'region'
]

/**
 * 验证 OSS 配置完整性
 * @param config OSS 配置对象
 * @throws OssConfigError 当缺少必需字段时抛出
 */
export function validateConfig(config: Partial<OssConfig>): asserts config is OssConfig {
    const missingFields: string[] = []

    for (const field of REQUIRED_FIELDS) {
        if (!config[field]) {
            missingFields.push(field)
        }
    }

    if (missingFields.length > 0) {
        throw new OssConfigError(
            `Missing required config field: ${missingFields.join(', ')}`
        )
    }

    // 验证 region 格式（可选的 oss- 前缀 + 区域名）
    const regionPattern = /^(oss-)?[a-z]+-[a-z0-9]+$/
    if (!regionPattern.test(config.region!)) {
        throw new OssConfigError(`Invalid region format: ${config.region}`)
    }

    // 如果提供了 STS 配置，验证 roleArn 格式
    if (config.sts) {
        const arnPattern = /^acs:ram::\d+:role\/[\w-]+$/
        if (!arnPattern.test(config.sts.roleArn)) {
            throw new OssConfigError('Invalid STS role ARN format')
        }
    }
}
