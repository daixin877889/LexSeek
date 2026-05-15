/**
 * MinerU 单文件回调接口（已废弃）
 *
 * POST /api/v1/callback/mineru
 *
 * 单文件回调已统一迁移到 /api/v1/callback/mineru-batch（带 checksum 签名验证）。
 * 本 handler 保留仅用于拒绝任何残留 / 伪造请求，避免无签名直写识别结果。
 */

interface CallbackResponse {
    code: string
    message: string
}

export default defineEventHandler((event): CallbackResponse => {
    logger.warn('MinerU 单文件回调：接口已废弃，拒绝处理', {
        path: getRequestURL(event).pathname,
        ip: getRequestIP(event),
    })
    return {
        code: 'FAIL',
        message: 'endpoint deprecated, use /api/v1/callback/mineru-batch',
    }
})
