/**
 * 用户数据访问层
 */
import type { Prisma } from '#shared/types/prisma'
import type { roles, userRoles, users } from '~~/generated/prisma/client'

/**
 * 查询用户时附带 active 角色的 include 子句。
 *
 * 必须过滤掉：1) 软删的 user-role 关联；2) 已禁用 / 软删的 role。
 * 否则 02.auth.ts 会把已撤销的角色 ID 写进 JWT，依赖 `event.context.auth.user.roles`
 * 的代码就会越权（H1）。
 */
const includeActiveRoles = {
    userRoles: {
        where: {
            deletedAt: null,
            role: { status: 1, deletedAt: null },
        },
        include: { role: true },
    },
} as const

/**
 * 创建用户
 * @param data 用户创建数据
 * @returns 用户
 */
export const createUserDao = async (data: Prisma.usersCreateInput, tx?: Prisma.TransactionClient): Promise<users & { userRoles: userRoles[] }> => {
    try {
        const user = await (tx || prisma).users.create({
            data: { ...data, createdAt: new Date(), updatedAt: new Date() },
            include: {
                userRoles: true
            }
        })
        return user
    } catch (error) {
        logger.error('创建用户失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询用户。findUnique 不支持 nested where，所以走 findFirst + includeActiveRoles。
 */
export const findUserByIdDao = async (id: number, tx?: any): Promise<users & { userRoles: (userRoles & { roles: roles })[] } | null> => {
    try {
        return await (tx || prisma).users.findFirst({
            where: { id, deletedAt: null },
            include: includeActiveRoles,
        })
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
export const findUserByPhoneDao = async (phone: string, tx?: any): Promise<users & { userRoles: (userRoles & { roles: roles })[] } | null> => {
    try {
        return await (tx || prisma).users.findFirst({
            where: { phone, deletedAt: null },
            include: includeActiveRoles,
        })
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
export const findUserByInviteCodeDao = async (inviteCode: string, tx?: any): Promise<users & { userRoles: (userRoles & { roles: roles })[] } | null> => {
    try {
        return await (tx || prisma).users.findFirst({
            where: { inviteCode, deletedAt: null },
            include: includeActiveRoles,
        })
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
export const findUserByUsernameDao = async (username: string, tx?: any): Promise<users & { userRoles: (userRoles & { roles: roles })[] } | null> => {
    try {
        return await (tx || prisma).users.findFirst({
            where: { username, deletedAt: null },
            include: includeActiveRoles,
        })
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
export const updateUserPasswordDao = async (id: number, password: string, tx?: Prisma.TransactionClient): Promise<users> => {
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

/**
 * 更新用户资料
 * @param id 用户ID
 * @param data 用户资料
 * @returns 用户
 */
export const updateUserProfileDao = async (id: number, data: Prisma.usersUpdateInput, tx?: Prisma.TransactionClient): Promise<users> => {
    try {
        const user = await (tx || prisma).users.update({
            where: { id, deletedAt: null },
            data: { ...data, updatedAt: new Date() }
        })
        return user
    } catch (error) {
        logger.error('更新用户资料失败：', error)
        throw error
    }
}

/**
 * 读取用户合同导出署名所需字段（name + contractExportSignature）。
 * 仅 select 必要列，不带角色 include。
 */
export const findUserExportSignatureDao = async (
    id: number,
): Promise<{ name: string; contractExportSignature: string | null } | null> => {
    return prisma.users.findFirst({
        where: { id, deletedAt: null },
        select: { name: true, contractExportSignature: true },
    })
}
