/**
 * 出站 URL 安全网关测试（SSRF 防护）
 *
 * **Feature: ssrf-outbound-url-guard**
 */
import { describe, it, expect } from 'vitest'

import { assertSafeOutboundUrl, isBlockedIp } from '~~/server/utils/outboundUrlGuard'

describe('isBlockedIp - 内网/保留地址判断', () => {
    it.each([
        '127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255',
        '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
        '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1',
    ])('拒绝保留地址 %s', (ip) => {
        expect(isBlockedIp(ip)).toBe(true)
    })

    it.each(['1.2.3.4', '8.8.8.8', '172.15.0.1', '172.32.0.1', '93.184.216.34'])(
        '放行公网地址 %s',
        (ip) => {
            expect(isBlockedIp(ip)).toBe(false)
        },
    )
})

describe('assertSafeOutboundUrl - 出站 URL 校验', () => {
    it('拒绝非 http/https 协议', async () => {
        await expect(assertSafeOutboundUrl('ftp://example.com/x')).rejects.toThrow('协议')
    })

    it('拒绝无效 URL', async () => {
        await expect(assertSafeOutboundUrl('not a url')).rejects.toThrow()
    })

    it('拒绝指向 loopback 的 URL', async () => {
        await expect(assertSafeOutboundUrl('http://127.0.0.1/x')).rejects.toThrow()
    })

    it('拒绝指向云 metadata 的 URL', async () => {
        await expect(
            assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data/'),
        ).rejects.toThrow()
    })

    it('拒绝 IPv6 loopback', async () => {
        await expect(assertSafeOutboundUrl('http://[::1]:8080/x')).rejects.toThrow()
    })

    it('放行解析到公网地址的域名', async () => {
        await expect(
            assertSafeOutboundUrl('https://example.com/img.png', async () => ['93.184.216.34']),
        ).resolves.toBeUndefined()
    })

    it('拒绝解析到内网地址的域名（DNS rebinding 防护）', async () => {
        await expect(
            assertSafeOutboundUrl('https://evil.example.com/x', async () => ['10.0.0.1']),
        ).rejects.toThrow()
    })
})
