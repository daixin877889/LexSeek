/**
 * 阿里云 OSS 回调验证器
 *
 * 实现阿里云 OSS 回调签名验证和数据解析
 */

import type { H3Event } from 'h3'
import { getHeader, readBody } from 'h3'
import crypto from 'crypto'
import type { StorageConfig } from '../../types'
import type {
    CallbackHandler,
    CallbackData,
    CallbackVerifyResult,
    AliyunCallbackBody
} from '../types'

/** 公钥缓存 */
const publicKeyCache: Map<string, string> = new Map()

/**
 * 阿里云 OSS 回调验证器
 */
export class AliyunCallbackValidator implements CallbackHandler {
    /**
     * 验证回调请求签名
     */
    async verify(event: H3Event, _config: StorageConfig): Promise<CallbackVerifyResult> {
        try {
            // 获取必需的请求头
            const authorization = getHeader(event, 'authorization')
            const pubKeyUrlBase64 = getHeader(event, 'x-oss-pub-key-url')

            if (!authorization || !pubKeyUrlBase64) {
                return {
                    valid: false,
                    error: '缺少必需的回调验证头'
                }
            }

            // 解码公钥 URL
            const pubKeyUrl = Buffer.from(pubKeyUrlBase64, 'base64').toString('utf-8')

            // 验证公钥 URL 是否来自阿里云
            if (!this.isValidPubKeyUrl(pubKeyUrl)) {
                return {
                    valid: false,
                    error: '无效的公钥 URL'
                }
            }

            // 获取公钥
            const publicKey = await this.getPublicKey(pubKeyUrl)
            if (!publicKey) {
                return {
                    valid: false,
                    error: '无法获取公钥'
                }
            }

            // 构建待验证的字符串
            const path = event.path || ''
            const queryString = this.getQueryString(event)
            const body = await this.getRawBody(event)

            // 构建签名字符串
            // 格式: path + '\n' + body (如果有 query string 则为 path?query + '\n' + body)
            const stringToSign = queryString
                ? `${path}?${queryString}\n${body}`
                : `${path}\n${body}`

            // 验证签名
            const signature = Buffer.from(authorization, 'base64')
            const isValid = this.verifySignature(stringToSign, signature, publicKey)

            if (!isValid) {
                return {
                    valid: false,
                    error: '签名验证失败'
                }
            }

            return { valid: true }
        } catch (error) {
            return {
                valid: false,
                error: error instanceof Error ? error.message : '验证过程发生错误'
            }
        }
    }

    /**
     * 解析回调数据
     */
    async parse(event: H3Event): Promise<CallbackData> {
        const body = await readBody<AliyunCallbackBody>(event)

        // 提取自定义变量（以 x: 开头的字段）
        const customVars: Record<string, string> = {}
        for (const [key, value] of Object.entries(body)) {
            if (key.startsWith('x:') && value !== undefined) {
                // 移除 x: 前缀
                const varName = key.substring(2)
                customVars[varName] = String(value)
            }
        }

        return {
            filePath: body.filename,
            fileSize: typeof body.size === 'string' ? parseInt(body.size, 10) : body.size,
            mimeType: body.mimeType,
            customVars,
            rawData: body
        }
    }

    /**
     * 验证公钥 URL 是否来自阿里云
     */
    private isValidPubKeyUrl(url: string): boolean {
        // 阿里云公钥 URL 必须以这些域名开头
        const validDomains = [
            'https://gosspublic.alicdn.com/',
            'http://gosspublic.alicdn.com/',
            'https://oss-cn-',
            'http://oss-cn-'
        ]

        return validDomains.some(domain => url.startsWith(domain))
    }

    /**
     * 获取公钥（带缓存）
     */
    private async getPublicKey(url: string): Promise<string | null> {
        // 检查缓存
        const cached = publicKeyCache.get(url)
        if (cached) {
            return cached
        }

        try {
            // 从阿里云获取公钥
            const response = await fetch(url)
            if (!response.ok) {
                return null
            }

            const publicKey = await response.text()

            // 缓存公钥
            publicKeyCache.set(url, publicKey)

            return publicKey
        } catch {
            return null
        }
    }

    /**
     * 验证 RSA 签名
     */
    private verifySignature(data: string, signature: Buffer, publicKey: string): boolean {
        try {
            const verify = crypto.createVerify('RSA-MD5')
            verify.update(data)
            return verify.verify(publicKey, signature)
        } catch {
            return false
        }
    }

    /**
     * 获取查询字符串
     */
    private getQueryString(event: H3Event): string {
        const url = event.node.req.url || ''
        const queryIndex = url.indexOf('?')
        return queryIndex >= 0 ? url.substring(queryIndex + 1) : ''
    }

    /**
     * 获取原始请求体
     */
    private async getRawBody(event: H3Event): Promise<string> {
        // 尝试从已解析的 body 重建
        const body = await readBody(event)
        if (typeof body === 'string') {
            return body
        }

        // 如果是对象，转换为 URL 编码格式
        if (typeof body === 'object' && body !== null) {
            const params = new URLSearchParams()
            for (const [key, value] of Object.entries(body)) {
                if (value !== undefined && value !== null) {
                    params.append(key, String(value))
                }
            }
            return params.toString()
        }

        return ''
    }
}

/**
 * 清除公钥缓存
 */
export function clearPublicKeyCache(): void {
    publicKeyCache.clear()
}
