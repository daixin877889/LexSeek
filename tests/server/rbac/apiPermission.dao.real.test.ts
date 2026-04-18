/**
 * API 权限 DAO 真实 DB 补充覆盖测试
 *
 * 针对 server/services/rbac/apiPermission.dao.ts 中
 * 现有 api-permission.test.ts 未覆盖的函数与分支进行补齐，
 * 目标覆盖率 ≥ 90%。
 *
 * 覆盖内容：
 * - API 权限分组：create / findAll / findById
 * - API 权限批量创建：createManyApiPermissionsDao（含 skipDuplicates 分支）
 * - 列表查询：findApiPermissionsDao 的各筛选分支与分页
 * - 事务客户端 (tx) 路径
 *
 * **Feature: api-permission-dao-coverage**
 * **Target: server/services/rbac/apiPermission.dao.ts (>=90%)**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    testPrisma,
    connectTestDb,
    disconnectTestDb,
    resetDatabaseSequences,
} from '../membership/test-db-helper'
import { mockLogger } from '../membership/test-setup'

import {
    createApiPermissionGroupDao,
    findAllApiPermissionGroupsDao,
    findApiPermissionGroupByIdDao,
    createApiPermissionDao,
    createManyApiPermissionsDao,
    findApiPermissionByIdDao,
    findApiPermissionByPathMethodDao,
    findApiPermissionsDao,
    findPublicApiPermissionsDao,
    updateApiPermissionDao,
    updateApiPermissionsPublicStatusDao,
    deleteApiPermissionDao,
    checkApiPermissionExistsDao,
} from '../../../server/services/rbac/apiPermission.dao'

// 在测试环境下暴露 globalThis.prisma / logger，以满足 DAO 的自动导入假设
if (typeof window === 'undefined' && process.env.NODE_ENV === 'test') {
    ;(globalThis as any).prisma = testPrisma
    ;(globalThis as any).logger = mockLogger
}

// ==================== 测试数据追踪 ====================

const createdGroupIds: number[] = []
const createdPermissionIds: number[] = []

// ==================== 工具函数 ====================

const uniqueSuffix = () => {
    const ts = Date.now()
    const rand = Math.floor(Math.random() * 1_000_000)
    const uuid = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
    return `${ts}_${rand}_${uuid}`
}

describe('API 权限 DAO 真实 DB 补充覆盖', () => {
    beforeAll(async () => {
        await connectTestDb()
        await resetDatabaseSequences()
        // 确保 id_seq 不会与 seed 数据冲突
        await testPrisma.$executeRaw`SELECT setval('api_permissions_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM api_permissions), 5000))`
        await testPrisma.$executeRaw`SELECT setval('api_permission_groups_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM api_permission_groups), 5000))`
    })

    afterAll(async () => {
        // 先删权限（它引用 group），再删 group
        if (createdPermissionIds.length > 0) {
            await testPrisma.roleApiPermissions.deleteMany({
                where: { permissionId: { in: createdPermissionIds } },
            })
            await testPrisma.apiPermissions.deleteMany({
                where: { id: { in: createdPermissionIds } },
            })
            createdPermissionIds.length = 0
        }
        if (createdGroupIds.length > 0) {
            await testPrisma.apiPermissionGroups.deleteMany({
                where: { id: { in: createdGroupIds } },
            })
            createdGroupIds.length = 0
        }
        await disconnectTestDb()
    })

    afterEach(async () => {
        // 按单用例清理，避免互相污染；但 id 追踪保持到 afterAll 再兜底一次
    })

    // ========================================================================
    // API 权限分组 DAO
    // ========================================================================
    describe('createApiPermissionGroupDao', () => {
        it('仅传 name 时应使用 description=null 与 sort=0 的默认值', async () => {
            const name = `测试分组_${uniqueSuffix()}`
            const group = await createApiPermissionGroupDao({ name })
            createdGroupIds.push(group.id)

            expect(group.name).toBe(name)
            expect(group.description).toBeNull()
            expect(group.sort).toBe(0)
        })

        it('传入 description 与 sort 时应原样写入', async () => {
            const name = `测试分组_${uniqueSuffix()}`
            const desc = '分组描述'
            const group = await createApiPermissionGroupDao({
                name,
                description: desc,
                sort: 99,
            })
            createdGroupIds.push(group.id)

            expect(group.description).toBe(desc)
            expect(group.sort).toBe(99)
        })

        it('显式传入 description=null 时保持为 null', async () => {
            const name = `测试分组_${uniqueSuffix()}`
            const group = await createApiPermissionGroupDao({
                name,
                description: null,
                sort: 3,
            })
            createdGroupIds.push(group.id)
            expect(group.description).toBeNull()
            expect(group.sort).toBe(3)
        })

        it('使用外部事务客户端 (tx) 时应走 tx 分支', async () => {
            const name = `测试分组_${uniqueSuffix()}`
            const group = await createApiPermissionGroupDao(
                { name, sort: 5 },
                testPrisma as any
            )
            createdGroupIds.push(group.id)
            expect(group.name).toBe(name)
        })
    })

    describe('findAllApiPermissionGroupsDao', () => {
        it('应按 sort 升序返回所有分组', async () => {
            const suffix = uniqueSuffix()
            const g1 = await createApiPermissionGroupDao({
                name: `测试分组_A_${suffix}`,
                sort: 200,
            })
            const g2 = await createApiPermissionGroupDao({
                name: `测试分组_B_${suffix}`,
                sort: 100,
            })
            createdGroupIds.push(g1.id, g2.id)

            const groups = await findAllApiPermissionGroupsDao()
            const ids = groups.map(g => g.id)
            expect(ids).toContain(g1.id)
            expect(ids).toContain(g2.id)

            // 验证 sort 升序
            const sorts = groups.map(g => g.sort)
            for (let i = 1; i < sorts.length; i++) {
                expect(sorts[i]).toBeGreaterThanOrEqual(sorts[i - 1]!)
            }
        })

        it('使用 tx 路径也应能查询', async () => {
            const groups = await findAllApiPermissionGroupsDao(testPrisma as any)
            expect(Array.isArray(groups)).toBe(true)
        })
    })

    describe('findApiPermissionGroupByIdDao', () => {
        it('存在的 ID 应返回分组', async () => {
            const group = await createApiPermissionGroupDao({
                name: `测试分组_${uniqueSuffix()}`,
            })
            createdGroupIds.push(group.id)

            const found = await findApiPermissionGroupByIdDao(group.id)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(group.id)
        })

        it('不存在的 ID 应返回 null', async () => {
            const found = await findApiPermissionGroupByIdDao(999_999_999)
            expect(found).toBeNull()
        })

        it('使用 tx 路径也应正常', async () => {
            const group = await createApiPermissionGroupDao({
                name: `测试分组_${uniqueSuffix()}`,
            })
            createdGroupIds.push(group.id)
            const found = await findApiPermissionGroupByIdDao(group.id, testPrisma as any)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(group.id)
        })
    })

    // ========================================================================
    // API 权限 DAO - 创建与默认值
    // ========================================================================
    describe('createApiPermissionDao 默认值分支', () => {
        it('未指定可选字段时应使用默认值（description=null, groupId=null, isPublic=false, status=1）', async () => {
            const suffix = uniqueSuffix()
            const created = await createApiPermissionDao({
                path: `/api/v1/test/defaults/${suffix}`,
                method: 'GET',
                name: `默认权限_${suffix}`,
            })
            createdPermissionIds.push(created.id)

            expect(created.description).toBeNull()
            expect(created.groupId).toBeNull()
            expect(created.isPublic).toBe(false)
            expect(created.status).toBe(1)
        })

        it('使用 tx 路径也应写入成功', async () => {
            const suffix = uniqueSuffix()
            const created = await createApiPermissionDao(
                {
                    path: `/api/v1/test/tx/${suffix}`,
                    method: 'POST',
                    name: `事务权限_${suffix}`,
                    description: '事务分支',
                    isPublic: true,
                    status: 0,
                },
                testPrisma as any
            )
            createdPermissionIds.push(created.id)

            expect(created.isPublic).toBe(true)
            expect(created.status).toBe(0)
            expect(created.description).toBe('事务分支')
        })
    })

    // ========================================================================
    // 批量创建
    // ========================================================================
    describe('createManyApiPermissionsDao', () => {
        it('应批量创建权限并处理 skipDuplicates', async () => {
            const suffix = uniqueSuffix()
            const inputs = [
                {
                    path: `/api/v1/test/bulk/a/${suffix}`,
                    method: 'GET',
                    name: `批量A_${suffix}`,
                },
                {
                    path: `/api/v1/test/bulk/b/${suffix}`,
                    method: 'POST',
                    name: `批量B_${suffix}`,
                    description: '描述B',
                    isPublic: true,
                    status: 1,
                    groupId: null,
                },
            ]

            const result = await createManyApiPermissionsDao(inputs)
            expect(result.count).toBe(2)

            // 回查并登记用于清理
            const created = await testPrisma.apiPermissions.findMany({
                where: {
                    path: { in: inputs.map(i => i.path) },
                },
            })
            expect(created.length).toBe(2)
            createdPermissionIds.push(...created.map(c => c.id))

            // 再次批量插入完全相同的数据应被 skipDuplicates 跳过
            const second = await createManyApiPermissionsDao(inputs)
            expect(second.count).toBe(0)
        })

        it('使用 tx 路径也应生效', async () => {
            const suffix = uniqueSuffix()
            const result = await createManyApiPermissionsDao(
                [
                    {
                        path: `/api/v1/test/bulk/tx/${suffix}`,
                        method: 'DELETE',
                        name: `批量TX_${suffix}`,
                    },
                ],
                testPrisma as any
            )
            expect(result.count).toBe(1)
            const created = await testPrisma.apiPermissions.findFirst({
                where: { path: `/api/v1/test/bulk/tx/${suffix}` },
            })
            if (created) createdPermissionIds.push(created.id)
        })
    })

    // ========================================================================
    // 单条查询的 tx 分支
    // ========================================================================
    describe('findApiPermissionByIdDao / findApiPermissionByPathMethodDao tx 分支', () => {
        it('使用 tx 客户端应能查询到权限（含 group include）', async () => {
            const suffix = uniqueSuffix()
            const group = await createApiPermissionGroupDao({
                name: `测试分组_${suffix}`,
            })
            createdGroupIds.push(group.id)

            const perm = await createApiPermissionDao({
                path: `/api/v1/test/findtx/${suffix}`,
                method: 'GET',
                name: `TX查询_${suffix}`,
                groupId: group.id,
            })
            createdPermissionIds.push(perm.id)

            const byId = await findApiPermissionByIdDao(perm.id, testPrisma as any)
            expect(byId).not.toBeNull()
            expect(byId!.group).not.toBeNull()
            expect(byId!.group!.id).toBe(group.id)

            const byPath = await findApiPermissionByPathMethodDao(
                perm.path,
                perm.method,
                testPrisma as any
            )
            expect(byPath).not.toBeNull()
            expect(byPath!.id).toBe(perm.id)
        })
    })

    // ========================================================================
    // 列表查询 - 全筛选分支
    // ========================================================================
    describe('findApiPermissionsDao 各筛选分支', () => {
        /** 每条权限路径中包含该 tag，方便通过 keyword 精确匹配本组测试数据 */
        let tag = ''
        const listIds: number[] = []

        beforeAll(async () => {
            tag = `listtag_${uniqueSuffix()}`
            const group = await createApiPermissionGroupDao({
                name: `列表分组_${tag}`,
            })
            createdGroupIds.push(group.id)

            const rows = [
                {
                    path: `/api/v1/test/${tag}/users`,
                    method: 'GET',
                    name: `列表GET用户_${tag}`,
                    description: '用户列表接口',
                    groupId: group.id,
                    isPublic: true,
                    status: 1,
                },
                {
                    path: `/api/v1/test/${tag}/users`,
                    method: 'POST',
                    name: `列表POST用户_${tag}`,
                    description: '创建用户接口',
                    groupId: group.id,
                    isPublic: false,
                    status: 1,
                },
                {
                    path: `/api/v1/test/${tag}/orders`,
                    method: 'GET',
                    name: `列表GET订单_${tag}`,
                    description: null,
                    groupId: null,
                    isPublic: false,
                    status: 0,
                },
                {
                    path: `/api/v1/test/${tag}/orders/detail`,
                    method: 'DELETE',
                    name: `列表DELETE订单_${tag}`,
                    description: '删除订单',
                    groupId: null,
                    isPublic: false,
                    status: 1,
                },
            ]
            for (const r of rows) {
                const created = await createApiPermissionDao(r as any)
                listIds.push(created.id)
                createdPermissionIds.push(created.id)
            }
        })

        it('无任何筛选条件时应返回全部（至少包含本组 4 条）', async () => {
            const result = await findApiPermissionsDao()
            expect(result.page).toBe(1)
            expect(result.pageSize).toBe(20)
            expect(result.total).toBeGreaterThanOrEqual(4)
            expect(result.totalPages).toBeGreaterThan(0)
        })

        it('按 path 模糊匹配应只返回包含子串的记录', async () => {
            const result = await findApiPermissionsDao({ path: `${tag}/orders` })
            // 至少命中 2 条 orders 相关
            const mine = result.items.filter(i => i.path.includes(tag))
            expect(mine.length).toBeGreaterThanOrEqual(2)
            expect(mine.every(i => i.path.includes('orders'))).toBe(true)
        })

        it('按 method 精确筛选', async () => {
            const result = await findApiPermissionsDao(
                { path: tag, method: 'GET' },
                { page: 1, pageSize: 50 }
            )
            const mine = result.items.filter(i => i.path.includes(tag))
            expect(mine.every(i => i.method === 'GET')).toBe(true)
            expect(mine.length).toBeGreaterThanOrEqual(2)
        })

        it('按 groupId=null 筛选应只返回无分组的权限', async () => {
            const result = await findApiPermissionsDao(
                { path: tag, groupId: null },
                { page: 1, pageSize: 50 }
            )
            const mine = result.items.filter(i => i.path.includes(tag))
            expect(mine.every(i => i.groupId === null)).toBe(true)
            expect(mine.length).toBeGreaterThanOrEqual(2)
        })

        it('按 groupId=具体值 筛选应只返回该分组下权限', async () => {
            // 先通过一次查询找到我们创建的 group id
            const sample = await findApiPermissionsDao(
                { path: tag, method: 'GET', isPublic: true },
                { page: 1, pageSize: 10 }
            )
            const withGroup = sample.items.find(i => i.path.includes(tag) && i.groupId)
            expect(withGroup).toBeDefined()

            const result = await findApiPermissionsDao(
                { path: tag, groupId: withGroup!.groupId! },
                { page: 1, pageSize: 50 }
            )
            const mine = result.items.filter(i => i.path.includes(tag))
            expect(mine.every(i => i.groupId === withGroup!.groupId)).toBe(true)
        })

        it('按 isPublic=true 筛选', async () => {
            const result = await findApiPermissionsDao(
                { path: tag, isPublic: true },
                { page: 1, pageSize: 50 }
            )
            const mine = result.items.filter(i => i.path.includes(tag))
            expect(mine.every(i => i.isPublic === true)).toBe(true)
            expect(mine.length).toBeGreaterThanOrEqual(1)
        })

        it('按 status=0 筛选', async () => {
            const result = await findApiPermissionsDao(
                { path: tag, status: 0 },
                { page: 1, pageSize: 50 }
            )
            const mine = result.items.filter(i => i.path.includes(tag))
            expect(mine.every(i => i.status === 0)).toBe(true)
            expect(mine.length).toBeGreaterThanOrEqual(1)
        })

        it('按 keyword 应在 path/name/description 上做 OR 匹配', async () => {
            const result = await findApiPermissionsDao(
                { keyword: tag },
                { page: 1, pageSize: 50 }
            )
            // 由于 tag 只嵌在 path/name 中，应能命中至少 4 条
            expect(result.total).toBeGreaterThanOrEqual(4)
        })

        it('keyword 命中 description 字段分支', async () => {
            const result = await findApiPermissionsDao(
                { keyword: '删除订单' },
                { page: 1, pageSize: 50 }
            )
            // 至少命中我们这条 description='删除订单'
            expect(result.items.some(i => i.description === '删除订单')).toBe(true)
        })

        it('分页参数 page/pageSize 应生效并计算 totalPages', async () => {
            const pageSize = 2
            const first = await findApiPermissionsDao(
                { keyword: tag },
                { page: 1, pageSize }
            )
            expect(first.items.length).toBeLessThanOrEqual(pageSize)
            expect(first.pageSize).toBe(pageSize)
            expect(first.totalPages).toBe(Math.ceil(first.total / pageSize))

            if (first.total > pageSize) {
                const second = await findApiPermissionsDao(
                    { keyword: tag },
                    { page: 2, pageSize }
                )
                expect(second.page).toBe(2)
                // 第二页数据不与第一页重复
                const firstIds = new Set(first.items.map(i => i.id))
                expect(second.items.every(i => !firstIds.has(i.id))).toBe(true)
            }
        })

        it('使用 tx 客户端查询应同样有效', async () => {
            const result = await findApiPermissionsDao(
                { keyword: tag },
                { page: 1, pageSize: 50 },
                testPrisma as any
            )
            expect(result.total).toBeGreaterThanOrEqual(4)
        })

        it('all=true 时应跳过分页返回全部记录，不受 pageSize 上限约束', async () => {
            // 当前分组下至少有 4 条（tag 一致），配合全库既有记录应 > 0
            const result = await findApiPermissionsDao(
                { keyword: tag },
                { all: true }
            )
            expect(result.items.length).toBe(result.total)
            expect(result.page).toBe(1)
            expect(result.pageSize).toBe(result.total)
            expect(result.totalPages).toBe(1)
        })
    })

    // ========================================================================
    // 公开权限查询 tx 路径
    // ========================================================================
    describe('findPublicApiPermissionsDao tx 分支', () => {
        it('tx 路径下应能查询公开权限', async () => {
            const items = await findPublicApiPermissionsDao(testPrisma as any)
            expect(Array.isArray(items)).toBe(true)
        })
    })

    // ========================================================================
    // 更新 / 删除 tx 分支
    // ========================================================================
    describe('updateApiPermissionDao / deleteApiPermissionDao tx 分支', () => {
        it('使用 tx 客户端更新和删除应生效', async () => {
            const suffix = uniqueSuffix()
            const created = await createApiPermissionDao({
                path: `/api/v1/test/updtx/${suffix}`,
                method: 'PATCH',
                name: `UPDTX_${suffix}`,
            })
            createdPermissionIds.push(created.id)

            const updated = await updateApiPermissionDao(
                created.id,
                { name: `UPDTX_new_${suffix}`, isPublic: true },
                testPrisma as any
            )
            expect(updated.name).toBe(`UPDTX_new_${suffix}`)
            expect(updated.isPublic).toBe(true)

            await deleteApiPermissionDao(created.id, testPrisma as any)
            const gone = await findApiPermissionByIdDao(created.id)
            expect(gone).toBeNull()
        })
    })

    describe('updateApiPermissionsPublicStatusDao tx 分支', () => {
        it('使用 tx 客户端批量切换 isPublic 应生效', async () => {
            const suffix = uniqueSuffix()
            const a = await createApiPermissionDao({
                path: `/api/v1/test/batchtx/a/${suffix}`,
                method: 'GET',
                name: `BATCHA_${suffix}`,
                isPublic: false,
            })
            const b = await createApiPermissionDao({
                path: `/api/v1/test/batchtx/b/${suffix}`,
                method: 'POST',
                name: `BATCHB_${suffix}`,
                isPublic: false,
            })
            createdPermissionIds.push(a.id, b.id)

            const res = await updateApiPermissionsPublicStatusDao(
                [a.id, b.id],
                true,
                testPrisma as any
            )
            expect(res.count).toBe(2)
            const af = await findApiPermissionByIdDao(a.id)
            const bf = await findApiPermissionByIdDao(b.id)
            expect(af!.isPublic).toBe(true)
            expect(bf!.isPublic).toBe(true)
        })
    })

    // ========================================================================
    // checkApiPermissionExistsDao tx 分支
    // ========================================================================
    describe('checkApiPermissionExistsDao tx 分支', () => {
        it('tx 客户端下存在/不存在判定均应正确', async () => {
            const suffix = uniqueSuffix()
            const created = await createApiPermissionDao({
                path: `/api/v1/test/existtx/${suffix}`,
                method: 'GET',
                name: `EXIST_${suffix}`,
            })
            createdPermissionIds.push(created.id)

            const yes = await checkApiPermissionExistsDao(
                created.path,
                created.method,
                undefined,
                testPrisma as any
            )
            expect(yes).toBe(true)

            const no = await checkApiPermissionExistsDao(
                `/api/v1/test/existtx/not_exist_${suffix}`,
                'GET',
                undefined,
                testPrisma as any
            )
            expect(no).toBe(false)

            const exclude = await checkApiPermissionExistsDao(
                created.path,
                created.method,
                created.id,
                testPrisma as any
            )
            expect(exclude).toBe(false)
        })
    })
})
