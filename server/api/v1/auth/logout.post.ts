/**
 * 退出登录
 *
 * 使用 token 退出登录
 */
export default defineEventHandler(async (event) => {
  const logger = createLogger('Auth')
  try {
    // 使用可选链操作符安全访问 auth 对象
    const user = event.context.auth?.user
    const token = event.context.auth?.token
    const expiredTimestamp = event.context.auth?.user?.exp

    if (!token) {
      // 即使没有 token，也清除 cookie 并返回成功
      clearAuthCookies(event)
      return resSuccess(event, '退出登录成功', {})
    }

    if (!user) {
      // 即使没有用户信息，也清除 cookie 并返回成功
      clearAuthCookies(event)
      return resSuccess(event, '退出登录成功', {})
    }

    // 检查 token 是否已过期
    if (expiredTimestamp && new Date(expiredTimestamp * 1000) < new Date()) {
      clearAuthCookies(event)
      return resSuccess(event, '退出登录成功', {})
    }

    // 添加 token 黑名单
    if (token && expiredTimestamp) {
      await addTokenBlacklistDao(token, user.id, new Date(expiredTimestamp * 1000))
    }

    // 清除认证 cookie
    clearAuthCookies(event)

    return resSuccess(event, '退出登录成功', {})
  } catch (error) {
    logger.error('退出登录失败：', error)
    // 即使出错也尝试清除 cookie
    clearAuthCookies(event)
    return resError(event, 400, parseErrorMessage(error, '退出登录失败'))
  }
})

