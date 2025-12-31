/**
 * 获取 API 权限详情
 * GET /api/v1/admin/api-permissions/:id
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

    const permission = await findApiPermissionByIdDao(id)
    if (!permission) {
        return resError(event, 404, '权限不存在')
    }

    // 获取关联的角色
    const roles = await findRolesByApiPermissionDao(id)

    return resSuccess(event, '获取成功', {
        ...permission,
        roles,
    })
})
