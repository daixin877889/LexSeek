import { UserRole } from '../../../../app/generated/prisma/enums'
/**
 * 手机验证码注册
 * @param event
 * @returns
 */
export default defineEventHandler(async (event) => {
    const logger = createLogger('Auth')
    try {
        const config = useRuntimeConfig()
        // 从配置获取（配置单位为秒，转换为毫秒）
        const CODE_EXPIRE_MS = config.aliyun.sms.codeExpireMs * 1000
        // 参数验证规则
        const schema = z.object({
            phone: z.string().regex(/^1[3-9]\d{9}$/, "手机号格式不正确"),
            code: z.string().regex(/^\d{6}$/, "验证码格式不正确"),
            name: z.string().max(20, "姓名长度不能超过20个字符").optional(),
            username: z.string().max(20, "用户名长度不能超过20个字符").optional(),
            password: z.string().regex(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/, "密码至少8位，至少包含字母和数字"),
            company: z.string().max(50, "公司名称长度不能超过100个字符").optional(),
            profile: z.string().max(200, "个人简介长度不能超过200个字符").optional(),
            invitedBy: z.string().optional(),
        })
        const body = await readValidatedBody(event, (payload) => schema.parse(payload))
        const { phone, code } = body

        // 查询用户是否存在
        const user = await prisma.users.findFirst({
            where: { phone, deletedAt: null },
            select: { id: true, status: true }
        })
        if (user) {
            return {
                code: 400,
                message: '用户已存在',
            }
        }
        // 验证验证码
        const smsRecord = await prisma.smsRecords.findFirst({
            where: { phone, type: SmsType.REGISTER, deletedAt: null },
            select: { id: true, code: true, createdAt: true, type: true, expiredAt: true }
        })
        if (!smsRecord) {
            return {
                code: 400,
                message: '验证码不存在',
            }
        }
        if (smsRecord.expiredAt < new Date()) {
            await prisma.smsRecords.delete({
                where: { id: smsRecord.id },
            })
            return {
                code: 400,
                message: '验证码已过期',
            }
        }
        if (smsRecord.code !== code) {
            return {
                code: 400,
                message: '验证码不正确',
            }
        }
        await prisma.smsRecords.delete({
            where: { id: smsRecord.id },
        })
        // 创建用户
        const newUser = await prisma.users.create({
            data: {
                phone,
                name: `用户${phone.slice(-4)}`,
                username: `用户${phone.slice(-4)}`,
                status: 1,
                role: UserRole.USER,
            },
            select: { id: true, status: true }
        })
        return {
            code: 200,
            message: '注册成功',
            data: newUser,
        }
    } catch (error: any) {
        logger.error('注册接口错误：', error)
        if (JSON.parse(error.message) && JSON.parse(error.message).length > 0) {
            return {
                code: 400,
                message: JSON.parse(error.message).map((e: any) => e.message).join(", ")
            }
        }
        return {
            code: 500,
            message: error.message || "注册失败",
        }
    }
})