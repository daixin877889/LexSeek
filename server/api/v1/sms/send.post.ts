import { SmsType } from "../../../../shared/types/sms"
import { z } from "../../../../shared/utils/zod"
/**
 * 发送短信验证码接口
 * @param event
 * @returns
 */
export default defineEventHandler(async (event) => {
    console.log(event)
    try {
        // 数据验证
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

        // 生成验证码
        const code = generateSmsCode();

        return {
            code: 200,
            message: "发送成功",
            data: { code }
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