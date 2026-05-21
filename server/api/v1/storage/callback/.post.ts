import { createLogger } from '#shared/utils/logger'
import { confirmOssFileByStorageCallbackService } from '~~/server/services/files/ossFileVerify.service'
import { verifyCallback } from '~~/server/lib/storage/callback'
import { StorageProviderType } from '~~/server/lib/storage/types'
import type { StorageConfig } from '~~/server/lib/storage/types'
/**
 * 通用存储回调处理 API
 *
 * 处理阿里云 OSS 等存储服务的上传回调
 * 路由: POST /api/v1/storage/callback
 * 
 * 注意：此接口已在认证中间件白名单中，无需鉴权
 */

export default defineEventHandler(async (event) => {
    const log = createLogger('storage-callback')

    try {
        // 验签：确认回调确实来自阿里云 OSS，拒绝未授权的伪造请求
        // 注：AliyunCallbackValidator 按 urlencoded 重建 body 参与验签，标准回调可无损还原
        const ossConfig = useRuntimeConfig().storage.aliyunOss
        const storageConfig: StorageConfig = {
            type: StorageProviderType.ALIYUN_OSS,
            name: 'aliyun-oss',
            bucket: ossConfig.bucket,
            region: ossConfig.region,
            enabled: true,
            accessKeyId: ossConfig.accessKeyId,
            accessKeySecret: ossConfig.accessKeySecret,
        }
        const verifyResult = await verifyCallback(event, storageConfig)
        if (!verifyResult.valid) {
            log.warn('存储回调验签失败，拒绝处理', { error: verifyResult.error })
            return { success: false, error: 'callback verification failed' }
        }

        // 获取 OSS 回调的 body（application/x-www-form-urlencoded 格式）
        const body = await readBody(event)

        log.debug('存储回调数据', { body })

        // 解析回调变量（阿里云 OSS 自定义变量以 x: 开头）
        const fileId = Number(body?.['x:file_id'])
        const encrypted = body?.['x:encrypted'] === '1'
        const originalMimeType = body?.['x:original_mime_type'] || ''

        if (!fileId) {
            log.error('回调缺少 fileId', { body })
            return { success: false, error: 'fileId is required' }
        }

        // 核对回调声明的对象路径、上传用户与登记记录一致，并条件更新（仅 PENDING，防回调重放）
        const confirmResult = await confirmOssFileByStorageCallbackService({
            fileId,
            filePath: String(body?.filename ?? ''),
            userId: Number(body?.['x:user_id']),
            encrypted,
            originalMimeType: encrypted ? originalMimeType : null,
        })
        if (!confirmResult.ok) {
            log.warn('存储回调核对未通过，拒绝处理', { fileId, reason: confirmResult.reason })
            return { success: false, error: `callback rejected: ${confirmResult.reason}` }
        }

        log.info('存储回调处理成功', { fileId, encrypted })

        // OSS 回调必须返回 JSON 格式，且状态码为 200；返回内容会透传给客户端
        return {
            success: true,
            filename: body?.filename || '',
            size: body?.size || 0,
            mimeType: body?.mimeType || '',
            fileId,
            userId: body?.['x:user_id'] || '',
            source: body?.['x:source'] || '',
            originalFileName: body?.['x:original_file_name'] || '',
            encrypted,
            originalMimeType: encrypted ? originalMimeType : null,
        }
    } catch (error) {
        log.error('存储回调处理错误', { error })
        // 即使出错也返回 200，避免 OSS 报错
        return {
            success: false,
            error: 'callback processing failed'
        }
    }
})
