/**
 * 模块对话 Session 创建
 *
 * POST /api/v1/case/analysis/module-session
 *
 * 为指定案件的指定模块创建 type=3 的对话 session
 * 模块对话支持多 session，不再做幂等约束
 */
import { z } from 'zod'
import dayjs from 'dayjs'
import { createSessionDAO } from '~~/server/services/case/session.dao'
import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'

const bodySchema = z.object({
    caseId: z.number().int().positive(),
    moduleName: z.string().min(1),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const { caseId, moduleName } = parsed.data

    // 获取节点 ID
    const node = await getNodeByNameService(moduleName)
    if (!node) return resError(event, 404, `未找到模块节点: ${moduleName}`)

    // 从模块定义中查找中文名，生成标题
    const module = INIT_ANALYSIS_MODULES.find(m => m.name === moduleName)
    const sessionTitle = `${module?.title ?? moduleName}-${dayjs().format('YYMMDDHHmm')}`

    const result = await createSessionDAO({
        caseId,
        userId: user.id,
        type: 3,
        metadata: { moduleName, nodeId: node.id, title: sessionTitle },
        dedupeKey: `${user.id}:${caseId}:${moduleName}`,
    })
    if (!result) return resError(event, 404, '案件不存在')

    return resSuccess(event, '创建成功', { sessionId: result.sessionId, isNew: result.isNew })
})
