/**
 * 统一识别入口 API
 *
 * 根据文件类型自动调用对应的识别服务
 * - 图片 -> 图片识别服务（OCR）
 * - 音频 -> 音频识别服务（ASR）
 * - 文档 -> 文档识别服务（MinerU）
 */

import { z } from 'zod'
import { detectFileTypeService } from '~~/server/services/material/fileDetect.service'
import { createImageConversionService } from '~~/server/services/material/ocr.service'
import { convertPdfService } from '~~/server/services/material/mineru.service'
import { transcribeAudioService } from '~~/server/services/material/asr.service'
import { CaseMaterialType } from '#shared/types/case'

/** 请求参数校验 */
const schema = z.object({
    ossFileIds: z.array(z.number()).min(1, 'ossFileIds 不能为空')
})

/**
 * 统一识别入口 API
 *
 * POST /api/v1/recognition/start
 */
export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 读取请求参数
    const body = await readBody(event)

    // 参数校验
    const result = schema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0]?.message || '参数错误')
    }

    const { ossFileIds } = result.data
    const results: Array<{
        ossFileId: number
        status: 'processing' | 'failed'
        error?: string
    }> = []

    // 遍历处理每个文件
    for (const ossFileId of ossFileIds) {
        // 查询 OSS 文件是否存在
        const ossFile = await prisma.ossFiles.findFirst({
            where: { id: ossFileId, userId: user.id, deletedAt: null }
        })

        if (!ossFile) {
            results.push({
                ossFileId,
                status: 'failed',
                error: '文件不存在'
            })
            continue
        }

        // 根据文件扩展名识别类型
        const fileType = detectFileTypeService(ossFile.fileName)

        // 根据文件类型调用对应的识别服务
        let processResult: { success: boolean; error?: string }

        switch (fileType) {
            case CaseMaterialType.IMAGE:
                processResult = await createImageConversionService(ossFileId, user.id)
                break
            case CaseMaterialType.AUDIO:
                processResult = await transcribeAudioService(ossFileId, user.id)
                break
            default:
                // 文档类型（PDF、DOC、DOCX、MD、TXT 等）
                processResult = await convertPdfService(ossFileId, user.id)
        }

        results.push({
            ossFileId,
            status: processResult.success ? 'processing' : 'failed',
            error: processResult.error
        })
    }

    return resSuccess(event, '识别任务已提交', { results })
})
