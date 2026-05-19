import { describe, expect, it } from 'vitest'
import type { LUser } from '../../src/legacyTypes'
import { deriveUserRoles, transformUser } from '../../src/transforms/user'

const base = {
  id: 1, name: '张三', username: 'zhangsan', email: null, phone: '13800000000',
  password: 'hash', role: 'user', status: 1, company: null, profile: null,
  inviteCode: 'ABC123', invitedBy: null, openid: null, unionid: null,
  registerChannel: 'web', apiKey: 'uuid',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-02T00:00:00Z'),
  deletedAt: null,
} as unknown as LUser

describe('transformUser', () => {
  it('直拷字段、丢弃 role、apiKey 平移、contractExportSignature 置 null', () => {
    const r = transformUser(base)
    expect(r.id).toBe(1)
    expect(r.phone).toBe('13800000000')
    expect(r.inviteCode).toBe('ABC123')
    expect(r.contractExportSignature).toBeNull()
    expect('role' in r).toBe(false)
    expect(r.apiKey).toBe('uuid')
  })
})

describe('deriveUserRoles', () => {
  it('普通用户绑基础角色「普通用户」', () => {
    expect(deriveUserRoles(base, 1, [2, 3])).toEqual([{ userId: 1, roleId: 1 }])
  })
  it('role=admin 额外绑管理类角色（基础 + admin + super_admin）', () => {
    const rows = deriveUserRoles({ ...base, role: 'admin' } as LUser, 1, [2, 3])
    expect(rows).toEqual([
      { userId: 1, roleId: 1 },
      { userId: 1, roleId: 2 },
      { userId: 1, roleId: 3 },
    ])
  })
  it('admin 无额外管理角色时仅绑基础角色', () => {
    expect(deriveUserRoles({ ...base, role: 'admin' } as LUser, 1, [])).toEqual([{ userId: 1, roleId: 1 }])
  })
})
