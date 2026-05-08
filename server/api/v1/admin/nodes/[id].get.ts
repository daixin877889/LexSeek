/**
 * 获取节点详情
 *
 * GET /api/v1/admin/nodes/:id
 * Requirements: 15.1
 *
 * 返回体在原 node 字段基础上额外附加：
 *  - `prompts: NodePromptRef[]`
 *      - 来源：node_prompts 关联表（按业务身份 (name, type)），按 displayOrder 升序
 *      - 每条携带当前激活版本（status=1）的 prompt 字段；未激活则跳过
 *      - 每条带 displayOrder + referencedByCount（同 (name, type) 被多少个节点引用）
 *  - `skills: NodeSkillRef[]`
 *      - 来源：node_skills 关联表 + skills 表，按 priority 升序
 *      - 包含 skill 的 name / title / customTitle / description / status + 关联 priority
 *      - 不做 status 过滤，停用的 skill 也展示（详情页只读，状态 badge 区分）
 *  - `toolDetails: NodeToolDetailRef[]`
 *      - 把 nodes.tools JSON 列里的字符串名映射成 { name, description }
 *      - 工具元信息来自 server/services/workflow/tools 注册表（不持久化）
 *      - 已从注册表下线的 name 仍保留，description 为 null（避免静默吞掉历史配置）
 *
 * 阶段 F 改造：node_prompts 不再绑定具体 promptId，需要按 (name, type) 分两步取数。
 * 阶段 J 改造：在原有 prompts 字段基础上新增 skills + toolDetails 两个视图字段。
 */

import { z } from 'zod'
import { prisma } from '~~/server/utils/db'
import { getNodeByIdService } from '~~/server/services/node/node.service'
import { getAllToolsService } from '~~/server/services/workflow/tools'
import type { NodeSkillRef, NodeToolDetailRef } from '#shared/types/node'

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

        // 节点关联的 Skills（按 priority 升序，详情页只读展示）
        const skillLinks = await prisma.node_skills.findMany({
            where: { nodeId: result.data.id },
            orderBy: { priority: 'asc' },
            include: { skill: true },
        })
        const skills: NodeSkillRef[] = skillLinks
            .filter(link => link.skill !== null)
            .map(link => ({
                name: link.skill.name,
                title: link.skill.title,
                customTitle: link.skill.customTitle,
                description: link.skill.description,
                status: link.skill.status,
                priority: link.priority,
            }))

        // 节点工具元信息（把 nodes.tools 里的字符串名映射为 { name, description }）
        const toolNames: string[] = Array.isArray(node.tools)
            ? node.tools.filter((t): t is string => typeof t === 'string')
            : []
        let toolDetails: NodeToolDetailRef[] = []
        if (toolNames.length > 0) {
            const allTools = getAllToolsService()
            const descByName = new Map(allTools.map(t => [t.name, t.description]))
            toolDetails = toolNames.map(name => ({
                name,
                description: descByName.get(name) ?? null,
            }))
        }

        return resSuccess(event, '获取节点详情成功', { ...node, prompts, skills, toolDetails })
    } catch (error) {
        logger.error('获取节点详情失败：', error)
        return resError(event, 500, '获取节点详情失败')
    }
})
