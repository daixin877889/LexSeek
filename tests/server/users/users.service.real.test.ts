/**
 * users.service.ts 与 userResponse.service.ts 真实数据库集成测试
 *
 * 覆盖：
 * - createUserService（无角色 / 带有效角色 / 含无效角色 / 外部事务）
 * - formatUserResponseService（基本字段 / 排除敏感字段 / 多角色 / 空角色）
 *
 * **Feature: users-service-real**
 * **Validates: createUserService、formatUserResponseService**
 */

import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest'

import {
    connectTestDb,
    disconnectTestDb,
    testPrisma,
    TEST_USER_PHONE_PREFIX,
} from '../membership/test-db-helper'
import { mockLogger } from '../membership/test-setup'

// 在导入业务模块之前，模拟 Nuxt 服务端自动导入（prisma / logger / DAO 函数）
// 业务模块（service）顶层就会引用这些全局，所以必须先注入。
;(globalThis as any).prisma = testPrisma
;(globalThis as any).logger = mockLogger

// 引入 DAO 后，将其全部导出挂载为全局，模拟 Nuxt 自动导入
import * as usersDao from '../../../server/services/users/users.dao'
import * as rolesDao from '../../../server/services/rbac/roles.dao'
import * as userRolesDao from '../../../server/services/rbac/userRoles.dao'
for (const [name, fn] of Object.entries({
    ...usersDao,
    ...rolesDao,
    ...userRolesDao,
})) {
    ;(globalThis as any)[name] = fn
}

import { createUserService } from '../../../server/services/users/users.service'
import { formatUserResponseService } from '../../../server/services/users/userResponse.service'

// 测试期间创建的实体 ID 跟踪，afterAll 统一清理
const createdUserIds: number[] = []
const createdRoleIds: number[] = []

// 用于唯一标识本测试套件创建的角色（前缀 + 长随机后缀避免冲突）
const ROLE_PREFIX = 'TEST_USR_SVC_'

/** 生成 11 位测试手机号（199 + 8 位） */
const genPhone = (): string => {
    const random = Array.from(crypto.getRandomValues(new Uint8Array(4)))
        .map((b) => String(b % 10))
        .join('')
    const ts = String(Date.now()).slice(-4)
    return `${TEST_USER_PHONE_PREFIX}${ts}${random}`.slice(0, 11)
}

/** 生成长随机字符串（用于角色 code/name 唯一性） */
const genSuffix = (): string => {
    const random = Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return `${Date.now()}_${random}`
}

/**
 * 创建一个状态为启用（status=1）的测试角色
 */
const createTestRole = async (overrides: Partial<{ status: number }> = {}) => {
    const suffix = genSuffix()
    const role = await testPrisma.roles.create({
        data: {
            name: `${ROLE_PREFIX}${suffix}`,
            code: `${ROLE_PREFIX}${suffix}`,
            description: 'users.service.real test role',
            status: overrides.status ?? 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    createdRoleIds.push(role.id)
    return role
}

describe('users.service.ts / userResponse.service.ts 真实数据库测试', () => {
    beforeAll(async () => {
        await connectTestDb()
        // 防御性修复：全局 setup 中的 setval 会把 users_id_seq 重置到 MAX(id)，
        // 这与种子数据的 id 范围紧贴，第一次 nextval 可能与残留 id 冲突。
        // 这里把序列推到一个安全的更大值，避免 PrismaClientKnownRequestError: Unique on (id)。
        await testPrisma.$executeRawUnsafe(
            `SELECT setval('users_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), 100000) + 1000)`
        )
        await testPrisma.$executeRawUnsafe(
            `SELECT setval('roles_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM roles), 100000) + 1000)`
        )
        await testPrisma.$executeRawUnsafe(
            `SELECT setval('user_roles_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM user_roles), 100000) + 1000)`
        )
    })

    afterAll(async () => {
        // 先删用户角色关联（外键），再删用户，最后删角色
        if (createdUserIds.length > 0) {
            await testPrisma.userRoles.deleteMany({
                where: { userId: { in: createdUserIds } },
            })
            await testPrisma.users.deleteMany({
                where: { id: { in: createdUserIds } },
            })
        }
        if (createdRoleIds.length > 0) {
            await testPrisma.userRoles.deleteMany({
                where: { roleId: { in: createdRoleIds } },
            })
            await testPrisma.roles.deleteMany({
                where: { id: { in: createdRoleIds } },
            })
        }
        await disconnectTestDb()
    })

    // 兜底防御：每条用例结束后无新增清理逻辑（统一在 afterAll 处理）
    afterEach(async () => {
        // no-op
    })

    describe('createUserService', () => {
        it('未指定角色时应仅创建用户，不写入 user_roles', async () => {
            const phone = genPhone()
            const user = await createUserService({
                name: '无角色用户',
                phone,
                password: 'hashed_pwd',
                status: 1,
            })
            createdUserIds.push(user.id)

            expect(user).toBeDefined()
            expect(user.id).toBeGreaterThan(0)
            expect(user.phone).toBe(phone)
            expect(user.name).toBe('无角色用户')

            const userRoles = await testPrisma.userRoles.findMany({
                where: { userId: user.id },
            })
            expect(userRoles).toEqual([])
        })

        it('指定有效单角色时应同时创建 user_roles 关联', async () => {
            const role = await createTestRole()
            const phone = genPhone()

            const user = await createUserService(
                {
                    name: '单角色用户',
                    phone,
                    password: 'hashed_pwd',
                    status: 1,
                },
                { roleIds: [role.id] }
            )
            createdUserIds.push(user.id)

            expect(user.id).toBeGreaterThan(0)

            const userRoles = await testPrisma.userRoles.findMany({
                where: { userId: user.id },
                orderBy: { roleId: 'asc' },
            })
            expect(userRoles).toHaveLength(1)
            expect(userRoles[0]!.roleId).toBe(role.id)
        })

        it('指定多个有效角色时应批量创建关联', async () => {
            const roleA = await createTestRole()
            const roleB = await createTestRole()
            const phone = genPhone()

            const user = await createUserService(
                {
                    name: '多角色用户',
                    phone,
                    password: 'hashed_pwd',
                    status: 1,
                },
                { roleIds: [roleA.id, roleB.id] }
            )
            createdUserIds.push(user.id)

            const userRoles = await testPrisma.userRoles.findMany({
                where: { userId: user.id },
                orderBy: { roleId: 'asc' },
            })
            const roleIds = userRoles.map((r) => r.roleId).sort((a, b) => a - b)
            expect(roleIds).toEqual([roleA.id, roleB.id].sort((a, b) => a - b))
        })

        it('指定不存在的角色 ID 时应抛出错误且不创建任何用户', async () => {
            const phone = genPhone()
            const invalidRoleId = 9_999_999

            await expect(
                createUserService(
                    {
                        name: '无效角色用户',
                        phone,
                        password: 'hashed_pwd',
                        status: 1,
                    },
                    { roleIds: [invalidRoleId] }
                )
            ).rejects.toThrow(/角色不存在或已禁用/)

            // 事务回滚 - 用户不应被持久化
            const found = await testPrisma.users.findFirst({ where: { phone } })
            expect(found).toBeNull()
        })

        it('混合有效与无效角色 ID 时应整体回滚', async () => {
            const validRole = await createTestRole()
            const phone = genPhone()
            const invalidRoleId = 9_999_998

            await expect(
                createUserService(
                    {
                        name: '混合角色用户',
                        phone,
                        password: 'hashed_pwd',
                        status: 1,
                    },
                    { roleIds: [validRole.id, invalidRoleId] }
                )
            ).rejects.toThrow(/角色不存在或已禁用/)

            // 事务回滚 - 用户与关联均不应存在
            const found = await testPrisma.users.findFirst({ where: { phone } })
            expect(found).toBeNull()
        })

        it('禁用状态（status=0）的角色应被视为无效', async () => {
            const disabledRole = await createTestRole({ status: 0 })
            const phone = genPhone()

            await expect(
                createUserService(
                    {
                        name: '禁用角色用户',
                        phone,
                        password: 'hashed_pwd',
                        status: 1,
                    },
                    { roleIds: [disabledRole.id] }
                )
            ).rejects.toThrow(/角色不存在或已禁用/)

            const found = await testPrisma.users.findFirst({ where: { phone } })
            expect(found).toBeNull()
        })

        it('传入外部事务（tx）时应复用而不开启新事务', async () => {
            const role = await createTestRole()
            const phone = genPhone()

            const user = await testPrisma.$transaction(async (tx) => {
                return createUserService(
                    {
                        name: '外部事务用户',
                        phone,
                        password: 'hashed_pwd',
                        status: 1,
                    },
                    { roleIds: [role.id], tx: tx as any }
                )
            })
            createdUserIds.push(user.id)

            expect(user.id).toBeGreaterThan(0)

            const userRoles = await testPrisma.userRoles.findMany({
                where: { userId: user.id },
            })
            expect(userRoles).toHaveLength(1)
            expect(userRoles[0]!.roleId).toBe(role.id)
        })

        it('options 为空对象时应等价于不传 options', async () => {
            const phone = genPhone()
            const user = await createUserService(
                {
                    name: '空 options 用户',
                    phone,
                    password: 'hashed_pwd',
                    status: 1,
                },
                {}
            )
            createdUserIds.push(user.id)

            expect(user.id).toBeGreaterThan(0)
            const userRoles = await testPrisma.userRoles.findMany({
                where: { userId: user.id },
            })
            expect(userRoles).toEqual([])
        })

        it('手机号唯一约束冲突时应抛出错误（来自数据库）', async () => {
            const phone = genPhone()
            const first = await createUserService({
                name: '第一个用户',
                phone,
                password: 'hashed_pwd',
                status: 1,
            })
            createdUserIds.push(first.id)

            await expect(
                createUserService({
                    name: '冲突用户',
                    phone,
                    password: 'hashed_pwd',
                    status: 1,
                })
            ).rejects.toThrow()
        })
    })

    describe('formatUserResponseService', () => {
        it('应从真实 DB 用户对象中提取所有安全字段', async () => {
            // 通过 service 创建带角色的用户，再从 DB 重新查出完整的 user + userRoles + role 结构
            const role = await createTestRole()
            const phone = genPhone()
            const created = await createUserService(
                {
                    name: '格式化用户',
                    phone,
                    password: 'super_secret_password',
                    email: `${ROLE_PREFIX}${Date.now()}@test.local`.toLowerCase(),
                    company: '某律所',
                    profile: '资深律师',
                    inviteCode: `IV${Date.now().toString().slice(-7)}`,
                    status: 1,
                },
                { roleIds: [role.id] }
            )
            createdUserIds.push(created.id)

            const dbUser = await testPrisma.users.findUnique({
                where: { id: created.id },
                include: {
                    userRoles: {
                        include: { role: true },
                    },
                },
            })
            expect(dbUser).not.toBeNull()

            const safe = formatUserResponseService(dbUser as any)

            expect(safe.id).toBe(created.id)
            expect(safe.name).toBe('格式化用户')
            expect(safe.phone).toBe(phone)
            expect(safe.company).toBe('某律所')
            expect(safe.profile).toBe('资深律师')
            expect(safe.status).toBe(1)
            expect(safe.roles).toEqual([role.id])

            // 敏感字段必须被剔除
            expect(safe).not.toHaveProperty('password')
            expect(safe).not.toHaveProperty('deletedAt')
            expect(safe).not.toHaveProperty('createdAt')
            expect(safe).not.toHaveProperty('updatedAt')

            // 返回对象的 key 集合等于安全字段白名单（与 SafeUserInfo / formatUserResponseService 全集对齐）
            const expectedKeys = [
                'id',
                'name',
                'username',
                'phone',
                'email',
                'roles',
                'status',
                'company',
                'profile',
                'inviteCode',
                'contractExportSignature',
            ].sort()
            expect(Object.keys(safe).sort()).toEqual(expectedKeys)
        })

        it('多角色用户应返回所有 roleId', async () => {
            const roleA = await createTestRole()
            const roleB = await createTestRole()
            const phone = genPhone()
            const created = await createUserService(
                {
                    name: '多角色',
                    phone,
                    password: 'pwd',
                    status: 1,
                },
                { roleIds: [roleA.id, roleB.id] }
            )
            createdUserIds.push(created.id)

            const dbUser = await testPrisma.users.findUnique({
                where: { id: created.id },
                include: {
                    userRoles: { include: { role: true } },
                },
            })

            const safe = formatUserResponseService(dbUser as any)
            expect(safe.roles.sort((a, b) => a - b)).toEqual(
                [roleA.id, roleB.id].sort((a, b) => a - b)
            )
        })

        it('无角色用户应返回空 roles 数组', async () => {
            const phone = genPhone()
            const created = await createUserService({
                name: '无角色',
                phone,
                password: 'pwd',
                status: 1,
            })
            createdUserIds.push(created.id)

            const dbUser = await testPrisma.users.findUnique({
                where: { id: created.id },
                include: {
                    userRoles: { include: { role: true } },
                },
            })

            const safe = formatUserResponseService(dbUser as any)
            expect(safe.roles).toEqual([])
        })

        it('可选字段为 null 时应原样保留 null（不 fallback 为其它值）', async () => {
            const phone = genPhone()
            // 直接 prisma 创建，避免给可选字段填默认值
            const created = await testPrisma.users.create({
                data: {
                    name: 'null 字段用户',
                    phone,
                    password: 'pwd',
                    status: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdUserIds.push(created.id)

            const dbUser = await testPrisma.users.findUnique({
                where: { id: created.id },
                include: {
                    userRoles: { include: { role: true } },
                },
            })

            const safe = formatUserResponseService(dbUser as any)
            expect(safe.username).toBeNull()
            expect(safe.email).toBeNull()
            expect(safe.company).toBeNull()
            expect(safe.profile).toBeNull()
            expect(safe.inviteCode).toBeNull()
            expect(safe.status).toBe(0)
            expect(safe.roles).toEqual([])
        })
    })
})
