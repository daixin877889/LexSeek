/**
 * server/api/v1/users/** handler 单元覆盖
 *
 * 9 个 handler:
 * - me.get.ts / password.put.ts / profile.put.ts / roles.get.ts / routers.get.ts
 * - permissions.get.ts / invitees.get.ts
 * - benefits/index.get.ts / benefits/[benefitCode].get.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

vi.mock('~~/server/services/users/users.dao', () => ({
    findUserByIdDao: vi.fn(),
    updateUserPasswordDao: vi.fn(),
    updateUserProfileDao: vi.fn(),
}))
vi.mock('~~/server/services/users/userResponse.service', () => ({
    formatUserResponseService: vi.fn((u: any) => ({ id: u.id, phone: u.phone, roles: [], status: u.status })),
}))
vi.mock('~~/server/services/users/tokenBlacklist.dao', () => ({
    addTokenBlacklistDao: vi.fn(),
}))
vi.mock('~~/server/services/auth/authToken.service', () => ({
    clearAuthCookiesService: vi.fn(),
}))
vi.mock('~~/server/services/rbac/permission.service', () => ({
    getUserPermissions: vi.fn(),
    checkIsSuperAdmin: vi.fn(),
}))
vi.mock('~~/server/services/rbac/userRoles.dao', () => ({
    findUserRolesByUserIdDao: vi.fn(),
    findUserRolesRouterByUserIdDao: vi.fn(),
}))
vi.mock('~~/server/services/membership/userBenefit.service', () => ({
    getUserBenefitSummaryService: vi.fn(),
    getUserBenefitDetailService: vi.fn(),
}))

;(globalThis as any).prisma = {
    users: { findMany: vi.fn(), findUnique: vi.fn() },
    routers: { findMany: vi.fn() },
}

import { findUserByIdDao, updateUserPasswordDao, updateUserProfileDao } from '~~/server/services/users/users.dao'
import { addTokenBlacklistDao } from '~~/server/services/users/tokenBlacklist.dao'
import { clearAuthCookiesService } from '~~/server/services/auth/authToken.service'
import { getUserPermissions, checkIsSuperAdmin } from '~~/server/services/rbac/permission.service'
import { findUserRolesByUserIdDao, findUserRolesRouterByUserIdDao } from '~~/server/services/rbac/userRoles.dao'
import { getUserBenefitSummaryService, getUserBenefitDetailService } from '~~/server/services/membership/userBenefit.service'

const mFindById = vi.mocked(findUserByIdDao)
const mUpdatePwd = vi.mocked(updateUserPasswordDao)
const mUpdateProfile = vi.mocked(updateUserProfileDao)
const mAddBlacklist = vi.mocked(addTokenBlacklistDao)
const mClearCookies = vi.mocked(clearAuthCookiesService)
const mGetPermissions = vi.mocked(getUserPermissions)
const mCheckSuperAdmin = vi.mocked(checkIsSuperAdmin)
const mFindUserRoles = vi.mocked(findUserRolesByUserIdDao)
const mFindUserRoutes = vi.mocked(findUserRolesRouterByUserIdDao)
const mBenefitSummary = vi.mocked(getUserBenefitSummaryService)
const mBenefitDetail = vi.mocked(getUserBenefitDetailService)

const { default: meHandler } = await import('../../../server/api/v1/users/me.get')
const { default: passwordHandler } = await import('../../../server/api/v1/users/password.put')
const { default: profileHandler } = await import('../../../server/api/v1/users/profile.put')
const { default: rolesHandler } = await import('../../../server/api/v1/users/roles.get')
const { default: routersHandler } = await import('../../../server/api/v1/users/routers.get')
const { default: permissionsHandler } = await import('../../../server/api/v1/users/permissions.get')
const { default: inviteesHandler } = await import('../../../server/api/v1/users/invitees.get')
const { default: benefitsListHandler } = await import('../../../server/api/v1/users/benefits/index.get')
const { default: benefitDetailHandler } = await import('../../../server/api/v1/users/benefits/[benefitCode].get')

const FULL_USER = (overrides: Partial<any> = {}) => ({
    id: 100,
    name: '张三',
    username: 'zhang',
    phone: '13800001111',
    email: 'a@b.cc',
    status: 1,
    company: 'C',
    profile: 'P',
    inviteCode: 'INV',
    password: 'hashed:oldpass8',
    userRoles: [{ roleId: 1 }],
    ...overrides,
})

describe('GET /api/v1/users/me', () => {
    beforeEach(() => vi.clearAllMocks())

    it('返回当前用户全部字段', async () => {
        mFindById.mockResolvedValue(FULL_USER() as any)
        const res: any = await meHandler(makeEvent({ userId: 100 }) as any)
        expectSuccess(res, d => {
            expect(d.id).toBe(100)
            expect(d.roles).toEqual([1])
        })
    })

    it('用户被删 → 401', async () => {
        mFindById.mockResolvedValue(null as any)
        const res: any = await meHandler(makeEvent({ userId: 100 }) as any)
        expectError(res, 401, '不存在')
    })

    it('DAO 抛错 → 500', async () => {
        mFindById.mockRejectedValueOnce(new Error('db'))
        const res: any = await meHandler(makeEvent({ userId: 100 }) as any)
        expectError(res, 500)
    })
})

describe('PUT /api/v1/users/password', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path → 改密 + 入黑名单 + 清 cookie', async () => {
        mFindById.mockResolvedValue(FULL_USER() as any)
        mUpdatePwd.mockResolvedValue({ id: 100 } as any)
        const res: any = await passwordHandler(makeEvent({
            userId: 100, token: 'tok',
            body: { currentPassword: 'oldpass8', newPassword: 'newpass8' },
        }) as any)
        expectSuccess(res)
        expect(mAddBlacklist).toHaveBeenCalled()
        expect(mClearCookies).toHaveBeenCalled()
    })

    it('Zod 失败 → 400', async () => {
        const res: any = await passwordHandler(makeEvent({
            userId: 100, body: { currentPassword: '1', newPassword: '2' },
        }) as any)
        expectError(res, 400)
    })

    it('用户不存在 → 400', async () => {
        mFindById.mockResolvedValue(null as any)
        const res: any = await passwordHandler(makeEvent({
            userId: 100, body: { currentPassword: 'oldpass8', newPassword: 'newpass8' },
        }) as any)
        expectError(res, 400, '用户不存在')
    })

    it('原密码错误 → 400', async () => {
        mFindById.mockResolvedValue(FULL_USER({ password: 'hashed:other' }) as any)
        const res: any = await passwordHandler(makeEvent({
            userId: 100, body: { currentPassword: 'oldpass8', newPassword: 'newpass8' },
        }) as any)
        expectError(res, 400, '当前密码错误')
    })

    it('用户无密码（首次设置）→ 跳过原密码校验', async () => {
        mFindById.mockResolvedValue(FULL_USER({ password: '' }) as any)
        mUpdatePwd.mockResolvedValue({ id: 100 } as any)
        const res: any = await passwordHandler(makeEvent({
            userId: 100, body: { currentPassword: 'oldpass8', newPassword: 'newpass8' },
        }) as any)
        expectSuccess(res)
    })

    it('updateUserPasswordDao 返 falsy → 400', async () => {
        mFindById.mockResolvedValue(FULL_USER() as any)
        mUpdatePwd.mockResolvedValue(null as any)
        const res: any = await passwordHandler(makeEvent({
            userId: 100, body: { currentPassword: 'oldpass8', newPassword: 'newpass8' },
        }) as any)
        expectError(res, 400, '更新用户密码失败')
    })
})

describe('PUT /api/v1/users/profile', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path → 返回格式化用户', async () => {
        mUpdateProfile.mockResolvedValue({ id: 100 } as any)
        mFindById.mockResolvedValue(FULL_USER() as any)
        const res: any = await profileHandler(makeEvent({
            userId: 100, body: { name: '李四', company: 'X', profile: 'P' },
        }) as any)
        expectSuccess(res, d => expect(d.id).toBe(100))
    })

    it('Zod 失败 → 400', async () => {
        const res: any = await profileHandler(makeEvent({
            userId: 100, body: { name: '一'.repeat(30) },
        }) as any)
        expectError(res, 400)
    })

    it('更新后 findById 找不到 → 400', async () => {
        mUpdateProfile.mockResolvedValue({ id: 100 } as any)
        mFindById.mockResolvedValue(null as any)
        const res: any = await profileHandler(makeEvent({
            userId: 100, body: { name: '李四' },
        }) as any)
        expectError(res, 400, '用户不存在')
    })
})

describe('GET /api/v1/users/roles', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path → 角色数组', async () => {
        mFindUserRoles.mockResolvedValue([
            { role: { id: 1, name: '用户', code: 'user', description: '' } },
            { role: { id: 2, name: '管理员', code: 'admin', description: '' } },
        ] as any)
        const res: any = await rolesHandler(makeEvent({ userId: 100 }) as any)
        expectSuccess(res, d => expect(d).toHaveLength(2))
    })

    it('userRoles 为 null → 401', async () => {
        mFindUserRoles.mockResolvedValue(null as any)
        const res: any = await rolesHandler(makeEvent({ userId: 100 }) as any)
        expectError(res, 401, '用户角色不存在')
    })

    it('DAO 抛错 → 500', async () => {
        mFindUserRoles.mockRejectedValueOnce(new Error('db'))
        const res: any = await rolesHandler(makeEvent({ userId: 100 }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/users/routers', () => {
    beforeEach(() => vi.clearAllMocks())

    it('普通用户 → 仅自己角色的路由', async () => {
        mCheckSuperAdmin.mockResolvedValue(false as any)
        mFindUserRoutes.mockResolvedValue([
            {
                role: {
                    id: 1, name: '用户', code: 'user', description: '',
                    roleRouters: [
                        { router: { id: 10, sort: 2, menuGroupSort: 1 } },
                        { router: { id: 11, sort: 1, menuGroupSort: 1 } },
                    ],
                },
            },
        ] as any)
        const res: any = await routersHandler(makeEvent({ userId: 100 }) as any)
        expectSuccess(res, d => {
            expect(d).toHaveLength(1)
            expect(d[0].routers[0].id).toBe(11) // 排序后 sort=1 在前
        })
    })

    it('超级管理员 → 全量路由', async () => {
        mCheckSuperAdmin.mockResolvedValue(true as any)
        ;(globalThis as any).prisma.routers.findMany.mockResolvedValue([
            { id: 1, sort: 1, menuGroupSort: 1, createdAt: new Date(), updatedAt: new Date(), deletedAt: null },
        ])
        mFindUserRoutes.mockResolvedValue([
            { role: { id: 1, name: '超管', code: 'super_admin', description: '', roleRouters: [] } },
        ] as any)
        const res: any = await routersHandler(makeEvent({ userId: 100, query: { roleId: '1' } }) as any)
        expectSuccess(res, d => {
            expect(d[0].routers.length).toBe(1)
        })
    })

    it('userRoles 为空 → 401', async () => {
        mCheckSuperAdmin.mockResolvedValue(false as any)
        mFindUserRoutes.mockResolvedValue(null as any)
        const res: any = await routersHandler(makeEvent({ userId: 100 }) as any)
        expectError(res, 401)
    })

    it('DAO 抛错 → 500', async () => {
        mCheckSuperAdmin.mockResolvedValue(false as any)
        mFindUserRoutes.mockRejectedValueOnce(new Error('db'))
        const res: any = await routersHandler(makeEvent({ userId: 100 }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/users/permissions', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mGetPermissions.mockResolvedValue({
            apiPermissions: [{ method: 'GET', path: '/x' }],
            routePermissions: ['/dashboard'],
            isSuperAdmin: false,
        } as any)
        const res: any = await permissionsHandler(makeEvent({ userId: 100 }) as any)
        expectSuccess(res, d => expect(d.isSuperAdmin).toBe(false))
    })

    it('未登录 → 401', async () => {
        const res: any = await permissionsHandler({ context: {} } as any)
        expectError(res, 401, '请先登录')
    })
})

describe('GET /api/v1/users/invitees', () => {
    beforeEach(() => vi.clearAllMocks())

    it('返回脱敏手机号', async () => {
        ;(globalThis as any).prisma.users.findMany.mockResolvedValue([
            { id: 1, name: 'A', phone: '13800001111', createdAt: new Date('2026-01-01') },
        ])
        const res: any = await inviteesHandler(makeEvent({ userId: 100 }) as any)
        expectSuccess(res, d => {
            expect(d.invitees[0].phone).not.toBe('13800001111') // 已脱敏
        })
    })

    it('createdAt 为空也安全', async () => {
        ;(globalThis as any).prisma.users.findMany.mockResolvedValue([
            { id: 1, name: 'A', phone: '13800001111', createdAt: null },
        ])
        const res: any = await inviteesHandler(makeEvent({ userId: 100 }) as any)
        expectSuccess(res, d => expect(d.invitees[0].createdAt).toBe(''))
    })

    it('未登录 → 抛 createError 401', async () => {
        await expect(inviteesHandler({ context: { auth: {} } } as any)).rejects.toThrow()
    })

    it('prisma 抛错 → 500', async () => {
        ;(globalThis as any).prisma.users.findMany.mockRejectedValueOnce(new Error('db'))
        const res: any = await inviteesHandler(makeEvent({ userId: 100 }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/users/benefits', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mBenefitSummary.mockResolvedValue([{ code: 'b1', remaining: 10 }] as any)
        const res: any = await benefitsListHandler(makeEvent({ userId: 100 }) as any)
        expectSuccess(res, d => expect(d).toHaveLength(1))
    })

    it('未登录 → 401', async () => {
        const res: any = await benefitsListHandler({ context: {} } as any)
        expectError(res, 401)
    })

    it('service 抛错 → 500', async () => {
        mBenefitSummary.mockRejectedValueOnce(new Error('svc'))
        const res: any = await benefitsListHandler(makeEvent({ userId: 100 }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/users/benefits/:benefitCode', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mBenefitDetail.mockResolvedValue({ code: 'b1', remaining: 5 } as any)
        const res: any = await benefitDetailHandler(makeEvent({
            userId: 100, params: { benefitCode: 'b1' },
        }) as any)
        expectSuccess(res, d => expect(d.code).toBe('b1'))
    })

    it('未登录 → 401', async () => {
        const res: any = await benefitDetailHandler({ context: {}, __params: { benefitCode: 'b1' } } as any)
        expectError(res, 401)
    })

    it('benefitCode 缺失 → 400', async () => {
        const res: any = await benefitDetailHandler(makeEvent({ userId: 100, params: {} }) as any)
        expectError(res, 400, '权益标识码')
    })

    it('详情不存在 → 404', async () => {
        mBenefitDetail.mockResolvedValue(null as any)
        const res: any = await benefitDetailHandler(makeEvent({
            userId: 100, params: { benefitCode: 'b9' },
        }) as any)
        expectError(res, 404)
    })

    it('service 抛错 → 500', async () => {
        mBenefitDetail.mockRejectedValueOnce(new Error('svc'))
        const res: any = await benefitDetailHandler(makeEvent({
            userId: 100, params: { benefitCode: 'b1' },
        }) as any)
        expectError(res, 500)
    })
})
