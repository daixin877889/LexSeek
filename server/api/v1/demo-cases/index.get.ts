/**
 * 获取示范案例列表（前台）
 *
 * GET /api/v1/demo-cases
 * Requirements: 18.1, 18.2
 *
 * 返回启用的示范案例列表，供前台展示使用
 */

import { z } from 'zod'

/** 查询参数验证 */
const querySchema = z.object({
    caseTypeId: z.coerce.number().int().positive().optional(),
})

export default defineEventHandler(async (event) => {
    // 验证查询参数
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    const { caseTypeId } = result.data

    try {
        // 获取启用的示范案例列表
        const demoCases = await getEnabledDemoCasesService(caseTypeId)

        // 获取案件类型信息
        const caseTypeIds = [...new Set(demoCases.map((dc) => dc.caseTypeId))]
        const caseTypes = caseTypeIds.length > 0
            ? await prisma.caseTypes.findMany({
                where: { id: { in: caseTypeIds }, deletedAt: null },
                select: { id: true, name: true },
            })
            : []

        const caseTypeMap = new Map(caseTypes.map((ct) => [ct.id, ct.name]))

        // 格式化返回数据
        const items = demoCases.map((dc) => ({
            id: dc.id,
            title: dc.title,
            description: dc.description,
            caseTypeId: dc.caseTypeId,
            caseTypeName: caseTypeMap.get(dc.caseTypeId) || '',
            coverImage: dc.coverImage,
            priority: dc.priority,
        }))

        return resSuccess(event, '获取示范案例列表成功', { items })
    } catch (error) {
        logger.error('获取示范案例列表失败：', error)
        return resError(event, 500, '获取示范案例列表失败')
    }
})
