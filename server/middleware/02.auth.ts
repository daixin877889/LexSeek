// 鉴权中间件

/**
 * 获取公开 API 路径列表（从数据库配置）
 * 使用缓存避免每次请求都查询数据库
 */
const getPublicPaths = async (): Promise<Array<{ path: string; method: string }>> => {
    // 使用权限服务获取公开 API（已集成缓存）
    return await getPublicApiPermissions()
}

/**
 * 检查请求是否匹配公开 API
 */
const isPublicApi = (
    publicApis: Array<{ path: string; method: string }>,
    requestPath: string,
    requestMethod: string
): boolean => {
    return publicApis.some(api => {
        // 路径匹配（支持前缀匹配）
        const pathMatch = requestPath === api.path || requestPath.startsWith(api.path + '/')
        // 方法匹配（* 表示所有方法）
        const methodMatch = api.method === '*' || api.method === requestMethod
        return pathMatch && methodMatch
    })
}

export default defineEventHandler(async (event) => {
    // 获取请求 URL
    const url = getRequestURL(event);
    const requestMethod = event.method;

    // 1. 非 API 请求直接放行
    const isApiRequest = url.pathname.startsWith('/api');
    if (!isApiRequest) {
        return; // 放行
    }

    // 2. 检查是否为公开 API（从数据库配置读取）
    const publicApis = await getPublicPaths()
    if (isPublicApi(publicApis, url.pathname, requestMethod)) {
        // 标记为公开 API，供后续中间件使用
        event.context.isPublicApi = true
        return; // 放行
    }

    // 3. 初始化鉴权结果上下文
    let authenticatedUser: JwtPayload | null = null;
    let authType: 'cookie' | 'token' | null = null;
    let token: string | undefined = undefined;

    // 3.1 优先从请求头中获取 token
    const authHeader = getHeader(event, 'Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7); // 比 split 更高效
        authType = 'token';
    }

    // 3.2 如果请求头中没有 token 则从 cookie 中获取 auth_token
    if (!token) {
        token = getCookie(event, 'auth_token');
        if (token) {
            authType = 'cookie';
        }
    }

    // 4. 如果 token 不存在则返回401
    if (!token) {
        // 清除认证 cookie
        clearAuthCookies(event);
        return resError(event, 401, '未授权')
    }

    // 5. 验证 token
    try {
        authenticatedUser = JwtUtil.verifyToken(token);
    } catch (error) {
        // token 无效或已过期 
        // 清除认证 cookie
        clearAuthCookies(event);
        return resError(event, 401, '未授权')
    }

    // 5.1 如果验证失败则返回401
    if (!authenticatedUser || !authenticatedUser.id) {
        // 清除认证 cookie
        clearAuthCookies(event);
        return resError(event, 401, '未授权')
    }

    // 5.2 检查 token 是否在黑名单中
    const tokenBlacklist = await findTokenBlacklistByTokenDao(token);
    if (tokenBlacklist) {
        // 清除认证 cookie
        clearAuthCookies(event);
        return resError(event, 401, 'token 已失效')
    }

    // 5.3 检查用户是否存在或被禁用
    const user = await findUserByIdDao(authenticatedUser.id);
    if (!user) {
        // 清除认证 cookie
        clearAuthCookies(event);
        return resError(event, 401, '用户不存在')
    }
    if (user.status === UserStatus.INACTIVE) {
        // 清除认证 cookie
        clearAuthCookies(event);
        return resError(event, 401, '用户被禁用')
    }

    // 5.4 将查询的用户角色设置到 authenticatedUser 中
    authenticatedUser.roles = user.userRoles.map((role) => role.roleId);

    // 6. 设置上下文，后续 API 可以通过 event.context.auth 获取当前用户
    event.context.auth = {
        user: authenticatedUser,
        type: authType,
        token: token,
    };
})