/**
 * 用户响应格式化服务
 *
 * 提供用户信息的安全格式化功能
 * 确保返回给客户端的用户信息不包含敏感字段
 */

/**
 * 安全的用户信息（排除敏感字段）
 *
 * 用于 API 响应中返回的用户信息
 * 不包含 password、deletedAt 等敏感字段
 */
export interface SafeUserInfo {
    /** 用户 ID */
    id: number
    /** 用户姓名 */
    name: string | null
    /** 用户名 */
    username: string | null
    /** 手机号 */
    phone: string
    /** 电子邮箱 */
    email: string | null
    /** 用户角色 */
    role: string
    /** 用户状态 */
    status: number
    /** 所属公司/律所 */
    company: string | null
    /** 个人简介 */
    profile: string | null
    /** 邀请码 */
    inviteCode: string | null
}

/**
 * 格式化用户信息为安全响应格式
 *
 * 从完整的用户对象中提取安全字段，排除敏感信息
 * 确保 password、deletedAt 等字段不会泄露给客户端
 *
 * @param user 完整用户对象（来自数据库）
 * @returns 安全的用户信息，仅包含可公开的字段
 */
export const formatUserResponseService = (user: users): SafeUserInfo => {
    return {
        id: user.id,
        name: user.name,
        username: user.username,
        phone: user.phone,
        email: user.email,
        role: user.role,
        status: user.status,
        company: user.company,
        profile: user.profile,
        inviteCode: user.inviteCode,
    }
}
