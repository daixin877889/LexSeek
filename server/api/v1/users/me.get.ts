/**
 * 获取当前用户信息
 */
export default defineEventHandler(async (event) => {
    const user = event.context.auth.user;
    console.log(user)

    try {
        const userInfo = await findUserByIdDao(user.id);
        if (!userInfo) {
            return resError(event, 401, '用户不存在')
        }

        return resSuccess(event, "获取当前用户信息成功", {
            id: userInfo.id,
            name: userInfo.name,
            username: userInfo.username,
            phone: userInfo.phone,
            email: userInfo.email,
            role: userInfo.role,
            status: userInfo.status,
            company: userInfo.company,
            profile: userInfo.profile,
            inviteCode: userInfo.inviteCode,
        })

    } catch (error) {
        logger.error('获取当前用户信息失败：', error)
        return resError(event, 500, '获取当前用户信息失败')
    }

})