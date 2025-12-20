import { Prisma } from '#shared/types/prisma'
/**
 * 用户数据访问层
 */

/**
 * 创建用户
 * @param data 用户创建数据
 * @returns 用户
 */
export const createUser = async (data: Prisma.usersCreateInput): Promise<users> => {
    try {
        const user = await prisma.users.create({
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
export const findUserById = async (id: number): Promise<users | null> => {
    try {
        const user = await prisma.users.findUnique({ where: { id } })
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
export const findUserByPhone = async (phone: string): Promise<users | null> => {
    try {
        const user = await prisma.users.findFirst({
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
export const findUserByInviteCode = async (inviteCode: string): Promise<users | null> => {
    try {
        const user = await prisma.users.findFirst({
            where: { inviteCode }
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
export const findUserByUsername = async (username: string): Promise<users | null> => {
    try {
        const user = await prisma.users.findFirst({
            where: { username }
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