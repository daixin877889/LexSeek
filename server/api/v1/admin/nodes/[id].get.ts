/**
 * 获取节点详情
 *
 * GET /api/v1/admin/nodes/:id
 * Requirements: 15.1
 *
 * 返回体在原 node 字段基础上额外附加 `prompts: NodePromptRef[]`：
 *  - 来源：node_prompts 关联表（按业务身份 (name, type)），按 displayOrder 升序
 *  - 每条携带当前激活版本（status=1）的 prompt 字段；未激活则跳过
 *  - 每条带 displayOrder + referencedByCount（同 (name, type) 被多少个节点引用）
 *
 * 阶段 F 改造：node_prompts 不再绑定具体 promptId，需要按 (name, type) 分两步取数。
 */

import { z } from 'zod'
import { prisma } from '~~/server/utils/db'
import { getNodeByIdService } from '~~/server/services/node/node.service'

/** 路由参数验证 */
const paramsSchema = z.object({
    id: z.coerce.number().int().positive('ID必须是正整数'),
})

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id')
    const result = paramsSchema.safeParse({ id })
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    try {
        const node = await getNodeByIdService(result.data.id)
        if (!node) {
            return resError(event, 404, '节点不存在')
        }

        // 节点的链接（按业务身份）
        const links = await prisma.node_prompts.findMany({
            where: { nodeId: result.data.id },
            orderBy: { displayOrder: 'asc' },
        })

        let prompts: Array<{
            id: number
            name: string
            title: string | null
            type: string
            status: number
            version: string
            displayOrder: number
            referencedByCount: number
        }> = []

        if (links.length > 0) {
            // 一次性按 (name, type) 拉所有匹配的未软删 prompts（不限 status，详情页要展示节点关联的版本即使未激活也呈现）
            const promptRows = await prisma.prompts.findMany({
                where: {
                    OR: links.map(l => ({ name: l.promptName, type: l.promptType })),
                    deletedAt: null,
                },
            })
            const promptByKey = new Map<string, typeof promptRows>()
            for (const p of promptRows) {
                const key = `${p.name}::${p.type}`
                const arr = promptByKey.get(key)
                if (arr) arr.push(p)
                else promptByKey.set(key, [p])
            }
            // 按 (name, type) 一次性 groupBy 出每段身份的引用数
            const referenceCounts = await prisma.node_prompts.groupBy({
                by: ['promptName', 'promptType'],
                where: { OR: links.map(l => ({ promptName: l.promptName, promptType: l.promptType })) },
                _count: { _all: true },
            })
            const countByKey = new Map(
                referenceCounts.map(rc => [`${rc.promptName}::${rc.promptType}`, rc._count._all]),
            )

            for (const link of links) {
                const key = `${link.promptName}::${link.promptType}`
                const matches = promptByKey.get(key) ?? []
                // 优先取激活版本；若无则取最大 id 兜底（节点关联的"当前展示版本"）
                const active = matches.find(p => p.status === 1)
                    ?? matches.sort((a, b) => b.id - a.id)[0]
                if (!active) continue
                prompts.push({
                    id: active.id,
                    name: active.name,
                    title: active.title,
                    type: active.type,
                    status: active.status,
                    version: active.version,
                    displayOrder: link.displayOrder,
                    referencedByCount: countByKey.get(key) ?? 0,
                })
            }
        }

        return resSuccess(event, '获取节点详情成功', { ...node, prompts })
    } catch (error) {
        logger.error('获取节点详情失败：', error)
        return resError(event, 500, '获取节点详情失败')
    }
})
