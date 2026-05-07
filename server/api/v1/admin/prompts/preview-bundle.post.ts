/**
 * 管理端：根据传入的 promptId + displayOrder 列表预览拼装效果
 *
 * POST /api/v1/admin/prompts/preview-bundle
 *
 * 用于「新建节点」场景下查看完整 system prompt 拼接预览：
 * 此时还没有 nodeId，无法走 GET /api/v1/admin/nodes/:id/prompts/preview。
 *
 * 行为：
 * - 仅取 type='system' && status=1 && deletedAt=null 的 prompt
 * - 按 staged 入参的 displayOrder 升序拼接
 * - 模板变量用占位字符串预览（如 {{caseId}} → <caseId>）
 *
 * 鉴权：依赖 server/middleware/03.permission.ts RBAC 拦截
 */

import { z } from 'zod'
import { renderContent } from '~~/server/services/node/prompt.service'
import { prisma } from '~~/server/utils/db'

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
        return resSuccess(event, '查询成功', {
            systemPromptPreview: '',
            promptCount: 0,
        })
    }

    try {
        const promptIds = staged.map(s => s.promptId)
        const dbPrompts = await prisma.prompts.findMany({
            where: {
                id: { in: promptIds },
                type: 'system',
                status: 1,
                deletedAt: null,
            },
            select: { id: true, content: true },
        })

        const idToContent = new Map(dbPrompts.map(p => [p.id, p.content]))

        // 按 staged 入参的 displayOrder 升序拼接（不依赖 db 的默认顺序）
        const sortedContents = staged
            .filter(s => idToContent.has(s.promptId))
            .slice()
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map(s => idToContent.get(s.promptId)!)

        const rendered = sortedContents.map(content => renderContent(content, PREVIEW_VARIABLES))
        const systemPromptPreview = rendered.join('\n\n')

        return resSuccess(event, '查询成功', {
            systemPromptPreview,
            promptCount: sortedContents.length,
        })
    } catch (error) {
        logger.error('[admin/prompts/preview-bundle] 拼装 system prompt 失败：', error)
        return resError(event, 500, '获取提示词预览失败')
    }
})
