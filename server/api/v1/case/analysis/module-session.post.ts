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
    // 使用 Serializable 事务防止并发竞态：两个请求同时通过 findFirst 后，
    // 只有一个能成功插入，另一个触发唯一键违反时回退到查询
    const sessionId = uuidv4()
    try {
        await prisma.$transaction(
            async (tx) => {
                await tx.caseSessions.create({
                    data: {
                        sessionId,
                        caseId,
                        type: 3,
                        metadata: { moduleName, nodeId: node.id },
                    },
                })
            },
            {
                isolationLevel: 'Serializable',
                timeout: 5000,
            },
        )
    }
    catch (error: any) {
        // 唯一键违反（并发插入），回退到查询已创建的 session
        if (error?.code === 'P2002') {
            const existingAfterRace = await prisma.caseSessions.findFirst({
                where: {
                    caseId,
                    type: 3,
                    deletedAt: null,
                    metadata: { path: ['moduleName'], equals: moduleName },
                },
            })
            if (existingAfterRace) {
                return resSuccess(event, '获取成功', { sessionId: existingAfterRace.sessionId, isNew: false })
            }
        }
        throw error
    }

    return resSuccess(event, '创建成功', { sessionId, isNew: true })
})
