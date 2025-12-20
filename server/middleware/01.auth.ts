
// 鉴权中间件
export default defineEventHandler(async (event) => {
    // 获取请求 URL
    const url = getRequestURL(event);

    // 1. 定义公开路径白名单 (不需要鉴权的接口)
    const publicPaths = ['/api/v1/auth/register', '/api/v1/auth/login', '/api/v1/sms/send'];
    const isApiRequest = url.pathname.startsWith('/api');
    const isPublic = publicPaths.some(path => url.pathname.startsWith(path));
    if (!isApiRequest || isPublic) {
        return; // 放行
    }

    // 2. 初始化鉴权结果上下文
    let authenticatedUser = null;
    let authType: 'cookie' | 'token' | 'api-key' | null = null;
    let token: string | undefined = undefined;

    token = getHeader(event, 'Authorization');
    // 2.1 优先从请求头中获取 token
    if (token && token.startsWith('Bearer ')) {
        token = token.split(' ')[1];
        authType = 'token';
    }

    // 2.2 如果请求头中没有 token 则从 cookie 中获取 auth_token
    if (!token) {
        token = getCookie(event, 'auth_token');
        authType = 'cookie';
    }

    // 3. 如果 token 不存在则返回401
    if (!token) {
        return createError({
            statusCode: 401,
            statusMessage: '未授权',
        });
    }

    // 4. 如果 token 存在则验证 token
    if (token) {
        const payload = JwtUtil.verifyToken(token);
        if (payload) {
            authenticatedUser = payload;
        }
    }

    // 4.1 如果验证失败则返回401
    if (!authenticatedUser || !authenticatedUser.id) {
        return createError({
            statusCode: 401,
            statusMessage: '未授权',
        });
    }

    // 4.2 如果用户不存在或被禁用
    const user = await findUserById(authenticatedUser.id);
    if (!user) {
        return createError({
            statusCode: 401,
            statusMessage: '用户不存在',
        });
    }
    if (user && user.status === UserStatus.INACTIVE) {
        return createError({
            statusCode: 401,
            statusMessage: '用户被禁用',
        });
    }

    // 5 如果用户存在且未被禁用则设置上下文,后续 API 可以通过 event.context.user 获取当前用户
    event.context.auth = {
        user: authenticatedUser,
        type: authType
    };
})