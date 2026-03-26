/**
 * 统一识别入口 API
 *
 * 根据文件类型自动调用对应的识别服务
 * - 图片 -> 图片识别服务（OCR）
 * - 音频 -> 音频识别服务（ASR）
 * - 文档(md/txt) -> 直接读取服务
 * - 文档(docx) -> DOCX 识别服务
 * - 文档(doc/pdf) -> MinerU 识别服务
 */

import { z } from 'zod'
import { detectFileTypeService } from '~~/server/services/material/fileDetect.service'
import { createImageConversionService } from '~~/server/services/material/ocr.service'
import { convertPdfService } from '~~/server/services/material/mineru.service'
import { transcribeAudioService } from '~~/server/services/material/asr.service'
import { readTextFileService } from '~~/server/services/material/textReader.service'
import { recognizeDocxService } from '~~/server/services/material/docxRecognition.service'
import { CaseMaterialType } from '#shared/types/case'
import { getExtensionFromFileName } from '~~/shared/utils/file'

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
        return resError(event, 400, result.error.issues[0]!!?.message || '参数错误')
    }

    const { ossFileIds } = result.data
    const results: Array<{
        ossFileId: number
        status: 'processing' | 'completed' | 'failed'
        error?: string
    }> = []

    // 1. 批量查询所有 OSS 文件（一次数据库查询）
    const ossFiles = await prisma.ossFiles.findMany({
        where: {
            id: { in: ossFileIds },
            userId: user.id,
            deletedAt: null
        }
    })

    // 2. 创建 ID 到文件的映射
    const fileMap = new Map(ossFiles.map(f => [f.id, f]))

    // 3. 遍历处理每个文件
    for (const ossFileId of ossFileIds) {
        // 从映射中获取文件（O(1) 查找）
        const ossFile = fileMap.get(ossFileId)

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

        // 获取文件扩展名
        const ext = getExtensionFromFileName(ossFile.fileName) || ''

        // 根据文件类型调用对应的识别服务
        // 标记是否为同步处理（md/txt/docx 是同步处理，图片/音频/pdf 是异步处理）
        // 已有成功记录的文件也视为同步处理（直接返回 completed）
        let isSyncProcessing = false
        let processResult: { success: boolean; error?: string; task?: { taskId?: string } }

        switch (fileType) {
            case CaseMaterialType.IMAGE:
                processResult = await createImageConversionService(ossFileId, user.id) as any
                break
            case CaseMaterialType.AUDIO:
                processResult = await transcribeAudioService(ossFileId, user.id) as any
                break
            case CaseMaterialType.DOCUMENT:
                // 文档类型需要进一步根据扩展名判断
                if (ext === 'md' || ext === 'txt') {
                    // md/txt 文件直接读取（同步处理）
                    isSyncProcessing = true
                    processResult = await readTextFileService(ossFileId, user.id)
                } else if (ext === 'docx') {
                    // docx 文件使用 mammoth 解析（同步处理）
                    isSyncProcessing = true
                    processResult = await recognizeDocxService(ossFileId, user.id) as any
                } else {
                    // doc/pdf 等其他文档使用 MinerU 服务（异步处理）
                    processResult = await convertPdfService(ossFileId, user.id) as any
                }
                break
            default:
                // 未知类型，默认使用 MinerU 服务
                processResult = await convertPdfService(ossFileId, user.id) as any
        }

        // 检查是否已有成功的识别记录（taskId === 'existing' 表示已有成功记录）
        if (processResult.success && processResult.task?.taskId === 'existing') {
            isSyncProcessing = true
        }

        // 同步处理的服务直接返回 completed，异步处理的服务返回 processing
        const resultStatus = processResult.success
            ? (isSyncProcessing ? 'completed' : 'processing')
            : 'failed'

        results.push({
            ossFileId,
            status: resultStatus,
            error: processResult.error
        })
    }

    return resSuccess(event, '识别任务已提交', { results })
})
