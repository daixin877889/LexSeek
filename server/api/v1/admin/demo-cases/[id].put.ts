/**
 * 更新示范案例
 *
 * PUT /api/v1/admin/demo-cases/:id
 * Requirements: 18.9
 */

import { z } from 'zod'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { ensureSourceFileRecognitionService } from '~~/server/services/case/demoCase.service'
import { updateDemoCaseService } from '~~/server/services/case/demoCase.service'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

/** 材料项验证 */
const materialSchema = z.object({
    name: z.string({ message: '材料名称不能为空' }).min(1, '材料名称不能为空').max(255, '材料名称不能超过255个字符'),
    type: z.union([z.literal(2), z.literal(3), z.literal(4)], { message: '材料类型无效，仅支持 2(文档)、3(图片)、4(音频)' }),
    sourceOssFileId: z.number({ message: 'OSS文件ID不能为空' }).int('OSS文件ID必须是整数').positive('OSS文件ID必须是正整数'),
})

/** 请求体验证 */
const bodySchema = z.object({
    title: z.string()
        .min(1, '标题不能为空')
        .max(200, '标题不能超过200个字符')
        .optional(),
    description: z.string()
        .max(500, '简介不能超过500个字符')
        .optional()
        .nullable(),
    content: z.string().nullable().optional(),
    caseTypeId: z.number()
        .int('案件类型ID必须是整数')
        .positive('案件类型ID必须是正整数')
        .optional(),
    materials: z.array(materialSchema).optional(),
    coverImage: z.string()
        .max(500, '封面图片URL不能超过500个字符')
        .optional()
        .nullable(),
    priority: z.number()
        .int('优先级必须是整数')
        .min(0, '优先级不能为负数')
        .optional(),
    status: z.number()
        .int('状态必须是整数')
        .min(0, '状态值无效')
        .max(1, '状态值无效')
        .optional(),
})

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id })
    if (!paramsResult.success) {
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0]!.message)
    }

    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body)
    if (!bodyResult.success) {
        return resError(event, 400, '参数错误：' + bodyResult.error.issues[0]!.message)
    }

    const data = bodyResult.data

    // 若同时传了 content 和 materials，校验不能都为空
    const hasContent = data.content !== undefined ? !!(data.content?.trim()) : undefined
    const hasMaterials = data.materials !== undefined ? data.materials.length > 0 : undefined
    if (hasContent === false && hasMaterials === false) {
        return resError(event, 400, '请至少填写案件描述或上传一个文件材料')
    }

    // 校验每个 sourceOssFileId 存在性
    if (data.materials) {
        for (const m of data.materials) {
            const source = await findOssFileByIdDao(m.sourceOssFileId)
            if (!source || source.deletedAt) {
                return resError(event, 400, `材料 "${m.name}" 的源文件不存在或已删除`)
            }
        }

        // 引导源文件识别（顺序调用，避免并发资源争用）
        for (const m of data.materials) {
            await ensureSourceFileRecognitionService(m.sourceOssFileId)
        }
    }

    try {
        const demoCase = await updateDemoCaseService(paramsResult.data.id, data)
        return resSuccess(event, '更新示范案例成功', demoCase)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '示范案例不存在') {
            return resError(event, 404, error.message)
        }
        if (error.message === '示范案例标题已存在') {
            return resError(event, 409, error.message)
        }
        logger.error('更新示范案例失败：', error)
        return resError(event, 500, '更新示范案例失败')
    }
})

