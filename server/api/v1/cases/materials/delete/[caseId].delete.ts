/**
 * 删除案件材料
 *
 * DELETE /api/v1/case/materials/delete/:caseId
 *
 * 支持单个和批量删除（软删除 + 清理向量数据）
 */

import { z } from 'zod'
import { validateCaseAccessService } from '~~/server/services/case/case.service'
import { deleteMaterialsDao } from '~~/server/services/material/material.dao'
import { deleteMaterialsEmbeddings } from '~~/server/services/material/materialEmbedding.service'
import { parseErrorMessage } from '#shared/utils/apiResponse'

const paramsSchema = z.object({
    caseId: z.coerce.number().int().positive(),
})

const bodySchema = z.object({
    materialIds: z.array(z.number().int().positive()).min(1, { message: '至少需要提供一个材料 ID' }),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const caseIdStr = getRouterParam(event, 'caseId')
    const paramsResult = paramsSchema.safeParse({ caseId: caseIdStr })
    if (!paramsResult.success) {
        return resError(event, 400, parseErrorMessage(paramsResult.error, '参数验证失败'))
    }
    const caseId = paramsResult.data.caseId

    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body)
    if (!bodyResult.success) {
        return resError(event, 400, parseErrorMessage(bodyResult.error, '参数验证失败'))
    }

    const { materialIds } = bodyResult.data

    try {
        // 1. 验证用户权限
        await validateCaseAccessService(caseId, user.id)

        // 2. 验证材料属于该案件
        const caseMaterials = await prisma.caseMaterials.findMany({
            where: {
                id: { in: materialIds },
                caseId,
                deletedAt: null,
            },
            select: { id: true },
        })

        const validIds = caseMaterials.map(m => m.id)
        if (validIds.length === 0) {
            return resError(event, 400, '未找到有效的材料')
        }

        // 3. 批量软删除 + 批量清理向量（单次 SQL 替代 N 次 round-trip）
        let succeeded = 0
        let failed = 0
        try {
            succeeded = await deleteMaterialsDao(validIds)
            await deleteMaterialsEmbeddings(validIds)
        } catch (err) {
            failed = validIds.length
            logger.warn('批量材料删除失败', { caseId, ids: validIds, error: (err as Error).message })
        }

        logger.info('删除案件材料', {
            caseId,
            userId: user.id,
            requested: materialIds.length,
            succeeded,
            failed,
        })

        return resSuccess(event, `成功删除 ${succeeded} 个材料`, { succeeded, failed })
    } catch (error: any) {
        logger.error('删除案件材料失败', {
            caseId,
            userId: user.id,
            error: error.message,
        })

        if (error.message === '无权访问该案件') {
            return resError(event, 403, error.message)
        }

        return resError(event, 500, error.message || '删除材料失败')
    }
})
