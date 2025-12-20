/**
 * 退出登录
 *
 * 使用 token 退出登录
 */
export default defineEventHandler(async (event) => {
  const logger = createLogger('Auth')
  try {
    const user = event.context.auth.user;
    const token = event.context.auth.token;
    const expiredTimestamp = event.context.auth.user.exp;

    if (!token) {
      return resError(event, 401, '未找到登录信息')
    }

    if (!user) {
      return resError(event, 401, '用户未登录')
    }

    if (new Date(expiredTimestamp * 1000) < new Date()) {
      return resError(event, 401, '登录已过期')
    }

    // 添加 token 黑名单
    await addTokenBlacklistDao(token, user.id, new Date(expiredTimestamp * 1000));

    return resSuccess(event, '退出登录成功', {})
  } catch (error) {
    logger.error('退出登录失败：', error)
    return resError(event, 400, parseErrorMessage(error, "退出登录失败"))
  }
})

