/**
 * 登录接口
 * @param event
 * @returns
 */
export default defineEventHandler(async (event) => {
    const { phone } = getQuery(event)
    if (!phone) {
        return {
            code: 400,
            message: "手机号不能为空"
        }
    }
    if (!validatePhone(phone as string)) {
        return {
            code: 400,
            message: "手机号格式不正确"
        }
    }
    const user = await prisma.users.findUnique({
        where: {
            phone: phone as unknown as string
        }
    })
    if (!user) {
        return {
            code: 400,
            message: "用户不存在"
        }
    }
    return user
})