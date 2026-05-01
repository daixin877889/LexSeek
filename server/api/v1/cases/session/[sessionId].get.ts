/**
 * 通过会话 ID 获取案件信息
 *
 * GET /api/v1/case/session/[sessionId]
 *
 * 获取指定会话对应的案件详细信息
 * Requirements: 9.1
 */

import {
    getCaseBySessionIdService,
    getSessionByIdService,
    validateCaseAccessService,
} from '~~/server/services/case/case.service'

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 获取路由参数
    const sessionId = getRouterParam(event, 'sessionId')
    if (!sessionId) {
        return resError(event, 400, '会话 ID 不能为空')
    }

    try {
        // 获取会话信息
        const session = await getSessionByIdService(sessionId)
        if (!session) {
            return resError(event, 404, '会话不存在')
        }

        // 获取案件信息
        const caseRecord = await getCaseBySessionIdService(sessionId)
        if (!caseRecord) {
            return resError(event, 404, '案件不存在')
        }

        // 验证用户对案件的访问权限
        await validateCaseAccessService(caseRecord.id, user.id)

        logger.info('通过会话 ID 获取案件信息成功', {
            sessionId,
            caseId: caseRecord.id,
            userId: user.id,
        })

        return resSuccess(event, '获取案件信息成功', {
            case: {
                id: caseRecord.id,
                title: caseRecord.title,
                content: caseRecord.content,
                caseTypeId: caseRecord.caseTypeId,
                plaintiff: caseRecord.plaintiff,
                defendant: caseRecord.defendant,
                status: caseRecord.status,
                isDemo: caseRecord.isDemo,
                createdAt: caseRecord.createdAt,
                updatedAt: caseRecord.updatedAt,
                caseTypeName: caseRecord.caseType?.name,
            },
            session: {
                id: session.id,
                sessionId: session.sessionId,
                status: session.status,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
            },
        })
    } catch (error: any) {
        logger.error('通过会话 ID 获取案件信息失败', {
            sessionId,
            userId: user.id,
            error: error.message,
        })

        // 处理权限错误
        if (error.message === '无权访问该案件') {
            return resError(event, 403, error.message)
        }

        return resError(event, 500, error.message || '获取案件信息失败')
    }
})
