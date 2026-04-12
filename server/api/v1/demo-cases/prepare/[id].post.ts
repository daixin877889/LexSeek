/**
 * 准备示范案例（点击即用）
 *
 * POST /api/v1/demo-cases/prepare/:id
 *
 * 克隆示范案例的文件材料到当前用户云盘（含识别记录克隆 + 资源复活）。
 * 嵌入向量不克隆，由分析启动时 ensureMaterialsReadyService 自动补齐。
 */

import { z } from 'zod'
import { prepareDemoCaseForUserService } from '~~/server/services/case/demoCase.service'

const paramsSchema = z.object({
    id: z.coerce.number().int().positive(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const params = getRouterParams(event)
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
        return resError(event, 400, '参数错误：' + parsed.error.issues[0]!.message)
    }

    try {
        const data = await prepareDemoCaseForUserService(parsed.data.id, { id: user.id })
        return resSuccess(event, '准备示范案例成功', data)
    } catch (error: any) {
        if (error?.statusCode) {
            return resError(event, error.statusCode, error.message || '准备示范案例失败')
        }
        logger.error('准备示范案例失败：', error)
        return resError(event, 500, '准备示范案例失败')
    }
})
