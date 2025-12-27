/**
 * 用户服务层
 */

/**
 * 创建用户（带角色分配）
 * @param data 用户创建数据
 * @param options 可选配置
 * @param options.roleIds 角色ID数组
 * @param options.tx 外部事务实例
 * @returns 创建的用户
 */
export const createUserService = async (
    data: Prisma.usersCreateInput,
    options?: { roleIds?: number[], tx?: Prisma.TransactionClient }
): Promise<users> => {
    const { roleIds = [], tx } = options || {}

    // 如果有外部事务，使用外部事务；否则创建新事务
    if (tx) {
        return executeCreateUser(data, roleIds, tx)
    }

    // 使用 Prisma 事务保持操作一致性
    return prisma.$transaction(async (transaction) => {
        return executeCreateUser(data, roleIds, transaction as Prisma.TransactionClient)
    })
}

/**
 * 执行创建用户的核心逻辑
 * @param data 用户创建数据
 * @param roleIds 角色ID数组
 * @param tx 事务实例
 * @returns 创建的用户
 */
async function executeCreateUser(
    data: Prisma.usersCreateInput,
    roleIds: number[],
    tx: Prisma.TransactionClient
): Promise<users> {
    try {
        // 如果指定了角色，先验证角色是否存在
        if (roleIds.length > 0) {
            const existingRoles = await findRoleByIdsDao(roleIds)
            const existingRoleIds = existingRoles.map((role: { id: number }) => role.id)
            const invalidRoleIds = roleIds.filter(id => !existingRoleIds.includes(id))

            if (invalidRoleIds.length > 0) {
                throw new Error(`角色不存在或已禁用: ${invalidRoleIds.join(', ')}`)
            }
        }

        // 创建用户
        const user = await createUserDao(data, tx)

        // 创建用户角色关联
        if (roleIds.length > 0) {
            for (const roleId of roleIds) {
                await createUserRoleDao(user.id, roleId, tx)
            }
        }

        return user
    } catch (error: any) {
        logger.error('创建用户失败:', error)
        throw error
    }
}
