/**
 * API 权限验证中间件
 * 
 * 在认证中间件之后执行，验证用户是否有访问当前 API 的权限
 * 
 * 验证顺序：
 * 1. 非 API 请求直接放行
 * 2. 公开 API 直接放行（认证中间件已标记）
 * 3. 未登录用户访问非公开 API 返回 401
 * 4. 超级管理员直接放行
 * 5. 验证用户是否拥有该 API 权限
 */

export default defineEventHandler(async (event) => {
    const url = getRequestURL(event)
    const requestPath = url.pathname
    const requestMethod = event.method

    // 1. 非 API 请求直接放行
    if (!requestPath.startsWith('/api')) {
        return
    }

    // 2. 公开 API 直接放行（认证中间件已标记）
    if (event.context.isPublicApi) {
        return
    }

    // 3. 获取当前用户（可能为 null）
    const userId = event.context.auth?.user?.id ?? null

    // 4. 验证 API 权限
    const result = await validateUserApiPermission(userId, requestPath, requestMethod)

    if (result.allowed) {
        // 权限验证通过，记录日志（调试用）
        if (result.reason === 'super_admin') {
            logger.debug(`[权限] 超级管理员访问: ${requestMethod} ${requestPath}`)
        }
        return
    }

    // 5. 权限验证失败
    switch (result.reason) {
        case 'not_authenticated':
            // 未登录（认证中间件已处理大部分情况，这里是兜底）
            return resError(event, 401, '请先登录')

        case 'no_permission':
            // 无权限
            logger.warn(`[权限] 用户 ${userId} 无权访问: ${requestMethod} ${requestPath}`)
            return resError(event, 403, '无权限访问该接口')

        default:
            // 未知原因
            logger.error(`[权限] 未知验证结果: ${result.reason}`)
            return resError(event, 403, '权限验证失败')
    }
})
