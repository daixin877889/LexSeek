/**
 * 发送短信验证码接口
 * @param event
 * @returns
 */
import { canUseAliyunCaptchaSceneService, verifyAliyunCaptchaService } from '~~/server/services/security/aliyunCaptcha.service'

export default defineEventHandler(async (event) => {
    const logger = createLogger('SMS')
    try {
        const config = useRuntimeConfig()
        // 从配置获取（配置单位为秒，转换为毫秒）
        const RATE_LIMIT_MS = config.aliyun.sms.rateLimitMs * 1000
        const CODE_EXPIRE_MS = config.aliyun.sms.codeExpireMs * 1000

        // 1. 数据验证
        const schema = z.object({
            phone: z.string({ message: '手机号不能为空' }).regex(/^1[3-9]\d{9}$/, "手机号格式不正确"),
            type: z.enum(SmsType, {
                message: "验证码类型不正确"
            }),
            captchaVerifyParam: z.string().optional(),
        })

        const body = await readValidatedBody(event, (payload) => schema.parse(payload))
        const { phone, type, captchaVerifyParam } = body
        const captchaSceneMap: Record<SmsType, 'loginSms' | 'registerSms' | 'resetPasswordSms'> = {
            [SmsType.LOGIN]: 'loginSms',
            [SmsType.REGISTER]: 'registerSms',
            [SmsType.RESET_PASSWORD]: 'resetPasswordSms',
        }

        // 2. 检查用户状态（如果用户存在）
        const userResult = await findUserByPhoneDao(phone)

        if (userResult && userResult.status === UserStatus.INACTIVE) {
            return resError(event, 400, '用户已禁用，无法发送验证码')
        }

        // 3. 查询现有验证码记录
        const existingRecord = await findSmsRecordByPhoneAndTypeDao(phone, type)

        const now = new Date()

        if (existingRecord) {
            // Prisma 扩展已自动处理时区转换，可以直接比较
            const isExpired = existingRecord.expiredAt < now
            const isWithinRateLimit = existingRecord.createdAt &&
                existingRecord.createdAt.getTime() > now.getTime() - RATE_LIMIT_MS

            // 3.1 如果未过期且在频率限制内，拒绝发送
            if (!isExpired && isWithinRateLimit) {
                return resError(event, 400, '验证码获取频率过高，请稍后再试')
            }

            // 3.2 删除旧记录（无论是否过期，都需要重新生成）
            await deleteSmsRecordByIdDao(existingRecord.id)
        }

        // 4. 当前场景启用了阿里云验证码时，先做服务端验签
        const sceneKey = captchaSceneMap[type]
        if (canUseAliyunCaptchaSceneService(sceneKey)) {
            if (!captchaVerifyParam?.trim()) {
                return resError(event, 400, '安全验证失败，请重试')
            }

            const captchaResult = await verifyAliyunCaptchaService({
                captchaVerifyParam,
                sceneKey,
            })
            if (!captchaResult.success) {
                logger.warn('短信发送前验证码校验失败', {
                    phone,
                    type,
                    sceneKey,
                    ...captchaResult,
                })
                return resError(event, 400, '安全验证失败，请重试')
            }
        }

        // 5. 生成新验证码并创建记录
        const code = generateSmsCode()
        const newRecord = await createSmsRecordDao(phone, type, code, CODE_EXPIRE_MS)

        // 只有启用时才发送短信
        if (config.aliyun.sms.enable) {
            const res = await AliSms.sendCaptchaSms(phone, code)
            logger.info('短信验证码发送成功：', res)

        }
        logger.info('短信验证码发送成功：', { phone, code })
        return resSuccess(event, '发送成功', {
            expiredAt: newRecord.expiredAt
        })
    } catch (error: any) {
        // 记录错误日志
        logger.error('发送短信验证码接口错误：', error)
        return resError(event, 400, parseErrorMessage(error, "短信发送失败"))
    }
})
