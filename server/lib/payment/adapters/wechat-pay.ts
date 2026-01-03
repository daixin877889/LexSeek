/**
 * 微信支付适配器
 *
 * 实现微信支付 V3 API 的各种支付方式
 */
import { createHash, createSign, createVerify, createDecipheriv } from 'crypto'
import { PaymentChannel, PaymentMethod } from '#shared/types/payment'
import { BasePaymentAdapter } from '../base'
import type { WechatPayConfig, CreatePaymentParams, PaymentResult, CallbackData, CallbackVerifyResult, QueryOrderParams, QueryOrderResult, CloseOrderParams, CloseOrderResult } from '../types'
import { PaymentConfigError, PaymentRequestError, PaymentSignatureError, PaymentMethodNotSupportedError } from '../errors'

/** 微信支付 API 基础地址 */
const WECHAT_PAY_API_BASE = 'https://api.mch.weixin.qq.com'

/** 微信支付适配器 */
export class WechatPayAdapter extends BasePaymentAdapter<WechatPayConfig> {
    /** 验证配置 */
    protected validateConfig(): void {
        const { appId, mchId, apiV3Key, serialNo, privateKey } = this.config
        if (!appId || !mchId || !apiV3Key || !serialNo || !privateKey) {
            throw new PaymentConfigError('微信支付配置不完整')
        }
    }

    /** 获取支付渠道 */
    getChannel(): PaymentChannel {
        return PaymentChannel.WECHAT
    }

    /** 获取支持的支付方式 */
    getSupportedMethods(): PaymentMethod[] {
        return [
            PaymentMethod.MINI_PROGRAM,
            PaymentMethod.SCAN_CODE,
            PaymentMethod.WAP,
            PaymentMethod.APP,
        ]
    }

    /** 创建支付 */
    async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
        const { method } = params

        // 检查支付方式是否支持
        if (!this.getSupportedMethods().includes(method)) {
            throw new PaymentMethodNotSupportedError(method)
        }

        switch (method) {
            case PaymentMethod.MINI_PROGRAM:
                return this.createJsapiPayment(params)
            case PaymentMethod.SCAN_CODE:
                return this.createNativePayment(params)
            case PaymentMethod.WAP:
                return this.createH5Payment(params)
            case PaymentMethod.APP:
                return this.createAppPayment(params)
            default:
                throw new PaymentMethodNotSupportedError(method)
        }
    }

    /** 创建 JSAPI 支付（小程序/公众号） */
    private async createJsapiPayment(params: CreatePaymentParams): Promise<PaymentResult> {
        const { orderNo, amount, description, openid, notifyUrl, attach, expireMinutes = 30 } = params

        if (!openid) {
            return { success: false, errorMessage: '小程序支付需要提供 openid' }
        }

        // 截断描述，微信支付限制最多 127 字节
        const truncatedDesc = this.truncateDescription(description)

        const requestBody: Record<string, unknown> = {
            appid: String(this.config.appId),
            mchid: String(this.config.mchId),
            description: truncatedDesc,
            out_trade_no: orderNo,
            notify_url: notifyUrl,
            time_expire: this.getExpireTime(expireMinutes),
            amount: { total: amount, currency: 'CNY' },
            payer: { openid },
        }

        // 只在 attach 有值时添加
        if (attach) {
            requestBody.attach = attach
        }

        try {
            const response = await this.request<{ prepay_id: string }>(
                'POST',
                '/v3/pay/transactions/jsapi',
                requestBody
            )

            // 生成小程序调起支付的参数
            const paymentParams = this.generateJsapiPayParams(response.prepay_id)

            return {
                success: true,
                prepayId: response.prepay_id,
                paymentParams,
            }
        } catch (error) {
            logger.error('创建 JSAPI 支付失败：', error)
            return {
                success: false,
                errorMessage: error instanceof Error ? error.message : '创建支付失败',
            }
        }
    }

    /** 创建 Native 支付（扫码） */
    private async createNativePayment(params: CreatePaymentParams): Promise<PaymentResult> {
        const { orderNo, amount, description, notifyUrl, attach, expireMinutes = 30 } = params

        // 截断描述，微信支付限制最多 127 字节
        const truncatedDesc = this.truncateDescription(description)

        const requestBody: Record<string, unknown> = {
            appid: String(this.config.appId),
            mchid: String(this.config.mchId),
            description: truncatedDesc,
            out_trade_no: orderNo,
            notify_url: notifyUrl,
            time_expire: this.getExpireTime(expireMinutes),
            amount: { total: amount, currency: 'CNY' },
        }

        // 只在 attach 有值时添加
        if (attach) {
            requestBody.attach = attach
        }

        try {
            const response = await this.request<{ code_url: string }>(
                'POST',
                '/v3/pay/transactions/native',
                requestBody
            )

            return {
                success: true,
                codeUrl: response.code_url,
            }
        } catch (error) {
            logger.error('创建 Native 支付失败：', error)
            return {
                success: false,
                errorMessage: error instanceof Error ? error.message : '创建支付失败',
            }
        }
    }

    /** 创建 H5 支付 */
    private async createH5Payment(params: CreatePaymentParams): Promise<PaymentResult> {
        const { orderNo, amount, description, notifyUrl, attach, expireMinutes = 30 } = params

        // 截断描述，微信支付限制最多 127 字节
        const truncatedDesc = this.truncateDescription(description)

        const requestBody: Record<string, unknown> = {
            appid: String(this.config.appId),
            mchid: String(this.config.mchId),
            description: truncatedDesc,
            out_trade_no: orderNo,
            notify_url: notifyUrl,
            time_expire: this.getExpireTime(expireMinutes),
            amount: { total: amount, currency: 'CNY' },
            scene_info: {
                payer_client_ip: '127.0.0.1',
                h5_info: { type: 'Wap' },
            },
        }

        // 只在 attach 有值时添加
        if (attach) {
            requestBody.attach = attach
        }

        try {
            const response = await this.request<{ h5_url: string }>(
                'POST',
                '/v3/pay/transactions/h5',
                requestBody
            )

            return {
                success: true,
                h5Url: response.h5_url,
            }
        } catch (error) {
            logger.error('创建 H5 支付失败：', error)
            return {
                success: false,
                errorMessage: error instanceof Error ? error.message : '创建支付失败',
            }
        }
    }

    /** 创建 APP 支付 */
    private async createAppPayment(params: CreatePaymentParams): Promise<PaymentResult> {
        const { orderNo, amount, description, notifyUrl, attach, expireMinutes = 30 } = params

        // 截断描述，微信支付限制最多 127 字节
        const truncatedDesc = this.truncateDescription(description)

        const requestBody: Record<string, unknown> = {
            appid: String(this.config.appId),
            mchid: String(this.config.mchId),
            description: truncatedDesc,
            out_trade_no: orderNo,
            notify_url: notifyUrl,
            time_expire: this.getExpireTime(expireMinutes),
            amount: { total: amount, currency: 'CNY' },
        }

        // 只在 attach 有值时添加
        if (attach) {
            requestBody.attach = attach
        }

        try {
            const response = await this.request<{ prepay_id: string }>(
                'POST',
                '/v3/pay/transactions/app',
                requestBody
            )

            // 生成 APP 调起支付的参数
            const paymentParams = this.generateAppPayParams(response.prepay_id)

            return {
                success: true,
                prepayId: response.prepay_id,
                paymentParams,
            }
        } catch (error) {
            logger.error('创建 APP 支付失败：', error)
            return {
                success: false,
                errorMessage: error instanceof Error ? error.message : '创建支付失败',
            }
        }
    }

    /** 验证回调 */
    async verifyCallback(data: CallbackData): Promise<CallbackVerifyResult> {
        try {
            const { raw, signature, timestamp, nonce, serial } = data

            // 验证签名
            if (!signature || !timestamp || !nonce) {
                return { success: false, errorMessage: '回调参数不完整' }
            }

            const body = typeof raw === 'string' ? raw : JSON.stringify(raw)
            const message = `${timestamp}\n${nonce}\n${body}\n`

            // 使用微信支付平台证书验证签名
            const isValid = this.verifySignature(message, signature)
            if (!isValid) {
                return { success: false, errorMessage: '签名验证失败' }
            }

            // 解密回调数据
            const callbackBody = typeof raw === 'string' ? JSON.parse(raw) : raw
            const resource = (callbackBody as { resource: { ciphertext: string; nonce: string; associated_data: string } }).resource
            const decrypted = this.decryptCallback(resource.ciphertext, resource.nonce, resource.associated_data)
            const result = JSON.parse(decrypted) as {
                out_trade_no: string
                transaction_id: string
                amount: { total: number }
                success_time: string
                payer: { openid: string }
                attach?: string
            }

            return {
                success: true,
                orderNo: result.out_trade_no,
                transactionId: result.transaction_id,
                amount: result.amount.total,
                paidAt: new Date(result.success_time),
                openid: result.payer.openid,
                attach: result.attach,
            }
        } catch (error) {
            logger.error('验证回调失败：', error)
            return {
                success: false,
                errorMessage: error instanceof Error ? error.message : '验证回调失败',
            }
        }
    }

    /** 查询订单 */
    async queryOrder(params: QueryOrderParams): Promise<QueryOrderResult> {
        const { orderNo, transactionId } = params

        try {
            let url: string
            if (transactionId) {
                url = `/v3/pay/transactions/id/${transactionId}?mchid=${this.config.mchId}`
            } else if (orderNo) {
                url = `/v3/pay/transactions/out-trade-no/${orderNo}?mchid=${this.config.mchId}`
            } else {
                return { success: false, errorMessage: '需要提供订单号或交易号' }
            }

            const response = await this.request<{
                trade_state: 'SUCCESS' | 'NOTPAY' | 'CLOSED' | 'REFUND' | 'PAYERROR'
                out_trade_no: string
                transaction_id: string
                amount: { total: number }
                success_time?: string
            }>('GET', url)

            return {
                success: true,
                tradeState: response.trade_state,
                orderNo: response.out_trade_no,
                transactionId: response.transaction_id,
                amount: response.amount.total,
                paidAt: response.success_time ? new Date(response.success_time) : undefined,
            }
        } catch (error) {
            logger.error('查询订单失败：', error)
            return {
                success: false,
                errorMessage: error instanceof Error ? error.message : '查询订单失败',
            }
        }
    }

    /** 关闭订单 */
    async closeOrder(params: CloseOrderParams): Promise<CloseOrderResult> {
        const { orderNo } = params

        try {
            await this.request(
                'POST',
                `/v3/pay/transactions/out-trade-no/${orderNo}/close`,
                { mchid: String(this.config.mchId) }
            )

            return { success: true }
        } catch (error) {
            logger.error('关闭订单失败：', error)
            return {
                success: false,
                errorMessage: error instanceof Error ? error.message : '关闭订单失败',
            }
        }
    }

    /** 发送请求 */
    private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
        const fullUrl = `${WECHAT_PAY_API_BASE}${url}`
        const timestamp = this.getTimestamp()
        const nonceStr = this.generateNonceStr()
        const bodyStr = body ? JSON.stringify(body) : ''

        // 生成签名
        const signature = this.generateSignature(method, url, timestamp, nonceStr, bodyStr)
        const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${this.config.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${this.config.serialNo}"`

        // 调试日志：打印请求信息
        logger.debug('微信支付请求：', {
            url: fullUrl,
            method,
            body: bodyStr,
            authorization: authorization.substring(0, 100) + '...',
        })

        try {
            const response = await $fetch<T>(fullUrl, {
                method: method as 'GET' | 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': authorization,
                },
                body: body ? bodyStr : undefined,
            })

            return response as T
        } catch (error: unknown) {
            // 尝试获取微信支付 API 返回的详细错误信息
            const fetchError = error as {
                data?: { code?: string; message?: string; detail?: { field?: string; value?: string; issue?: string; location?: string }[] }
                response?: { _data?: unknown }
            }

            // 打印完整的错误信息
            if (fetchError.data) {
                logger.error('微信支付 API 错误响应：', JSON.stringify(fetchError.data, null, 2))
            }
            if (fetchError.response?._data) {
                logger.error('微信支付 API 响应数据：', JSON.stringify(fetchError.response._data, null, 2))
            }

            throw error
        }
    }

    /** 生成签名 */
    private generateSignature(method: string, url: string, timestamp: number, nonceStr: string, body: string): string {
        const message = `${method}\n${url}\n${timestamp}\n${nonceStr}\n${body}\n`
        const sign = createSign('RSA-SHA256')
        sign.update(message)
        return sign.sign(this.config.privateKey, 'base64')
    }

    /** 验证签名 */
    private verifySignature(message: string, signature: string): boolean {
        if (!this.config.platformCert) {
            // 如果没有配置平台证书，暂时跳过验证（生产环境必须配置）
            logger.warn('未配置微信支付平台证书，跳过签名验证')
            return true
        }

        const verify = createVerify('RSA-SHA256')
        verify.update(message)
        return verify.verify(this.config.platformCert, signature, 'base64')
    }

    /** 解密回调数据 */
    private decryptCallback(ciphertext: string, nonce: string, associatedData: string): string {
        const key = this.config.apiV3Key
        const ciphertextBuffer = Buffer.from(ciphertext, 'base64')
        const authTag = ciphertextBuffer.subarray(ciphertextBuffer.length - 16)
        const data = ciphertextBuffer.subarray(0, ciphertextBuffer.length - 16)

        const decipher = createDecipheriv('aes-256-gcm', key, nonce)
        decipher.setAuthTag(authTag)
        decipher.setAAD(Buffer.from(associatedData))

        const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
        return decrypted.toString('utf8')
    }

    /** 生成 JSAPI 支付参数 */
    private generateJsapiPayParams(prepayId: string): Record<string, unknown> {
        const timestamp = this.getTimestamp().toString()
        const nonceStr = this.generateNonceStr()
        const packageStr = `prepay_id=${prepayId}`

        const message = `${this.config.appId}\n${timestamp}\n${nonceStr}\n${packageStr}\n`
        const sign = createSign('RSA-SHA256')
        sign.update(message)
        const paySign = sign.sign(this.config.privateKey, 'base64')

        return {
            appId: this.config.appId,  // 微信 JSAPI 支付需要 appId
            timeStamp: timestamp,
            nonceStr,
            package: packageStr,
            signType: 'RSA',
            paySign,
        }
    }

    /** 生成 APP 支付参数 */
    private generateAppPayParams(prepayId: string): Record<string, unknown> {
        const timestamp = this.getTimestamp().toString()
        const nonceStr = this.generateNonceStr()

        const message = `${this.config.appId}\n${timestamp}\n${nonceStr}\n${prepayId}\n`
        const sign = createSign('RSA-SHA256')
        sign.update(message)
        const paySign = sign.sign(this.config.privateKey, 'base64')

        return {
            appid: this.config.appId,
            partnerid: this.config.mchId,
            prepayid: prepayId,
            package: 'Sign=WXPay',
            noncestr: nonceStr,
            timestamp,
            sign: paySign,
        }
    }

    /** 截断描述（微信支付限制最多 127 字节） */
    private truncateDescription(description: string): string {
        const maxBytes = 127
        let result = ''
        let byteLength = 0

        for (const char of description) {
            // 中文字符占 3 字节，其他字符占 1 字节
            const charBytes = char.charCodeAt(0) > 127 ? 3 : 1
            if (byteLength + charBytes > maxBytes) {
                break
            }
            result += char
            byteLength += charBytes
        }

        return result
    }

    /** 获取过期时间（RFC 3339 格式） */
    private getExpireTime(minutes: number): string {
        const expireDate = new Date(Date.now() + minutes * 60 * 1000)
        // 微信支付要求 RFC 3339 格式，例如：2018-06-08T10:34:56+08:00
        // 使用 toISOString() 获取 UTC 时间，然后转换为北京时间
        const year = expireDate.getFullYear()
        const month = String(expireDate.getMonth() + 1).padStart(2, '0')
        const day = String(expireDate.getDate()).padStart(2, '0')
        const hours = String(expireDate.getHours()).padStart(2, '0')
        const mins = String(expireDate.getMinutes()).padStart(2, '0')
        const secs = String(expireDate.getSeconds()).padStart(2, '0')

        return `${year}-${month}-${day}T${hours}:${mins}:${secs}+08:00`
    }
}
