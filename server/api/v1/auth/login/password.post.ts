/**
 * 手机号和密码登录
 *
 * 使用手机号和密码完成用户登录
 */
import { clearPasswordLoginFailureService, recordPasswordLoginFailureService, shouldRequirePasswordLoginCaptchaService } from '~~/server/services/security/loginRisk.service'
import { verifyAliyunCaptchaService } from '~~/server/services/security/aliyunCaptcha.service'
import { UserStatus } from '#shared/types/user'
import { parseErrorMessage } from '#shared/utils/apiResponse'
import { createLogger } from '#shared/utils/logger'
import { z } from '#shared/utils/zod'
import { generateAuthTokenService } from '~~/server/services/auth/authToken.service'
import { formatUserResponseService } from '~~/server/services/users/userResponse.service'
import { findUserByPhoneDao } from '~~/server/services/users/users.dao'

export default defineEventHandler(async (event) => {
    const logger = createLogger('Auth')
    try {
        const body = await readValidatedBody(event, (payload) => z.object({
            phone: z.string("手机号不能为空").regex(/^1[3-9]\d{9}$/, '手机号格式不正确'),
            password: z.string("密码不能为空").min(8, '密码至少8位').max(32, '密码最多32位'),
            captchaVerifyParam: z.string().optional(),
        }).parse(payload))

        const { phone, password, captchaVerifyParam } = body;

        const captchaRequirement = await shouldRequirePasswordLoginCaptchaService(event, phone)
        if (captchaRequirement.requireCaptcha) {
            if (!captchaVerifyParam?.trim()) {
                return resError(event, 429, '请完成安全验证后重试')
            }

            const captchaResult = await verifyAliyunCaptchaService({
                captchaVerifyParam,
                sceneKey: 'passwordLogin',
            })
            if (!captchaResult.success) {
                logger.warn('密码登录前验证码校验失败', {
                    phone,
                    degraded: captchaRequirement.degraded,
                    ...captchaResult,
                })
                return resError(event, 400, '安全验证失败，请重试')
            }
        }

        const failLogin = async (message: string) => {
            await recordPasswordLoginFailureService(event, phone)
            return resError(event, 401, message)
        }

        // 先查找用户
        const user = await findUserByPhoneDao(phone);
        if (!user) {
            return await failLogin('用户不存在')
        }
        if (user.status === UserStatus.INACTIVE) {
            return await failLogin('用户被禁用')
        }

        // 验证密码
        if (!user.password || user.password === '') {
            return await failLogin('该账号未设置密码，请使用短信验证码登录')
        }
        const isPasswordValid = await comparePassword(password, user.password);
        if (!isPasswordValid) {
            return await failLogin('密码错误')
        }

        await clearPasswordLoginFailureService(event, phone)

        // 使用统一的 token 生成服务
        const token = generateAuthTokenService(event, {
            id: user.id,
            phone: user.phone,
            roles: user.userRoles.map((role) => role.roleId),
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
