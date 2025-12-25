/**
 * 用户加密配置数据访问层
 *
 * 封装所有与用户加密配置表相关的数据库操作
 */

/**
 * 用户加密配置创建参数
 */
export interface CreateUserEncryptionParams {
    userId: number
    recipient: string
    encryptedIdentity: string
    encryptedRecoveryKey?: string
}

/**
 * 用户加密配置更新参数
 */
export interface UpdateUserEncryptionParams {
    encryptedIdentity?: string
    encryptedRecoveryKey?: string | null
}

/**
 * 获取用户加密配置
 * @param userId 用户 ID
 * @returns 用户加密配置或 null
 */
export async function getUserEncryptionDao(userId: number): Promise<userEncryptions | null> {
    try {
        const result = await prisma.userEncryptions.findUnique({
            where: { userId }
        })
        return result
    } catch (error) {
        logger.error(`获取用户加密配置失败: ${error}`)
        throw error
    }
}

/**
 * 创建用户加密配置
 * @param params 创建参数
 * @returns 创建的用户加密配置
 */
export async function createUserEncryptionDao(params: CreateUserEncryptionParams): Promise<userEncryptions> {
    try {
        const result = await prisma.userEncryptions.create({
            data: {
                userId: params.userId,
                recipient: params.recipient,
                encryptedIdentity: params.encryptedIdentity,
                encryptedRecoveryKey: params.encryptedRecoveryKey,
            }
        })
        logger.debug(`创建用户加密配置成功:`, { userId: params.userId })
        return result
    } catch (error) {
        logger.error(`创建用户加密配置失败: ${error}`)
        throw error
    }
}

/**
 * 更新用户加密配置
 * @param userId 用户 ID
 * @param params 更新参数
 * @returns 更新后的用户加密配置
 */
export async function updateUserEncryptionDao(
    userId: number,
    params: UpdateUserEncryptionParams
): Promise<userEncryptions> {
    try {
        const result = await prisma.userEncryptions.update({
            where: { userId },
            data: {
                ...params,
                updatedAt: new Date()
            }
        })
        logger.debug(`更新用户加密配置成功:`, { userId })
        return result
    } catch (error) {
        logger.error(`更新用户加密配置失败: ${error}`)
        throw error
    }
}

/**
 * 创建或更新用户加密配置（upsert）
 * @param params 创建参数
 * @returns 用户加密配置
 */
export async function upsertUserEncryptionDao(params: CreateUserEncryptionParams): Promise<userEncryptions> {
    try {
        const result = await prisma.userEncryptions.upsert({
            where: { userId: params.userId },
            create: {
                userId: params.userId,
                recipient: params.recipient,
                encryptedIdentity: params.encryptedIdentity,
                encryptedRecoveryKey: params.encryptedRecoveryKey,
            },
            update: {
                recipient: params.recipient,
                encryptedIdentity: params.encryptedIdentity,
                encryptedRecoveryKey: params.encryptedRecoveryKey,
                updatedAt: new Date()
            }
        })
        logger.debug(`upsert 用户加密配置成功:`, { userId: params.userId })
        return result
    } catch (error) {
        logger.error(`upsert 用户加密配置失败: ${error}`)
        throw error
    }
}

/**
 * 删除用户加密配置
 * @param userId 用户 ID
 */
export async function deleteUserEncryptionDao(userId: number): Promise<void> {
    try {
        await prisma.userEncryptions.delete({
            where: { userId }
        })
        logger.debug(`删除用户加密配置成功:`, { userId })
    } catch (error) {
        logger.error(`删除用户加密配置失败: ${error}`)
        throw error
    }
}
