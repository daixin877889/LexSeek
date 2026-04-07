/**
 * 模块对话 Session 创建/获取
 *
 * POST /api/v1/case/analysis/module-session
 *
 * 为指定案件的指定模块创建或获取 type=3 的对话 session
 * 每案件每模块最多一个 type=3 session（应用层幂等保障）
 */

import { v4 as uuidv4 } from 'uuid'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const body = await readBody(event)
    const { caseId, moduleName } = body

    if (!caseId || !moduleName) {
        return resError(event, 400, '缺少 caseId 或 moduleName')
    }

    // 验证案件权限
    const caseRecord = await prisma.cases.findFirst({
        where: { id: caseId, userId: user.id, deletedAt: null },
    })
    if (!caseRecord) return resError(event, 404, '案件不存在')

    // 查找已有 type=3 session（JSON 字段查询）
    const existing = await prisma.caseSessions.findFirst({
        where: {
            caseId,
            type: 3,
            deletedAt: null,
            metadata: { path: ['moduleName'], equals: moduleName },
        },
    })

    if (existing) {
        return resSuccess(event, '获取成功', { sessionId: existing.sessionId, isNew: false })
    }

    // 获取节点 ID
    const node = await getNodeByNameService(moduleName)
    if (!node) return resError(event, 404, `未找到模块节点: ${moduleName}`)

    // 创建新 session
    const sessionId = uuidv4()
    await createSessionDao({
        sessionId,
        caseId,
        type: 3,
        metadata: { moduleName, nodeId: node.id },
    })

    return resSuccess(event, '创建成功', { sessionId, isNew: true })
})
