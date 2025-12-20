/**
 * 手机号和验证码登录 
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
        const user = await findUserByPhone(phone);
        if (!user) {
            return resError(event, 401, '用户不存在')
        }
        if (user.status === UserStatus.INACTIVE) {
            return resError(event, 401, '用户被禁用')
        }

        // 验证验证码
        const smsRecord = await findSmsRecordByPhoneAndType(phone, SmsType.LOGIN);
        if (!smsRecord) {
            return resError(event, 400, '验证码不存在,请先获取验证码!')
        }

        if (smsRecord.expiredAt < new Date()) {
            await deleteSmsRecordById(smsRecord.id);
            return resError(event, 400, '验证码已过期')
        }
        if (smsRecord.code !== code) {
            return resError(event, 400, '验证码不正确')
        }
        await deleteSmsRecordById(smsRecord.id);
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
        return resError(event, 400, parseErrorMessage(error, "登录失败"))
    }
})