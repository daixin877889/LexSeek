/**
 * 获取恢复密钥加密的私钥 API
 * 
 * 用于使用恢复密钥重置密码时获取加密数据
 */

import { getUserEncryptionDao } from '~~/server/services/encryption/encryption.dao'

export default defineEventHandler(async (event) => {
    try {
        const user = event.context.auth.user

        // 获取用户加密配置
        const config = await getUserEncryptionDao(user.id)

        if (!config) {
            return resError(event, 404, '未找到加密配置')
        }

        if (!config.encryptedRecoveryKey) {
            return resError(event, 400, '未设置恢复密钥')
        }

        // 返回恢复密钥加密的私钥
        return resSuccess(event, '获取成功', {
            encryptedRecoveryKey: config.encryptedRecoveryKey,
        })
    } catch (error) {
        return resError(event, 500, parseErrorMessage(error, '获取恢复密钥数据失败'))
    }
})
