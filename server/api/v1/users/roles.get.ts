/**
 * 获取当前用户角色列表
 */
export default defineEventHandler(async (event) => {
    const logger = createLogger('users')
    const user = event.context.auth.user;
    try {
        const userRoles = await findUserRolesByUserIdDao(user.id);
        if (!userRoles) {
            return resError(event, 401, '用户角色不存在')
        }

        const userRoleRes = userRoles.map(item => {
            return {
                id: item.role.id,
                name: item.role.name,
                code: item.role.code,
                description: item.role.description,
            }
        })

        return resSuccess(event, "获取当前用户角色列表成功", userRoleRes)

    } catch (error) {
        logger.error('获取当前用户信息失败：', error)
        return resError(event, 500, '获取当前用户信息失败')
    }

})