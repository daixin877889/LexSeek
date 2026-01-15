/**
 * MinerU 文件上传代理 API
 *
 * POST /api/v1/recognition/mineru/upload
 *
 * 通过服务端代理上传文件到 MinerU OSS，避免浏览器 CORS 限制
 *
 * @requirements 2.1
 */

import { z } from 'zod'

/** 请求体验证 Schema */
const bodySchema = z.object({
    /** MinerU 上传 URL */
    uploadUrl: z.string().url('uploadUrl 必须是有效的 URL'),
    /** 文件内容（Base64 编码） */
    fileContent: z.string().min(1, '文件内容不能为空'),
    /** 文件名 */
    fileName: z.string().min(1, '文件名不能为空'),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 验证请求体
    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body)
    if (!bodyResult.success) {
        return resError(event, 400, bodyResult.error.issues[0]?.message || '参数错误')
    }

    const { uploadUrl, fileContent, fileName } = bodyResult.data

    try {
        // 将 Base64 转换为 Buffer
        const buffer = Buffer.from(fileContent, 'base64')

        // 使用 PUT 方法上传到 MinerU OSS
        // 注意：不能设置 Content-Type，因为 MinerU 的签名是基于空 Content-Type 计算的
        const response = await $fetch.raw(uploadUrl, {
            method: 'PUT',
            body: buffer,
        })

        if (response.status !== 200) {
            logger.error('上传到 MinerU 失败:', {
                status: response.status,
                statusText: response.statusText,
            })
            return resError(event, 500, `上传到 MinerU 失败: ${response.status}`)
        }

        logger.info('文件上传到 MinerU 成功', {
            userId: user.id,
            fileName,
        })

        return resSuccess(event, '上传成功', { success: true })
    } catch (error) {
        logger.error('上传到 MinerU 失败:', error)
        return resError(event, 500, '上传到 MinerU 失败')
    }
})
