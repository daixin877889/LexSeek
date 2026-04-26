/**
 * 创建案件
 *
 * POST /api/v1/case/create
 *
 * 创建新案件并生成唯一的 sessionId（作为 LangGraph thread_id）
 * Requirements: 1.3, 3.1
 */

import { z } from 'zod'
import { createCaseService } from '~~/server/services/case/case.service'
import type { PartyInfo, CaseMaterialParam } from '#shared/types/case'
import { CaseMaterialType } from '#shared/types/case'
import { parseErrorMessage } from '#shared/utils/apiResponse'
import { getFirstEnabledCaseTypeService } from '~~/server/services/case/caseType.service'

// 当事人信息验证
const partyInfoSchema = z.object({
    /** 名称 */
    name: z.string().min(1, { message: '当事人名称不能为空' }),
    /** 类型：individual-个人，company-公司 */
    type: z.enum(['individual', 'company']).optional(),
    /** 联系方式 */
    contact: z.string().optional(),
    /** 地址 */
    address: z.string().optional(),
    /** 其他信息 */
    extra: z.record(z.string(), z.any()).optional(),
})

// 案件材料验证
const caseMaterialSchema = z.object({
    /** 材料类型 */
    type: z.number()
        .int({ message: '材料类型必须为整数' })
        .refine(
            (val) => [
                CaseMaterialType.CASE_CONTENT,
                CaseMaterialType.DOCUMENT,
                CaseMaterialType.IMAGE,
                CaseMaterialType.AUDIO,
            ].includes(val),
            { message: '无效的材料类型，必须是 1-4 之间的整数' }
        ),
    /** 材料名称（可选） */
    name: z.string().optional(),
    /** 文本内容（type=CASE_CONTENT 时必填） */
    content: z.string().optional(),
    /** OSS 文件 ID（type!=CASE_CONTENT 时必填） */
    ossFileId: z.number().int().positive().optional(),
    /** 材料分组（可选） */
    materialGroup: z.string().optional(),
}).superRefine((data, ctx) => {
    // 验证文本材料必须有 content
    if (data.type === CaseMaterialType.CASE_CONTENT) {
        if (!data.content || data.content.trim() === '') {
            ctx.addIssue({
                code: 'custom',
                message: '文本材料必须包含 content 字段且不能为空',
                path: ['content'],
            })
        }
    }
    // 验证文件材料必须有 ossFileId
    else {
        if (!data.ossFileId) {
            ctx.addIssue({
                code: 'custom',
                message: '文件材料必须包含 ossFileId 字段',
                path: ['ossFileId'],
            })
        }
    }
})

// 请求体验证
const createCaseSchema = z.object({
    /** 案件标题 */
    title: z.string()
        .min(1, { message: '案件标题不能为空' })
        .max(500, { message: '案件标题不能超过 500 个字符' })
        .optional(),
    /** 案件内容/描述 */
    content: z.string().max(10000, { message: '案件内容不能超过 10000 个字符' }).optional(),
    /** 案件类型 ID */
    caseTypeId: z.number()
        .int({ message: '案件类型 ID 必须为整数' })
        .positive({ message: '案件类型 ID 必须为正整数' }),
    /** 原告信息 */
    plaintiff: z.array(partyInfoSchema).optional(),
    /** 被告信息 */
    defendant: z.array(partyInfoSchema).optional(),
    /** 案件材料（可选） */
    materials: z.array(caseMaterialSchema).optional(),
    /** 案件概述（AI 提取） */
    summary: z.string().optional(),
    /** AI 提取的扩展字段 */
    extractedInfo: z.array(z.object({
        name: z.string(),
        title: z.string(),
        value: z.string(),
    })).optional(),
}).superRefine((data, ctx) => {
    // 验证 content 和 materials 至少提供一个
    const hasContent = data.content && data.content.trim().length > 0
    const hasMaterials = data.materials && data.materials.length > 0

    if (!hasContent && !hasMaterials) {
        ctx.addIssue({
            code: 'custom',
            message: '案件内容（content）和案件材料（materials）至少需要提供一个',
            path: ['content'],
        })
    }
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }


    // 解析请求体
    const body = await readBody(event)
    const result = createCaseSchema.safeParse(body)

    if (!result.success) {
        return resError(event, 400, parseErrorMessage(result.error, '参数验证失败'))
    }

    const { title, content, plaintiff, defendant, materials, summary, extractedInfo } = result.data

    // 如果未提供 caseTypeId，取第一条可用记录
    let caseTypeId = result.data.caseTypeId
    if (!caseTypeId) {
        const firstType = await getFirstEnabledCaseTypeService()
        if (!firstType) {
            return resError(event, 400, '系统未配置任何案件类型，请联系管理员')
        }
        caseTypeId = firstType.id
    }

    try {
        // 创建案件
        const createResult = await createCaseService({
            title,
            content: content ?? null,
            userId: user.id,
            caseTypeId,
            plaintiff: plaintiff as PartyInfo[] | undefined,
            defendant: defendant as PartyInfo[] | undefined,
            materials: materials as CaseMaterialParam[] | undefined,
            summary: summary ?? null,
            extractedInfo: extractedInfo ?? null,
        })

        logger.info('案件创建成功', {
            caseId: createResult.caseId,
            sessionId: createResult.sessionId,
            userId: user.id,
        })

        return resSuccess(event, '创建案件成功', {
            caseId: createResult.caseId,
            sessionId: createResult.sessionId,
            case: {
                id: createResult.case.id,
                title: createResult.case.title,
                content: createResult.case.content,
                caseTypeId: createResult.case.caseTypeId,
                status: createResult.case.status,
                createdAt: createResult.case.createdAt,
            },
            session: {
                id: createResult.session.id,
                sessionId: createResult.session.sessionId,
                status: createResult.session.status,
                createdAt: createResult.session.createdAt,
            },
        })
    } catch (error: any) {
        logger.error('创建案件失败', {
            title,
            caseTypeId,
            userId: user.id,
            error: error.message,
        })
        return resError(event, 500, error.message || '创建案件失败')
    }
})
