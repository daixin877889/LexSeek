/**
 * 将数字填充为两位字符串
 */
function padTo2Digits(num: number): string {
    return num.toString().padStart(2, '0')
}

/**
 * 格式化日期为 UTC 字符串（OSS V4 签名格式）
 * 格式: YYYYMMDDTHHMMSSZ
 */
export function formatDateToUTC(date: Date): string {
    return (
        date.getUTCFullYear().toString() +
        padTo2Digits(date.getUTCMonth() + 1) +
        padTo2Digits(date.getUTCDate()) +
        'T' +
        padTo2Digits(date.getUTCHours()) +
        padTo2Digits(date.getUTCMinutes()) +
        padTo2Digits(date.getUTCSeconds()) +
        'Z'
    )
}

/**
 * 获取标准区域名称（移除 'oss-' 前缀）
 */
export function getStandardRegion(region: string): string {
    return region.replace(/^oss-/g, '')
}

/**
 * 生成 x-oss-credential
 * 格式: accessKeyId/date/region/oss/aliyun_v4_request
 */
export function getCredential(date: string, region: string, accessKeyId: string): string {
    return `${accessKeyId}/${date}/${region}/oss/aliyun_v4_request`
}

/**
 * 将策略对象转换为 JSON 字符串
 */
export function policy2Str(policy: object): string {
    return JSON.stringify(policy)
}

/**
 * 将字符串编码为 Base64
 */
export function encodeBase64(str: string): string {
    return Buffer.from(str, 'utf8').toString('base64')
}

/**
 * 将 Base64 字符串解码
 */
export function decodeBase64(base64: string): string {
    return Buffer.from(base64, 'base64').toString('utf8')
}

/**
 * 获取 OSS 主机地址
 * @param bucket Bucket 名称
 * @param region 区域
 * @param customDomain 自定义域名（可选）
 */
export function getOssHost(bucket: string, region: string, customDomain?: string): string {
    // 如果配置了自定义域名，直接使用
    if (customDomain) {
        // 确保域名以 https:// 开头，移除末尾的斜杠
        let domain = customDomain.trim()
        if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
            domain = `https://${domain}`
        }
        return domain.replace(/\/+$/, '')
    }

    // 使用默认的 OSS 域名
    const standardRegion = getStandardRegion(region)
    return `https://${bucket}.oss-${standardRegion}.aliyuncs.com`
}
