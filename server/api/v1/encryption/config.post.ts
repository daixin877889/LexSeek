/**
 * 保存用户加密配置 API
 * 
 * 保存用户的公钥和加密后的私钥
 */

// import { upsertUserEncryptionDao } from '~~/server/services/encryption/encryption.dao'

export default defineEventHandler(async (event) => {
    try {
        const user = event.context.auth.user

        // 使用 zod 进行参数验证
        const body = z.object({
            recipient: z.string({ message: '公钥不能为空' })
                .startsWith('age1', { message: '公钥格式错误，应以 age1 开头' }),
            encryptedIdentity: z.string({ message: '加密后的私钥不能为空' }),
            encryptedRecoveryKey: z.string().optional(),
        }).parse(await readBody(event))

        const { recipient, encryptedIdentity, encryptedRecoveryKey } = body

        // 创建或更新加密配置
        await upsertUserEncryptionDao({
            userId: user.id,
            recipient,
            encryptedIdentity,
            encryptedRecoveryKey,
        })

        return resSuccess(event, '保存加密配置成功', { success: true })
    } catch (error) {
        return resError(event, 500, parseErrorMessage(error, '保存加密配置失败'))
    }
})
