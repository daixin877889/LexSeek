/**
 * 获取当前用户信息
 */
export default defineEventHandler(async (event) => {
    const user = event.context.auth.user;
    if (!user) {
        return createError({
            statusCode: 401,
            statusMessage: '未授权',
        });
    }
    return {
        code: 200,
        message: '获取当前用户信息成功',
        data: user,
    }
})