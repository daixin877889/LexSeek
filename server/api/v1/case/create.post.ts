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
import type { PartyInfo } from '#shared/types/case'

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

// 请求体验证
const createCaseSchema = z.object({
    /** 案件标题 */
    title: z.string()
        .min(1, { message: '案件标题不能为空' })
        .max(500, { message: '案件标题不能超过 500 个字符' }),
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

    const { title, content, caseTypeId, plaintiff, defendant } = result.data

    try {
        // 创建案件
        const createResult = await createCaseService({
            title,
            content: content ?? null,
            userId: user.id,
            caseTypeId,
            plaintiff: plaintiff as PartyInfo[] | undefined,
            defendant: defendant as PartyInfo[] | undefined,
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
