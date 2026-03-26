/**
 * 使用示范案例创建案件
 *
 * POST /api/v1/demo-cases/create-case/[id]
 * Requirements: 18.4, 18.5
 *
 * 使用预设的示范案例材料创建新案件，标记为示范案件
 */

import { z } from 'zod'
import type { DemoCaseMaterial } from '~~/server/services/case/demoCase.dao'
import { CaseMaterialType } from '#shared/types/case'
import { MaterialStatus } from '#shared/types/material'

/** 路径参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive(),
})

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 验证路径参数
    const params = getRouterParams(event)
    const paramsResult = paramsSchema.safeParse(params)
    if (!paramsResult.success) {
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0]!.message)
    }

    const { id: demoCaseId } = paramsResult.data

    try {
        // 获取示范案例详情
        const demoCase = await getDemoCaseByIdService(demoCaseId)
        if (!demoCase) {
            return resError(event, 404, '示范案例不存在')
        }

        // 检查示范案例是否启用
        if (demoCase.status !== 1) {
            return resError(event, 400, '示范案例已禁用')
        }

        // 创建案件
        const caseResult = await createCaseService({
            title: demoCase.title,
            content: demoCase.description,
            userId: user.id,
            caseTypeId: demoCase.caseTypeId,
            isDemo: true,
        })

        // 解析预设材料并并行创建材料记录
        const materials = (demoCase.materials as unknown as DemoCaseMaterial[]) || []

        await Promise.all(materials.map(material =>
            createMaterialService({
                caseId: caseResult.caseId,
                name: material.name,
                type: material.type as CaseMaterialType,
                content: material.content,
                status: material.content ? MaterialStatus.COMPLETED : MaterialStatus.PENDING,
            })
        ))

        const result = caseResult

        return resSuccess(event, '创建案件成功', {
            caseId: result.caseId,
            sessionId: result.sessionId,
        })
    } catch (error) {
        logger.error('使用示范案例创建案件失败：', error)
        const message = error instanceof Error ? error.message : '创建案件失败'
        return resError(event, 500, message)
    }
})
