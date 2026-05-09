/**
 * 管理端：节点完整 prompt 预览（4 类分组）
 *
 * GET /api/v1/admin/nodes/:id/prompts/preview
 *
 * 把节点关联的所有启用提示词按 type 分桶后返回，用于管理后台节点详情页和编辑弹框
 * 「查看完整 prompt 预览」抽屉。返回结构：
 *
 *   {
 *     system: { content, count } | null,           // 多段按 displayOrder 升序拼接
 *     userInjection: { content, count } | null,    // 多段按 displayOrder 升序拼接
 *     userItems: NodePromptsPreviewItem[] | null,  // 列表式：每条独立卡片
 *     assistantItems: NodePromptsPreviewItem[] | null,
 *   }
 *
 * 任意一类无生效 prompt → 对应字段返回 null，前端按 v-if 动态渲染分段。
 *
 * 模板变量统一用 `<varName>` 占位渲染（与 preview-bundle.post.ts 保持一致）。
 *
 * 鉴权：依赖 server/middleware/03.permission.ts RBAC 拦截
 *
 * @see docs/superpowers/plans/2026-05-06-prompts-multi-node-and-anti-jailbreak.md Task M
 */

import { z } from 'zod'
import { prisma } from '~~/server/utils/db'
import { renderContent } from '~~/server/services/node/prompt.service'
import type {
    NodePromptsPreview,
    NodePromptsPreviewItem,
    PromptType,
} from '#shared/types/node'

const paramsSchema = z.object({
    id: z.coerce.number().int().positive('节点 ID 必须是正整数'),
})

/**
 * 模板变量占位渲染上下文。
 * 与运行时上下文一一对应（参考 PromptRenderContext），但每个变量都用 `<varName>`
 * 形式的占位字符串呈现，让管理员一眼看到拼装结构里哪些位置是动态变量。
 */
const PREVIEW_VARIABLES: Record<string, string> = {
    caseId: '<caseId>',
    moduleName: '<moduleName>',
    caseType: '<caseType>',
    templateName: '<templateName>',
    templateCategory: '<templateCategory>',
    fileIds: '<fileIds>',
    userExtraText: '<userExtraText>',
    draftId: '<draftId>',
    status: '<status>',
}

/** 4 类分桶的中间态，统一带 displayOrder 便于排序后再剪裁 */
type BucketEntry = {
    name: string
    title: string | null
    content: string
    displayOrder: number
}

const EMPTY_PREVIEW: NodePromptsPreview = {
    system: null,
    userInjection: null,
    userItems: null,
    assistantItems: null,
}

export default defineEventHandler(async (event) => {
    const rawId = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id: rawId })
    if (!paramsResult.success) {
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0]!.message)
    }
    const nodeId = paramsResult.data.id

    const node = await prisma.nodes.findUnique({
        where: { id: nodeId },
        select: { id: true },
    })
    if (!node) {
        return resError(event, 404, '节点不存在')
    }

    try {
        const links = await prisma.node_prompts.findMany({
            where: { nodeId: node.id },
            orderBy: { displayOrder: 'asc' },
        })
        if (links.length === 0) {
            return resSuccess(event, '查询成功', EMPTY_PREVIEW)
        }

        // 按 (name, type) 一次性拉取所有挂载身份对应的激活 prompt
        const identities = links.map(l => ({ name: l.promptName, type: l.promptType }))
        const activePrompts = await prisma.prompts.findMany({
            where: {
                OR: identities,
                status: 1,
                deletedAt: null,
            },
            select: { name: true, type: true, title: true, content: true },
        })
        const byKey = new Map(activePrompts.map(p => [`${p.name}::${p.type}`, p]))

        const buckets: Record<PromptType, BucketEntry[]> = {
            system: [],
            user_injection: [],
            user: [],
            assistant: [],
        }
        for (const link of links) {
            const prompt = byKey.get(`${link.promptName}::${link.promptType}`)
            if (!prompt) continue
            const t = prompt.type as PromptType
            if (!(t in buckets)) continue
            buckets[t]!.push({
                name: prompt.name,
                title: prompt.title,
                content: renderContent(prompt.content, PREVIEW_VARIABLES),
                displayOrder: link.displayOrder,
            })
        }
        // links 已按 displayOrder asc 取出，分桶时保序追加，无需二次排序

        const systemList = buckets.system
        const injectionList = buckets.user_injection
        const userList: NodePromptsPreviewItem[] = buckets.user.map(p => ({
            name: p.name,
            title: p.title,
            content: p.content,
        }))
        const assistantList: NodePromptsPreviewItem[] = buckets.assistant.map(p => ({
            name: p.name,
            title: p.title,
            content: p.content,
        }))

        const result: NodePromptsPreview = {
            system: systemList.length > 0
                ? { content: systemList.map(p => p.content).join('\n\n'), count: systemList.length }
                : null,
            userInjection: injectionList.length > 0
                ? { content: injectionList.map(p => p.content).join('\n\n'), count: injectionList.length }
                : null,
            userItems: userList.length > 0 ? userList : null,
            assistantItems: assistantList.length > 0 ? assistantList : null,
        }
        return resSuccess(event, '查询成功', result)
    } catch (error) {
        logger.error('[admin/nodes/prompts/preview] 拼装 prompt 预览失败：', error)
        return resError(event, 500, '获取节点提示词预览失败')
    }
})
