/**
 * 管理端：节点 system prompt 拼装预览
 *
 * GET /api/v1/admin/nodes/:id/prompts/preview
 *
 * 把节点关联的所有启用 system prompts 按 displayOrder 升序拼接后返回，
 * 用于管理后台 "查看完整 prompt 预览" 抽屉。
 *
 * 返回：{ nodeId, systemPromptPreview, promptCount }
 *
 * 鉴权：依赖 server/middleware/03.permission.ts RBAC 拦截
 *
 * @see docs/superpowers/plans/2026-05-06-prompts-multi-node-and-anti-jailbreak.md Task 5.3
 */

import { z } from 'zod'
import { prisma } from '~~/server/utils/db'
import { getNodeConfigService } from '~~/server/services/node/node.service'
import { renderSystemPrompt } from '~~/server/services/agent-platform/nodeConfig/promptRenderer'

const paramsSchema = z.object({
    id: z.coerce.number().int().positive('节点 ID 必须是正整数'),
})

export default defineEventHandler(async (event) => {
    const rawId = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id: rawId })
    if (!paramsResult.success) {
        return resError(event, 400, '参数错误：' + paramsResult.error.issues[0]!.message)
    }
    const nodeId = paramsResult.data.id

    // getNodeConfigService 接节点 name（不是 id），先查 name
    const node = await prisma.nodes.findUnique({
        where: { id: nodeId },
        select: { name: true },
    })
    if (!node) {
        return resError(event, 404, '节点不存在')
    }

    try {
        const cfg = await getNodeConfigService(node.name)
        if (!cfg) {
            return resError(event, 404, '节点配置不可用（未启用或缺失模型/Provider）')
        }

        // 预览不传任何模板变量上下文：未替换的 `{{xxx}}` 字面量保留在输出中，
        // 让管理员一眼看到 prompt 里有哪些动态变量待运行时替换。
        const systemPromptPreview = renderSystemPrompt(cfg, {})
        const promptCount = cfg.prompts.filter((p) => p.type === 'system' && p.status === 1).length

        return resSuccess(event, '查询成功', {
            nodeId,
            systemPromptPreview,
            promptCount,
        })
    } catch (error) {
        logger.error('[admin/nodes/prompts/preview] 拼装 system prompt 失败：', error)
        return resError(event, 500, '获取节点提示词预览失败')
    }
})
