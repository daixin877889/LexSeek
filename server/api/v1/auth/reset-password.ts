/**
 * 重置密码
 *
 * 使用短信验证码重置用户密码
 */
export default defineEventHandler(async (event) => {
    const logger = createLogger('Auth')
    try {
        const body = await readValidatedBody(event, (payload) => z.object({
            phone: z.string("手机号不能为空").regex(/^1[3-9]\d{9}$/, '手机号格式不正确'),
            code: z.string("验证码不能为空"),
            newPassword: z.string("密码不能为空").min(8, '密码至少8位').max(32, '密码最多32位'),
        }).parse(payload))

        const { phone, code, newPassword } = body;

        // 先查找用户
        const user = await findUserByPhoneDao(phone);
        if (!user) {
            return resError(event, 401, '用户不存在')
        }
        if (user.status === UserStatus.INACTIVE) {
            return resError(event, 401, '用户被禁用')
        }

        // 使用统一的验证码验证服务
        const verificationResult = await verifySmsCode(phone, code, SmsType.RESET_PASSWORD)
        if (!verificationResult.success) {
            return resError(event, verificationResult.errorCode!, verificationResult.error!)
        }

        // 加密新密码
        const hashedPassword = await generatePassword(newPassword);
        // 更新密码
        await updateUserPasswordDao(user.id, hashedPassword);

        // 从 cookie 中获取 token 并加入黑名单
        const config = useRuntimeConfig();
        const token = getCookie(event, config.auth.cookieName);
        if (token) {
            try {
                const decoded = JwtUtil.verifyToken(token) as JwtPayload & { exp?: number };
                if (decoded && decoded.exp) {
                    await addTokenBlacklistDao(token, user.id, new Date(decoded.exp * 1000));
                }
            } catch {
                // token 无效或已过期，忽略
            }
        }

        // 清除认证 cookie
        clearAuthCookies(event);

        return resSuccess(event, '重置密码成功', {})
    } catch (error: any) {
        logger.error('重置密码失败：', error)
        return resError(event, 400, parseErrorMessage(error, "重置密码失败"))
    }
})