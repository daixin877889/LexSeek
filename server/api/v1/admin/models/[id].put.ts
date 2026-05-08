/**
 * 更新模型
 *
 * PUT /api/v1/admin/models/:id
 */

import { z } from 'zod'
import { MODEL_TYPES, SDK_TYPES } from '#shared/types/model'
import { updateModelService } from '~~/server/services/model/models.service'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

/**
 * 请求体验证
 * 包含 sdkType 字段用于指定 LangChain SDK 类型
 */
const bodySchema = z.object({
    name: z.string()
        .min(1, '模型名称不能为空')
        .max(100, '模型名称不能超过100个字符')
        .optional(),
    displayName: z.string()
        .min(1, '显示名称不能为空')
        .max(100, '显示名称不能超过100个字符')
        .optional(),
    modelType: z.enum(MODEL_TYPES, {
        message: `模型类型必须是 ${MODEL_TYPES.join('、')}`,
    }).optional(),
    /**
     * LangChain SDK 类型
     * 用于指定模型使用的 LangChain 包
     * 可选字段，支持的枚举值：openai、deepseek、gemini、anthropic
     * 验证: 需求 3.3, 3.5
     */
    sdkType: z.enum(SDK_TYPES, {
        message: `SDK 类型必须是 ${SDK_TYPES.join('、')}`,
    }).optional(),
    modelVersion: z.string()
        .max(50, '版本号不能超过50个字符')
        .optional()
        .nullable(),
    contextWindow: z.number()
        .int('上下文窗口必须是整数')
        .positive('上下文窗口必须是正整数')
        .optional()
        .nullable(),
    maxOutputTokens: z.number()
        .int('最大输出 tokens 必须是整数')
        .positive('最大输出 tokens 必须是正整数')
        .optional()
        .nullable(),
    dimensions: z.number()
        .int('嵌入维度必须是整数')
        .positive('嵌入维度必须是正整数')
        .optional()
        .nullable(),
    batchSize: z.number()
        .int('批处理大小必须是整数')
        .positive('批处理大小必须是正整数')
        .optional()
        .nullable(),
    isDefault: z.boolean().optional(),
    status: z.number()
        .int('状态必须是整数')
        .min(0, '状态值无效')
        .max(1, '状态值无效')
        .optional(),
    priority: z.number()
        .int('优先级必须是整数')
        .min(1, '优先级最小为1')
        .optional(),
    inputCostPerMillionTokens: z.number()
        .positive('输入成本必须是正数')
        .optional()
        .nullable(),
    outputCostPerMillionTokens: z.number()
        .positive('输出成本必须是正数')
        .optional()
        .nullable(),
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

    try {
        const model = await updateModelService(paramsResult.data.id, bodyResult.data)
        return resSuccess(event, '更新模型成功', model)
    } catch (error: any) {
        // 处理 service 层业务错误
        if (error.message === '模型不存在') {
            return resError(event, 404, '模型不存在')
        }
        if (error.message?.startsWith('不支持的 SDK 类型')) {
            return resError(event, 400, error.message)
        }
        // 处理唯一性约束错误
        if (error.code === 'P2002') {
            return resError(event, 409, '该提供商下已存在同名模型')
        }
        logger.error('更新模型失败：', error)
        return resError(event, 500, '更新模型失败')
    }
})
