/**
 * 删除 API 权限
 * DELETE /api/v1/admin/api-permissions/:id
 */
export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const id = Number(getRouterParam(event, 'id'))
    if (isNaN(id)) {
        return resError(event, 400, '无效的权限 ID')
    }

    // 查询现有权限
    const existing = await findApiPermissionByIdDao(id)
    if (!existing) {
        return resError(event, 404, '权限不存在')
    }

    // 软删除权限
    await deleteApiPermissionDao(id)

    // 记录审计日志
    await logApiPermissionDelete(event, user.id, id, {
        path: existing.path,
        method: existing.method,
        name: existing.name,
    })

    // 如果是公开权限，刷新缓存
    if (existing.isPublic) {
        await refreshPublicApiPermissions()
    }

    return resSuccess(event, '删除成功', null)
})
