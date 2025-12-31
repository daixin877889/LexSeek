/**
 * 获取 API 权限分组列表
 * GET /api/v1/admin/api-permissions/groups
 */
export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const groups = await findAllApiPermissionGroupsDao()

    return resSuccess(event, '获取成功', groups)
})
