/**
 * 使用恢复密钥重置密码 API
 * 
 * 用于使用恢复密钥重置加密密码
 */

// import { getUserEncryptionDao, updateUserEncryptionDao } from '~~/server/services/encryption/encryption.dao'

export default defineEventHandler(async (event) => {
    try {
        const user = event.context.auth.user

        // 使用 zod 进行参数验证
        const body = z.object({
            newEncryptedIdentity: z.string({ message: '新的加密私钥不能为空' }),
            newEncryptedRecoveryKey: z.string().optional(),
        }).parse(await readBody(event))

        const { newEncryptedIdentity, newEncryptedRecoveryKey } = body

        // 检查用户是否已有加密配置
        const existing = await getUserEncryptionDao(user.id)

        if (!existing) {
            return resError(event, 404, '未找到加密配置')
        }

        if (!existing.encryptedRecoveryKey) {
            return resError(event, 400, '未设置恢复密钥')
        }

        // 更新加密配置（客户端已验证恢复密钥并重新加密私钥）
        await updateUserEncryptionDao(user.id, {
            encryptedIdentity: newEncryptedIdentity,
            encryptedRecoveryKey: newEncryptedRecoveryKey ?? null,  // 恢复密钥使用后需要重新生成
        })

        return resSuccess(event, '密码重置成功', { success: true })
    } catch (error) {
        return resError(event, 500, parseErrorMessage(error, '密码重置失败'))
    }
})
