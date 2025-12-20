/**
 * 重置密码 
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
        const user = await findUserByPhone(phone);
        if (!user) {
            return resError(event, 401, '用户不存在')
        }
        if (user.status === UserStatus.INACTIVE) {
            return resError(event, 401, '用户被禁用')
        }
        // 验证验证码
        const smsRecord = await findSmsRecordByPhoneAndType(phone, SmsType.RESET_PASSWORD);
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

        const hashedPassword = await generatePassword(newPassword);
        // 更新密码
        await updateUserPassword(user.id, hashedPassword);

        // TODO: 旧 token 加入黑名单

        return resSuccess(event, '重置密码成功', {})
    } catch (error: any) {
        logger.error('重置密码失败：', error)
        try {
            const parsed = JSON.parse(error.message);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return resError(event, 400, parsed.map((e: any) => e.message).join(", "))
            }
        } catch {
            return resError(event, 500, error.message || "重置密码失败")
        }
    }
})