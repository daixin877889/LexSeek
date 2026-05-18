import { OssFileStatus } from '#shared/types/file'
import { createLogger } from '#shared/utils/logger'
import { updateOssFileDao } from '~~/server/services/files/ossFiles.dao'
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
        // 注：AliyunCallbackValidator 按 urlencoded 重建 body 参与验签，标准回调可无损还原；
        // verifyCallback 仅依据 config.type 选择验证器，故此处无需完整 StorageConfig
        const verifyResult = await verifyCallback(
            event,
            { type: StorageProviderType.ALIYUN_OSS } as StorageConfig,
        )
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

        const result = {
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

        if (!fileId) {
            log.error('回调缺少 fileId', { body })
            return {
                success: false,
                error: 'fileId is required'
            }
        }

        // 更新文件记录
        await updateOssFileDao(fileId, {
            status: OssFileStatus.UPLOADED,
            encrypted,
            originalMimeType: encrypted ? originalMimeType : null,
        })

        log.info('存储回调处理成功', { fileId, encrypted })

        // OSS 回调必须返回 JSON 格式，且状态码为 200
        // 返回的内容会透传给客户端
        return result
    } catch (error) {
        log.error('存储回调处理错误', { error })
        // 即使出错也返回 200，避免 OSS 报错
        return {
            success: false,
            error: 'callback processing failed'
        }
    }
})
