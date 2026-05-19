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
  it('role=admin 衍生一条 user_roles，绑定传入的 adminRoleId', () => {
    const rows = deriveUserRoles({ ...base, role: 'admin' } as LUser, 2)
    expect(rows).toEqual([{ userId: 1, roleId: 2 }])
  })
  it('role=user 不衍生', () => {
    expect(deriveUserRoles(base, 2)).toEqual([])
  })
})
