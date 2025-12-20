/**
 * 手机号和密码登录 
 */
export default defineEventHandler(async (event) => {
    const logger = createLogger('Auth')
    try {
        const body = await readValidatedBody(event, (payload) => z.object({
            phone: z.string("手机号不能为空").regex(/^1[3-9]\d{9}$/, '手机号格式不正确'),
            password: z.string("密码不能为空").min(8, '密码至少8位').max(32, '密码最多32位'),
        }).parse(payload))

        const { phone, password } = body;

        // 先查找用户
        const user = await findUserByPhone(phone);
        if (!user) {
            return resError(event, 401, '用户不存在')
        }
        if (user.status === UserStatus.INACTIVE) {
            return resError(event, 401, '用户被禁用')
        }

        // 验证密码
        if (!user.password || user.password === '') {
            return resError(event, 401, '该账号未设置密码，请使用短信验证码登录')
        }
        const isPasswordValid = await comparePassword(password, user.password);
        if (!isPasswordValid) {
            return resError(event, 401, '密码错误')
        }

        // 生成JWT令牌
        const token = JwtUtil.generateToken({
            id: user.id,
            phone: user.phone,
            role: user.role,
            status: user.status,
        })

        // 设置 HttpOnly Cookie
        setCookie(event, 'auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 30 // 30天
        });

        return resSuccess(event, '登录成功', {
            token,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                phone: user.phone,
                email: user.email,
                role: user.role,
                status: user.status,
                company: user.company,
                profile: user.profile,
                inviteCode: user.inviteCode,
            },
        })
    } catch (error: any) {
        logger.error('登录失败：', error)

        try {
            const parsed = JSON.parse(error.message);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return resError(event, 400, parsed.map((e: any) => e.message).join(", "))
            }
        } catch {
            return resError(event, 500, error.message || "登录失败")
        }
    }
})