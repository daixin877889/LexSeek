/**
 * 发送短信验证码接口
 * @param event
 * @returns
 */
export default defineEventHandler(async (event) => {

    try {
        // 1. 数据验证
        const schema = z.object({
            phone: z.string().regex(/^1[3-9]\d{9}$/, "手机号格式不正确"),
            type: z.enum(SmsType, {
                message: "验证码类型不正确"
            })
        })

        const body = await readValidatedBody(event, (payload) => schema.parse(payload))
        const { phone, type } = body

        // 如果用户已经存在且状态为0，则抛出错误
        const userResult = await prisma.users.findFirst({
            where: { phone, deletedAt: null },
            select: { id: true, status: true }
        });

        if (userResult && userResult.status === 0) {
            return {
                code: 400,
                message: "用户已禁用，无法发送验证码"
            }
        }

        // 2. 生成验证码
        const code = generateSmsCode();

        // 4. 检查是否存在过期验证码
        const smsResult = await prisma.smsRecords.findFirst({
            where: { phone, type, deletedAt: null }
        });

        console.log(smsResult?.expiredAt)

        // 4.1 如果存在过期验证码，则删除
        if (smsResult && smsResult.expiredAt < new Date()) {
            await prisma.smsRecords.delete({
                where: { id: smsResult.id }
            });
        }

        // 4.2 检查验证码获取是否超出频率
        if (smsResult && smsResult.createdAt && smsResult.createdAt < new Date(Date.now() - 1000 * 60 * 1)) {
            return {
                code: 400,
                message: "验证码获取频率过高，请稍后再试"
            }
        }

        // 4.3 如果验证码不存在，则创建
        if (!smsResult) {
            await prisma.smsRecords.create({
                data: {
                    phone,
                    code,
                    type,
                    expiredAt: new Date(Date.now() + 1000 * 60 * 5),
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            });
        }


        return {
            code: 200,
            message: "发送成功",
            data: { smsResult }
        }
    } catch (error: any) {
        if (JSON.parse(error.message) || JSON.parse(error.message).length > 0) {
            return {
                code: 400,
                message: JSON.parse(error.message).map((error: any) => error.message).join(",")
            }
        }
        return {
            code: 500,
            message: "服务器错误"
        }
    }

})