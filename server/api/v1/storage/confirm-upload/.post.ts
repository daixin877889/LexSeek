/**
 * 用户端：OSS 上传后兜底校验接口
 *
 * 当 OSS 直传成功但 LexSeek callback 处理失败时，前端调用本接口由后端 head OSS
 * 直接核对实际状态。详见 docs/superpowers/specs/2026-05-08-oss-callback-fallback-design.md
 */
import { z } from '#shared/utils/zod'
import { createLogger } from '#shared/utils/logger'
import { verifyAndFixOssFileService } from '~~/server/services/files/ossFileVerify.service'

const log = createLogger('storage-confirm-upload')

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const bodySchema = z.object({
        fileId: z.number({ message: 'fileId 必须为数字' }).int().positive(),
    })
    const parsed = bodySchema.safeParse(await readBody(event))
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }
    const { fileId } = parsed.data

    try {
        const result = await verifyAndFixOssFileService(fileId, user.id)

        if (result.ok) {
            return resSuccess(event, '已确认上传', { status: result.status })
        }

        switch (result.reason) {
            case 'forbidden':
                return resError(event, 403, '无权操作此文件')
            case 'not_found':
                return resError(event, 404, '文件未在存储上找到，请重新上传')
            case 'already_failed':
                return resError(event, 409, '文件已被标记为失败')
            case 'invalid':
                return resError(event, 400, '文件记录不存在或异常')
        }
    } catch (error) {
        log.error('兜底校验异常', { fileId, err: error })
        return resError(event, 503, 'OSS 服务暂时不可达，请稍后重试')
    }
})
