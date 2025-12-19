/**
 * 发送短信验证码接口
 * @param event
 * @returns
 */
export default defineEventHandler(async (event) => {
    const logger = createLogger('SMS')
    try {
        const config = useRuntimeConfig()
        // 从配置获取（配置单位为秒，转换为毫秒）
        const RATE_LIMIT_MS = config.aliyun.sms.rateLimitMs * 1000
        const CODE_EXPIRE_MS = config.aliyun.sms.codeExpireMs * 1000

        // 1. 数据验证
        const schema = z.object({
            phone: z.string().regex(/^1[3-9]\d{9}$/, "手机号格式不正确"),
            type: z.enum(SmsType, {
                message: "验证码类型不正确"
            })
        })

        const body = await readValidatedBody(event, (payload) => schema.parse(payload))
        const { phone, type } = body

        // 2. 检查用户状态（如果用户存在）
        const userResult = await prisma.users.findFirst({
            where: { phone, deletedAt: null },
            select: { id: true, status: true }
        })

        if (userResult && userResult.status === 0) {
            return {
                code: 400,
                message: "用户已禁用，无法发送验证码"
            }
        }

        // 3. 查询现有验证码记录
        const existingRecord = await prisma.smsRecords.findFirst({
            where: { phone, type, deletedAt: null }
        })

        const now = new Date()

        if (existingRecord) {
            // Prisma 扩展已自动处理时区转换，可以直接比较
            const isExpired = existingRecord.expiredAt < now
            const isWithinRateLimit = existingRecord.createdAt &&
                existingRecord.createdAt.getTime() > now.getTime() - RATE_LIMIT_MS

            // 3.1 如果未过期且在频率限制内，拒绝发送
            if (!isExpired && isWithinRateLimit) {
                return {
                    code: 400,
                    message: "验证码获取频率过高，请稍后再试"
                }
            }

            // 3.2 删除旧记录（无论是否过期，都需要重新生成）
            await prisma.smsRecords.delete({
                where: { id: existingRecord.id }
            })
        }

        // 4. 生成新验证码并创建记录
        const code = generateSmsCode()
        const expiredAt = new Date(now.getTime() + CODE_EXPIRE_MS)

        const newRecord = await prisma.smsRecords.create({
            data: {
                phone,
                code,
                type,
                expiredAt,
                createdAt: now,
                updatedAt: now
            }
        })

        // 只有启用时才发送短信
        if (config.aliyun.sms.enable) {
            const res = await sendCaptchaSms(phone, code)
            logger.info('短信验证码发送成功：', res)

        }
        logger.info('短信验证码发送成功：', { phone, code })
        return {
            code: 200,
            message: "发送成功",
            data: {
                expiredAt: newRecord.expiredAt
            }
        }
    } catch (error: any) {
        if (JSON.parse(error.message) && JSON.parse(error.message).length > 0) {
            return {
                code: 400,
                message: JSON.parse(error.message).map((e: any) => e.message).join(", ")
            }
        }

        // 记录错误日志
        logger.error('SMS send error:', error)

        return {
            code: 500,
            message: "服务器错误"
        }
    }
})
