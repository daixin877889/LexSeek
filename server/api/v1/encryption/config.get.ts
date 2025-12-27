/**
 * 获取用户加密配置 API
 * 
 * 返回用户的公钥、加密后的私钥、是否有恢复密钥
 */

// import { getUserEncryptionDao } from '~~/server/services/encryption/encryption.dao'

export default defineEventHandler(async (event) => {
    try {
        const user = event.context.auth.user

        // 获取用户加密配置
        const config = await getUserEncryptionDao(user.id)

        if (!config) {
            return resSuccess(event, '获取加密配置成功', null)
        }

        return resSuccess(event, '获取加密配置成功', {
            recipient: config.recipient,
            encryptedIdentity: config.encryptedIdentity,
            hasRecoveryKey: !!config.encryptedRecoveryKey,
        })
    } catch (error) {
        return resError(event, 500, parseErrorMessage(error, '获取加密配置失败'))
    }
})
