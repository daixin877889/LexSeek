/**
 * 出站 URL 安全网关（SSRF 防护）
 *
 * 服务端代理/抓取外部 URL 前必须经此校验，拒绝指向 loopback、内网、
 * link-local（含云厂商 metadata 169.254.169.254）等保留地址的请求。
 */
import { lookup } from 'node:dns/promises'
import net from 'node:net'

const REJECT_RESERVED = 'URL 指向内网或保留地址，已拒绝'

/** 判断 IPv4 是否属于内网/保留段 */
function isBlockedIPv4(ip: string): boolean {
    const parts = ip.split('.').map(Number)
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
        return true
    }
    const [a, b] = parts as [number, number, number, number]
    if (a === 0 || a === 127) return true             // 当前网络 / loopback
    if (a === 10) return true                          // 私网 A
    if (a === 172 && b >= 16 && b <= 31) return true   // 私网 B
    if (a === 192 && b === 168) return true            // 私网 C
    if (a === 169 && b === 254) return true            // link-local + 云 metadata
    if (a === 100 && b >= 64 && b <= 127) return true  // 运营商级 NAT
    if (a >= 224) return true                          // 组播 + 保留段
    return false
}

/** 判断 IPv6 是否属于内网/保留段 */
function isBlockedIPv6(ip: string): boolean {
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '::') return true                 // loopback / 未指定
    if (lower.startsWith('fe80')) return true                          // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true  // 唯一本地地址
    const mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (mapped) return isBlockedIPv4(mapped[1]!)                        // IPv4-mapped
    return false
}

/** 判断单个 IP 是否禁止访问 */
export function isBlockedIp(ip: string): boolean {
    if (net.isIPv4(ip)) return isBlockedIPv4(ip)
    if (net.isIPv6(ip)) return isBlockedIPv6(ip)
    return true   // 无法识别的地址保守拒绝
}

/** 主机名 DNS 解析函数类型（默认用 node:dns，测试可注入） */
export type HostResolver = (host: string) => Promise<string[]>

/** 默认解析器：解析主机名的全部 A/AAAA 记录 */
async function defaultHostResolver(host: string): Promise<string[]> {
    const records = await lookup(host, { all: true })
    return records.map((record) => record.address)
}

/**
 * 校验出站 URL 安全性：协议受限 + 主机不得解析到内网/保留地址。
 * 不安全时抛错。
 */
export async function assertSafeOutboundUrl(
    rawUrl: string,
    resolveHost: HostResolver = defaultHostResolver,
): Promise<void> {
    let url: URL
    try {
        url = new URL(rawUrl)
    } catch {
        throw new Error('无效的 URL')
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('仅允许 http/https 协议')
    }

    // IPv6 字面量在 URL.hostname 中带方括号（如 [::1]），剥离后才能被 net.isIP 识别
    const host = url.hostname.replace(/^\[|\]$/g, '')
    // 主机名本身是 IP 字面量：直接判断
    if (net.isIP(host)) {
        if (isBlockedIp(host)) throw new Error(REJECT_RESERVED)
        return
    }

    // 域名：解析所有 A/AAAA 记录，任一落在保留段即拒绝
    let addresses: string[]
    try {
        addresses = await resolveHost(host)
    } catch {
        throw new Error('域名解析失败')
    }
    if (addresses.length === 0) {
        throw new Error('域名解析失败')
    }
    for (const address of addresses) {
        if (isBlockedIp(address)) throw new Error(REJECT_RESERVED)
    }
}
