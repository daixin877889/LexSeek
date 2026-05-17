import type { NewPrismaClient } from './clients'
import { log, warn } from './logger'

/**
 * 关键账号角色补绑配置：手机号 → 角色 code 列表。
 * 演练阶段按实际管理员名单与新库 roles 表的 code 填写。
 */
const ADMIN_BINDINGS: { phone: string; roleCodes: string[] }[] = [
  // 示例（执行前按真实名单替换）：
  // { phone: '13064768490', roleCodes: ['super_admin'] },
]

/** 按手机号给关键账号补绑角色（幂等：user_roles 有 (userId,roleId) 唯一约束） */
export async function bindAdminRoles(next: NewPrismaClient): Promise<void> {
  if (ADMIN_BINDINGS.length === 0) {
    warn('[adminRoles] 未配置关键账号角色绑定，跳过（如需请填写 ADMIN_BINDINGS）')
    return
  }
  for (const { phone, roleCodes } of ADMIN_BINDINGS) {
    const user = await next.users.findUnique({ where: { phone }, select: { id: true } })
    if (!user) {
      warn(`[adminRoles] 手机号 ${phone} 在新库无对应用户，跳过`)
      continue
    }
    for (const code of roleCodes) {
      const role = await next.roles.findUnique({ where: { code }, select: { id: true } })
      if (!role) {
        warn(`[adminRoles] 角色 code '${code}' 不存在，跳过`)
        continue
      }
      await next.userRoles.upsert({
        where: { idx_user_role_unique: { userId: user.id, roleId: role.id } },
        update: {},
        create: { userId: user.id, roleId: role.id },
      })
      log(`[adminRoles] ${phone} 绑定角色 ${code}`)
    }
  }
}
