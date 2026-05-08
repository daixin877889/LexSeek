/**
 * 管理端：根据传入的 promptId + displayOrder 列表预览完整 prompt 拼装效果
 *
 * POST /api/v1/admin/prompts/preview-bundle
 *
 * 用于「新建节点」场景下查看完整 prompt 预览：此时还没有 nodeId，无法走
 * GET /api/v1/admin/nodes/:id/prompts/preview。
 *
 * 行为：
 * - 取所有传入的 promptId（不限 type），仅过滤 status=1 && deletedAt=null
 * - 按 type 分桶：
 *     - system / user_injection：多段按入参 displayOrder 升序 `'\n\n'` join
 *     - user / assistant：列表式输出，按入参 displayOrder 升序，每项独立卡片
 * - 模板变量统一用 `<varName>` 占位渲染（与 nodes/:id/prompts/preview 保持一致）
 *
 * 返回结构与 NodePromptsPreview 一致；任意一类无生效 prompt → 该字段为 null。
 *
 * 鉴权：依赖 server/middleware/03.permission.ts RBAC 拦截
 */

import { z } from 'zod'
import { renderContent } from '~~/server/services/node/prompt.service'
import { prisma } from '~~/server/utils/db'
import type {
    NodePromptsPreview,
    NodePromptsPreviewItem,
    PromptType,
} from '#shared/types/node'

const bodySchema = z.object({
    prompts: z.array(z.object({
        promptId: z.number().int().positive('promptId 必须是正整数'),
        displayOrder: z.number().int(),
    })),
})

/**
 * 模板变量占位渲染上下文。
 * 与运行时上下文一一对应（参考 PromptRenderContext），
 * 但每个变量都用 `<varName>` 形式的占位字符串呈现，
 * 让管理员一眼看到拼装结构。
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
    const operatorId = event.context.auth?.user?.id
    if (!operatorId) {
        return resError(event, 401, '请先登录')
    }

    const result = await readValidatedBody(event, (payload) => bodySchema.safeParse(payload))
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!.message)
    }

    const { prompts: staged } = result.data
    if (staged.length === 0) {
        return resSuccess(event, '查询成功', EMPTY_PREVIEW)
    }

    try {
        const promptIds = staged.map(s => s.promptId)
        const dbPrompts = await prisma.prompts.findMany({
            where: {
                id: { in: promptIds },
                status: 1,
                deletedAt: null,
            },
            select: { id: true, name: true, type: true, title: true, content: true },
        })
        const byId = new Map(dbPrompts.map(p => [p.id, p]))

        // 按入参 displayOrder 升序分桶 + 渲染模板变量
        const buckets: Record<PromptType, BucketEntry[]> = {
            system: [],
            user_injection: [],
            user: [],
            assistant: [],
        }
        const sortedStaged = staged.slice().sort((a, b) => a.displayOrder - b.displayOrder)
        for (const s of sortedStaged) {
            const prompt = byId.get(s.promptId)
            if (!prompt) continue
            const t = prompt.type as PromptType
            if (!(t in buckets)) continue
            buckets[t]!.push({
                name: prompt.name,
                title: prompt.title,
                content: renderContent(prompt.content, PREVIEW_VARIABLES),
                displayOrder: s.displayOrder,
            })
        }

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

        const preview: NodePromptsPreview = {
            system: systemList.length > 0
                ? { content: systemList.map(p => p.content).join('\n\n'), count: systemList.length }
                : null,
            userInjection: injectionList.length > 0
                ? { content: injectionList.map(p => p.content).join('\n\n'), count: injectionList.length }
                : null,
            userItems: userList.length > 0 ? userList : null,
            assistantItems: assistantList.length > 0 ? assistantList : null,
        }
        return resSuccess(event, '查询成功', preview)
    } catch (error) {
        logger.error('[admin/prompts/preview-bundle] 拼装 prompt 预览失败：', error)
        return resError(event, 500, '获取提示词预览失败')
    }
})
