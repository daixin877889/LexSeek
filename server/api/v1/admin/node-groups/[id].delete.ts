/**
 * 删除节点分组
 *
 * DELETE /api/v1/admin/node-groups/[id]
 * Requirements: 14.6, 14.7
 */

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const id = getRouterParam(event, 'id')
    if (!id || isNaN(Number(id))) {
        return resError(event, 400, '无效的分组ID')
    }

    try {
        await deleteNodeGroupService(Number(id))
        return resSuccess(event, '删除节点分组成功')
    } catch (error: any) {
        // 处理业务逻辑错误
        if (error.message === '节点分组不存在') {
            return resError(event, 404, error.message)
        }
        if (error.message === '该分组下存在节点，无法删除') {
            return resError(event, 400, error.message)
        }
        logger.error('删除节点分组失败：', error)
        return resError(event, 500, '删除节点分组失败')
    }
})
