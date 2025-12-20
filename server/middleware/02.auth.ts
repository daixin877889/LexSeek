// 鉴权中间件
export default defineEventHandler(async (event) => {
    // 获取请求 URL
    const url = getRequestURL(event);

    // 1. 定义公开路径白名单 (不需要鉴权的接口)
    const publicPaths = ['/api/v1/auth/register', '/api/v1/auth/login', '/api/v1/auth/reset-password', '/api/v1/sms/send'];
    const isApiRequest = url.pathname.startsWith('/api');
    const isPublic = publicPaths.some(path => url.pathname.startsWith(path));
    if (!isApiRequest || isPublic) {
        return; // 放行
    }

    // 2. 初始化鉴权结果上下文
    let authenticatedUser: JwtPayload | null = null;
    let authType: 'cookie' | 'token' | null = null;
    let token: string | undefined = undefined;

    // 2.1 优先从请求头中获取 token
    const authHeader = getHeader(event, 'Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7); // 比 split 更高效
        authType = 'token';
    }

    // 2.2 如果请求头中没有 token 则从 cookie 中获取 auth_token
    if (!token) {
        token = getCookie(event, 'auth_token');
        if (token) {
            authType = 'cookie';
        }
    }

    // 3. 如果 token 不存在则返回401
    if (!token) {
        return resError(event, 401, '未授权')
    }

    // 4. 验证 token
    try {
        authenticatedUser = JwtUtil.verifyToken(token);
    } catch (error) {
        // token 无效或已过期
        return resError(event, 401, '未授权')
    }

    // 4.1 如果验证失败则返回401
    if (!authenticatedUser || !authenticatedUser.id) {
        return resError(event, 401, '未授权')
    }

    // 4.2 检查 token 是否在黑名单中
    const tokenBlacklist = await findTokenBlacklistByTokenDao(token);
    if (tokenBlacklist) {
        return resError(event, 401, 'token 已失效')
    }

    // 4.3 检查用户是否存在或被禁用
    const user = await findUserByIdDao(authenticatedUser.id);
    if (!user) {
        return resError(event, 401, '用户不存在')
    }
    if (user.status === UserStatus.INACTIVE) {
        return resError(event, 401, '用户被禁用')
    }

    // 5. 设置上下文，后续 API 可以通过 event.context.auth 获取当前用户
    event.context.auth = {
        user: authenticatedUser,
        type: authType,
        token: token,
    };
})