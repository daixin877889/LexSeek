/**
 * 手机号和验证码登录
 *
 * 使用短信验证码完成用户登录
 */
export default defineEventHandler(async (event) => {
    const logger = createLogger('Auth')
    try {
        const body = await readValidatedBody(event, (payload) => z.object({
            phone: z.string("手机号不能为空").regex(/^1[3-9]\d{9}$/, '手机号格式不正确'),
            code: z.string("验证码不能为空"),
        }).parse(payload))

        const { phone, code } = body;

        // 先查找用户
        const user = await findUserByPhoneDao(phone);
        if (!user) {
            return resError(event, 401, '用户不存在')
        }
        if (user.status === UserStatus.INACTIVE) {
            return resError(event, 401, '用户被禁用')
        }

        // 使用统一的验证码验证服务
        const verificationResult = await verifySmsCode(phone, code, SmsType.LOGIN)
        if (!verificationResult.success) {
            return resError(event, verificationResult.errorCode!, verificationResult.error!)
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
            user: formatUserResponseService(user),
        })
    } catch (error: any) {
        logger.error('登录失败：', error)
        return resError(event, 400, parseErrorMessage(error, "登录失败"))
    }
})