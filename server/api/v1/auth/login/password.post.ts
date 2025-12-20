/**
 * 手机号和密码登录
 *
 * 使用手机号和密码完成用户登录
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

        // 使用统一的 token 生成服务
        const token = generateAuthToken(event, {
            id: user.id,
            phone: user.phone,
            role: user.role,
            status: user.status,
        })

        // 使用统一的用户信息格式化服务
        return resSuccess(event, '登录成功', {
            token,
            user: formatUserResponse(user),
        })
    } catch (error: any) {
        logger.error('登录失败：', error)
        return resError(event, 400, parseErrorMessage(error, "登录失败"))
    }
})