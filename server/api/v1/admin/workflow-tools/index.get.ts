/**
 * 获取工作流工具列表 API
 *
 * 返回所有已注册工具的元信息（名称、描述、参数）
 * 供节点管理页面选择工具时使用
 * Requirements: 12.1.6, 12.1.7
 */

import { getAllToolsService } from '~~/server/services/workflow/tools'

export default defineEventHandler(async (event) => {
    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        // 获取所有工具元信息
        const tools = getAllToolsService()

        return resSuccess(event, '获取成功', {
            items: tools,
            total: tools.length,
        })
    } catch (error) {
        logger.error('获取工作流工具列表失败:', error)
        return resError(event, 500, '获取工作流工具列表失败')
    }
})
