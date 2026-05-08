/**
 * 创建示范案例
 *
 * POST /api/v1/admin/demo-cases
 * Requirements: 18.8
 */

import { z } from 'zod'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { ensureSourceFileRecognitionService } from '~~/server/services/case/demoCase.service'
import { createDemoCaseService } from '~~/server/services/case/demoCase.service'

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
        .max(200, '标题不能超过200个字符'),
    description: z.string()
        .max(500, '简介不能超过500个字符')
        .optional()
        .nullable(),
    content: z.string().nullable().optional(),
    caseTypeId: z.number()
        .int('案件类型ID必须是整数')
        .positive('案件类型ID必须是正整数'),
    materials: z.array(materialSchema).default([]),
    coverImage: z.string()
        .max(500, '封面图片URL不能超过500个字符')
        .optional()
        .nullable(),
    priority: z.number()
        .int('优先级必须是整数')
        .min(0, '优先级不能为负数')
        .default(100),
    status: z.number()
        .int('状态必须是整数')
        .min(0, '状态值无效')
        .max(1, '状态值无效')
        .default(1),
})

export default defineEventHandler(async (event) => {
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    const data = result.data

    // content 和 materials 不能都为空
    const hasContent = !!(data.content?.trim())
    const hasMaterials = data.materials.length > 0
    if (!hasContent && !hasMaterials) {
        return resError(event, 400, '请至少填写案件描述或上传一个文件材料')
    }

    // 校验每个 sourceOssFileId 存在性
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

    try {
        const demoCase = await createDemoCaseService({
            ...data,
            content: data.content ?? null,
        })
        return resSuccess(event, '创建示范案例成功', demoCase)
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '示范案例标题已存在') {
            return resError(event, 409, error.message)
        }
        logger.error('创建示范案例失败：', error)
        return resError(event, 500, '创建示范案例失败')
    }
})

