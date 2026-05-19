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

/** §6.4：旧 role='admin' → 衍生一条 user_roles，绑定 adminRoleId；其余不衍生 */
export function deriveUserRoles(o: LUser, adminRoleId: number): { userId: number; roleId: number }[] {
  return o.role === 'admin' ? [{ userId: o.id, roleId: adminRoleId }] : []
}
