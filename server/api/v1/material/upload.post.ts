/**
 * 上传材料
 *
 * POST /api/v1/material/upload
 *
 * 创建案件材料记录，支持文本、文档、图片、音频类型
 * 对于需要服务端处理的文件（PDF/图片/音频），需要先上传到 OSS
 * Requirements: 3.2
 */

import { z } from 'zod'
import { createMaterialService } from '~~/server/services/material/material.service'
import { MaterialType, MaterialStatus } from '#shared/types/material'

// 请求体验证
const uploadMaterialSchema = z.object({
    /** 关联的案件 ID */
    caseId: z.number({ message: '案件 ID 必须为数字' }).int().positive({ message: '案件 ID 必须为正整数' }),
    /** 材料名称 */
    name: z.string({ message: '材料名称不能为空' }).min(1, { message: '材料名称不能为空' }).max(255, { message: '材料名称不能超过 255 个字符' }),
    /** 材料类型：1-文本，2-文档，3-图片，4-音频 */
    type: z.nativeEnum(MaterialType, { message: '材料类型无效' }),
    /** 材料内容（文本类型或浏览器端处理后的内容） */
    content: z.string().optional(),
    /** 关联的 OSS 文件 ID（文档/图片/音频类型必填） */
    ossFileId: z.number().int().positive().optional(),
    /** 是否加密 */
    isEncrypted: z.boolean().optional().default(false),
}).refine(
    (data) => {
        // 文本类型必须有内容
        if (data.type === MaterialType.TEXT && !data.content) {
            return false
        }
        // 文档/图片/音频类型必须有 OSS 文件 ID 或内容
        if ([MaterialType.DOCUMENT, MaterialType.IMAGE, MaterialType.AUDIO].includes(data.type)) {
            return data.ossFileId !== undefined || data.content !== undefined
        }
        return true
    },
    {
        message: '文本类型必须提供内容，文档/图片/音频类型必须提供 OSS 文件 ID 或内容',
    }
)

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 解析请求体
    const body = await readBody(event)
    const result = uploadMaterialSchema.safeParse(body)

    if (!result.success) {
        return resError(event, 400, parseErrorMessage(result.error, '参数验证失败'))
    }

    const { caseId, name, type, content, ossFileId, isEncrypted } = result.data

    try {
        // 验证案件是否属于当前用户
        const caseRecord = await prisma.cases.findFirst({
            where: { id: caseId, userId: user.id, deletedAt: null },
        })

        if (!caseRecord) {
            return resError(event, 404, '案件不存在或无权访问')
        }

        // 如果提供了 OSS 文件 ID，验证文件是否属于当前用户
        if (ossFileId) {
            const ossFile = await prisma.ossFiles.findFirst({
                where: { id: ossFileId, userId: user.id, deletedAt: null },
            })

            if (!ossFile) {
                return resError(event, 404, '文件不存在或无权访问')
            }
        }

        // 确定材料状态
        // 如果有内容，说明已处理完成；否则为待处理
        const status = content ? MaterialStatus.COMPLETED : MaterialStatus.PENDING

        // 创建材料记录
        const material = await createMaterialService({
            caseId,
            name,
            type,
            content,
            ossFileId,
            isEncrypted,
            status,
        })

        logger.info('材料上传成功', {
            materialId: material.id,
            caseId,
            type,
            userId: user.id,
        })

        return resSuccess(event, '上传材料成功', {
            id: material.id,
            caseId: material.caseId,
            name: material.name,
            type: material.type,
            status: material.status,
            ossFileId: material.ossFileId,
            isEncrypted: material.isEncrypted,
            createdAt: material.createdAt,
        })
    } catch (error: any) {
        logger.error('上传材料失败', {
            caseId,
            name,
            type,
            userId: user.id,
            error: error.message,
        })
        return resError(event, 500, error.message || '上传材料失败')
    }
})
