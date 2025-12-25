/**
 * 修改加密密码 API
 * 
 * 用于修改加密密码后更新加密后的私钥
 */

import { getUserEncryptionDao, updateUserEncryptionDao } from '~~/server/services/encryption/encryption.dao'

export default defineEventHandler(async (event) => {
    try {
        const user = event.context.auth.user

        // 使用 zod 进行参数验证
        const body = z.object({
            encryptedIdentity: z.string({ message: '加密后的私钥不能为空' }),
            encryptedRecoveryKey: z.string().optional(),
        }).parse(await readBody(event))

        const { encryptedIdentity, encryptedRecoveryKey } = body

        // 检查用户是否已有加密配置
        const existing = await getUserEncryptionDao(user.id)

        if (!existing) {
            return resError(event, 404, '未找到加密配置，请先初始化')
        }

        // 更新加密配置
        await updateUserEncryptionDao(user.id, {
            encryptedIdentity,
            ...(encryptedRecoveryKey !== undefined && { encryptedRecoveryKey }),
        })

        return resSuccess(event, '修改加密密码成功', { success: true })
    } catch (error) {
        return resError(event, 500, parseErrorMessage(error, '修改加密密码失败'))
    }
})
