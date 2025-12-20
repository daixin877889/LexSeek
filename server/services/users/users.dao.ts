import { Prisma } from '#shared/types/prisma'
/**
 * 用户数据访问层
 */

/**
 * 创建用户
 * @param data 用户创建数据
 * @returns 用户
 */
export const createUserDao = async (data: Prisma.usersCreateInput, tx?: any): Promise<users> => {
    try {
        const user = await (tx || prisma).users.create({
            data: { ...data, createdAt: new Date(), updatedAt: new Date() }
        })
        return user
    } catch (error) {
        logger.error('创建用户失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询用户
 * @param id 用户 ID
 * @returns 用户
 */
export const findUserByIdDao = async (id: number, tx?: any): Promise<users | null> => {
    try {
        const user = await (tx || prisma).users.findUnique({ where: { id, deletedAt: null } })
        if (!user) {
            return null
        }
        return user
    }
    catch (error) {
        logger.error('通过 ID 查询用户失败：', error)
        throw error
    }
}

/**
 * 通过手机号查询用户
 * @param phone 手机号
 * @returns 用户
 */
export const findUserByPhoneDao = async (phone: string, tx?: any): Promise<users | null> => {
    try {
        const user = await (tx || prisma).users.findFirst({
            where: { phone, deletedAt: null }
        })
        if (!user) {
            return null
        }
        return user
    } catch (error) {
        logger.error('通过手机号查询用户失败：', error)
        throw error
    }
}

/**
 * 通过邀请码查询用户
 * @param inviteCode 邀请码
 * @returns 用户
 */
export const findUserByInviteCodeDao = async (inviteCode: string, tx?: any): Promise<users | null> => {
    try {
        const user = await (tx || prisma).users.findFirst({
            where: { inviteCode, deletedAt: null }
        })
        if (!user) {
            return null
        }
        return user
    }
    catch (error) {
        logger.error('通过邀请码查询用户失败：', error)
        throw error
    }
}

/**
 * 通过用户名查询用户
 * @param username 用户名
 * @returns 用户
 */
export const findUserByUsernameDao = async (username: string, tx?: any): Promise<users | null> => {
    try {
        const user = await (tx || prisma).users.findFirst({
            where: { username, deletedAt: null }
        })
        if (!user) {
            return null
        }
        return user
    }
    catch (error) {
        logger.error('通过用户名查询用户失败：', error)
        throw error
    }
}

/**
 * 更新用户密码
 * @param id 用户ID
 * @param password 密码
 * @returns 用户
 */
export const updateUserPasswordDao = async (id: number, password: string, tx?: any): Promise<users> => {
    try {
        const user = await (tx || prisma).users.update({
            where: { id, deletedAt: null },
            data: { password, updatedAt: new Date() }
        })
        return user
    } catch (error) {
        logger.error('更新用户密码失败：', error)
        throw error
    }
}