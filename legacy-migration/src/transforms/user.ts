import type { LUser } from '../legacyTypes'

/** §8.1 users：直拷大部分字段；丢弃 role（→衍生 user_roles）；apiKey 平移到新库；新增 contractExportSignature=null */
export function transformUser(o: LUser) {
  return {
    id: o.id,
    name: o.name,
    username: o.username,
    email: o.email,
    phone: o.phone,
    password: o.password,
    status: o.status,
    company: o.company,
    profile: o.profile,
    contractExportSignature: null,
    inviteCode: o.inviteCode,
    invitedBy: o.invitedBy,
    openid: o.openid,
    unionid: o.unionid,
    registerChannel: o.registerChannel,
    apiKey: o.apiKey,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/**
 * §6.4：每个用户都绑基础角色「普通用户」；旧 role='admin' 额外绑管理类角色。
 * 新项目每个注册用户都有「普通用户」角色（register.post.ts 固定 roleIds:[1]），
 * 用户菜单 / 接口权限均由 user_roles 解析，迁移须保持一致，否则迁移用户无菜单无权限。
 */
export function deriveUserRoles(
  o: LUser,
  baseRoleId: number,
  adminExtraRoleIds: number[],
): { userId: number; roleId: number }[] {
  const roleIds = o.role === 'admin' ? [baseRoleId, ...adminExtraRoleIds] : [baseRoleId]
  return roleIds.map(roleId => ({ userId: o.id, roleId }))
}
