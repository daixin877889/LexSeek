/**
 * 支付错误定义
 */

/** 支付错误基类 */
export class PaymentError extends Error {
    /** 错误码 */
    code: string
    /** 原始错误 */
    cause?: Error

    constructor(message: string, code: string, cause?: Error) {
        super(message)
        this.name = 'PaymentError'
        this.code = code
        this.cause = cause
    }
}

/** 配置错误 */
export class PaymentConfigError extends PaymentError {
    constructor(message: string, cause?: Error) {
        super(message, 'CONFIG_ERROR', cause)
        this.name = 'PaymentConfigError'
    }
}

/** 签名错误 */
export class PaymentSignatureError extends PaymentError {
    constructor(message: string, cause?: Error) {
        super(message, 'SIGNATURE_ERROR', cause)
        this.name = 'PaymentSignatureError'
    }
}

/** 请求错误 */
export class PaymentRequestError extends PaymentError {
    /** HTTP 状态码 */
    statusCode?: number
    /** 响应数据 */
    response?: unknown

    constructor(message: string, statusCode?: number, response?: unknown, cause?: Error) {
        super(message, 'REQUEST_ERROR', cause)
        this.name = 'PaymentRequestError'
        this.statusCode = statusCode
        this.response = response
    }
}

/** 回调验证错误 */
export class PaymentCallbackError extends PaymentError {
    constructor(message: string, cause?: Error) {
        super(message, 'CALLBACK_ERROR', cause)
        this.name = 'PaymentCallbackError'
    }
}

/** 订单不存在错误 */
export class PaymentOrderNotFoundError extends PaymentError {
    constructor(orderNo: string) {
        super(`订单不存在: ${orderNo}`, 'ORDER_NOT_FOUND')
        this.name = 'PaymentOrderNotFoundError'
    }
}

/** 不支持的支付方式错误 */
export class PaymentMethodNotSupportedError extends PaymentError {
    constructor(method: string) {
        super(`不支持的支付方式: ${method}`, 'METHOD_NOT_SUPPORTED')
        this.name = 'PaymentMethodNotSupportedError'
    }
}
