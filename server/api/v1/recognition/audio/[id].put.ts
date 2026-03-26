/**
 * 音频识别 API - 更新识别结果
 *
 * 更新 ASR 识别记录的说话人名称、关键词、摘要等信息
 * PUT /api/v1/recognition/audio/:id
 *
 * Requirements: 6.4.3
 */

import { z } from 'zod'
import {
    getAsrRecordByIdService,
    updateAsrRecordService,
} from '~~/server/services/material/asr.service'

// 说话人信息验证 Schema
const speakerSchema = z.object({
    id: z.number()
        .int()
        .min(0, 'id 必须为非负整数')
        .describe('说话人 ID'),
    name: z.string()
        .min(1, '说话人名称不能为空')
        .max(50, '说话人名称不能超过 50 个字符')
        .describe('说话人名称'),
    color: z.string()
        .regex(/^#[0-9A-Fa-f]{6}$/, '颜色格式必须为 #RRGGBB')
        .optional()
        .describe('说话人颜色（可选）'),
})

// 请求体验证 Schema
const bodySchema = z.object({
    speakers: z.array(speakerSchema)
        .optional()
        .describe('更新说话人名称列表'),
    keywords: z.any()
        .optional()
        .describe('关键词'),
    summary: z.string()
        .max(5000, '摘要不能超过 5000 个字符')
        .optional()
        .describe('摘要'),
}).refine(
    (data) => data.speakers !== undefined || data.keywords !== undefined || data.summary !== undefined,
    { message: '至少需要提供一个更新字段（speakers、keywords 或 summary）' }
)

// 路由参数验证 Schema
const paramsSchema = z.object({
    id: z.string()
        .regex(/^\d+$/, 'id 必须为数字')
        .transform(Number)
        .describe('ASR 识别记录 ID'),
})

/** 说话人信息 */
interface Speaker {
    id: number
    name: string
    color?: string
}

export default defineEventHandler(async (event) => {
    try {
        // 1. 验证用户登录
        const user = event.context.auth?.user
        if (!user) {
            return resError(event, 401, '请先登录')
        }

        // 2. 验证路由参数
        const params = { id: getRouterParam(event, 'id') }
        const paramsResult = paramsSchema.safeParse(params)
        if (!paramsResult.success) {
            return resError(event, 400, paramsResult.error.issues[0]!.message)
        }

        const { id } = paramsResult.data

        // 3. 验证请求体
        const body = await readBody(event)
        const bodyResult = bodySchema.safeParse(body)
        if (!bodyResult.success) {
            return resError(event, 400, bodyResult.error.issues[0]!.message)
        }

        const { speakers, keywords, summary } = bodyResult.data

        // 4. 查询 ASR 识别记录
        const record = await getAsrRecordByIdService(id)
        if (!record) {
            return resError(event, 404, '识别记录不存在')
        }

        // 5. 验证记录是否属于当前用户
        if (record.userId !== user.id) {
            return resError(event, 403, '无权修改该记录')
        }

        // 6. 构建更新数据
        const updateData: {
            speakers?: Speaker[]
            keywords?: any
            summary?: string
        } = {}

        if (speakers !== undefined) {
            updateData.speakers = speakers
        }
        if (keywords !== undefined) {
            updateData.keywords = keywords
        }
        if (summary !== undefined) {
            updateData.summary = summary
        }

        // 7. 调用服务层更新记录
        const updatedRecord = await updateAsrRecordService(id, updateData)

        // 8. 解析更新后的说话人信息
        let updatedSpeakers: Speaker[] = []
        if (Array.isArray(updatedRecord.speakers)) {
            updatedSpeakers = (updatedRecord.speakers as any[]).map((speaker: any) => ({
                id: speaker.id ?? 0,
                name: speaker.name || `说话人 ${(speaker.id ?? 0) + 1}`,
                color: speaker.color || '#3B82F6',
            }))
        }

        // 9. 返回更新结果
        return resSuccess(event, '更新成功', {
            id: updatedRecord.id,
            speakers: updatedSpeakers,
            keywords: updatedRecord.keywords,
            summary: updatedRecord.summary,
        })
    } catch (error: any) {
        logger.error('更新音频识别记录 API 错误', {
            error: error.message,
            stack: error.stack,
        })
        return resError(event, 500, '更新失败，请稍后重试')
    }
})
