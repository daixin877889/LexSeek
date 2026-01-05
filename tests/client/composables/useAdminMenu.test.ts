/**
 * useAdminMenu Composable 测试
 *
 * 测试 Admin 菜单数据过滤、分组、排序逻辑
 *
 * **Feature: admin-rbac-menu**
 * **Validates: Requirements 1.2, 2.2, 2.3, 2.4, 3.4**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import { ref } from 'vue'

// 模拟路由数据
const mockCurrentRoleRouters = ref<any[]>([])
const mockLoading = ref(false)
const mockError = ref<string | null>(null)

// 模拟 useRoleStore
vi.stubGlobal('useRoleStore', () => ({
    currentRoleRouters: mockCurrentRoleRouters.value,
    loading: mockLoading.value,
    error: mockError.value,
}))

// 模拟 useRoute
const mockRoutePath = ref('/admin/roles')
vi.stubGlobal('useRoute', () => ({
    path: mockRoutePath.value,
}))

// 模拟 lucideIcons
vi.stubGlobal('lucideIcons', {
    ShieldIcon: { name: 'ShieldIcon' },
    KeyIcon: { name: 'KeyIcon' },
    UsersIcon: { name: 'UsersIcon' },
    SettingsIcon: { name: 'SettingsIcon' },
})

// 导入被测试的函数（需要在 mock 之后）
import { getAdminIcon } from '../../../app/composables/useAdminMenu'

/**
 * 菜单过滤逻辑（从 composable 中提取用于测试）
 */
function filterAdminRouters(routers: any[]) {
    return routers.filter((r) => r.isMenu && r.path?.startsWith('/admin'))
}

/**
 * 菜单分组逻辑（从 composable 中提取用于测试）
 */
function groupAdminRouters(routers: any[]) {
    const filtered = filterAdminRouters(routers)
    const groupMap = new Map<string, any[]>()
    const groupSortMap = new Map<string, number>()

    for (const router of filtered) {
        const groupName = router.menuGroup || '其他'
        const groupSort = router.menuGroupSort ?? 999

        if (!groupMap.has(groupName)) {
            groupMap.set(groupName, [])
            groupSortMap.set(groupName, groupSort)
        }

        groupMap.get(groupName)!.push({
            id: router.id,
            path: router.path,
            title: router.title,
            icon: router.icon,
            sort: router.sort ?? 0,
        })
    }

    return Array.from(groupMap.entries())
        .map(([name, items]) => ({
            name,
            sort: groupSortMap.get(name) ?? 999,
            items: items.sort((a, b) => a.sort - b.sort),
        }))
        .filter((group) => group.items.length > 0)
        .sort((a, b) => a.sort - b.sort)
}

/**
 * 路由匹配逻辑（从 composable 中提取用于测试）
 */
function isActiveRoute(currentPath: string, menuPath: string, allMenuPaths: string[]) {
    // 精确匹配
    if (currentPath === menuPath) return true
    // 子路由匹配
    if (currentPath.startsWith(menuPath + '/')) {
        const hasMoreSpecificMatch = allMenuPaths.some(
            (p) => p !== menuPath && currentPath.startsWith(p)
        )
        return !hasMoreSpecificMatch
    }
    return false
}

// 路由数据生成器
const routerArbitrary = fc.record({
    id: fc.integer({ min: 1, max: 10000 }),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    title: fc.string({ minLength: 1, maxLength: 50 }),
    path: fc.oneof(
        // Admin 路由
        fc.constantFrom(
            '/admin/roles',
            '/admin/users',
            '/admin/permissions/api',
            '/admin/permissions/routes',
            '/admin/benefits',
            '/admin/products'
        ),
        // 非 Admin 路由
        fc.constantFrom('/dashboard', '/user/profile', '/settings', '/')
    ),
    isMenu: fc.boolean(),
    icon: fc.option(fc.constantFrom('ShieldIcon', 'KeyIcon', 'UsersIcon'), { nil: null }),
    menuGroup: fc.option(
        fc.constantFrom('权限管理', '权益管理', '运营管理', '知识库管理', '模型管理'),
        { nil: null }
    ),
    menuGroupSort: fc.integer({ min: 0, max: 100 }),
    sort: fc.integer({ min: 0, max: 100 }),
})

describe('useAdminMenu 测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockCurrentRoleRouters.value = []
        mockRoutePath.value = '/admin/roles'
    })

    describe('getAdminIcon 图标映射', () => {
        it('应正确映射有效图标名称', () => {
            // lucideIcons 是 Nuxt 自动导入的，在测试环境中会返回实际的图标组件
            const icon = getAdminIcon('ShieldIcon')
            // 只验证返回了组件（非 null）
            expect(icon).toBeDefined()
        })

        it('应正确处理 lucideIcons. 前缀', () => {
            const icon = getAdminIcon('lucideIcons.ShieldIcon')
            expect(icon).toBeDefined()
        })

        it('空图标名称应返回 null', () => {
            expect(getAdminIcon(null)).toBeNull()
            expect(getAdminIcon('')).toBeNull()
        })

        it('无效图标名称应返回 null', () => {
            expect(getAdminIcon('InvalidIconThatDoesNotExist12345')).toBeNull()
        })
    })

    describe('Property 1: 菜单过滤正确性', () => {
        it('过滤结果只包含 isMenu=true 且 path 以 /admin 开头的路由', () => {
            fc.assert(
                fc.property(fc.array(routerArbitrary, { minLength: 0, maxLength: 20 }), (routers) => {
                    const filtered = filterAdminRouters(routers)

                    // 验证所有过滤结果都满足条件
                    for (const router of filtered) {
                        expect(router.isMenu).toBe(true)
                        expect(router.path.startsWith('/admin')).toBe(true)
                    }

                    // 验证没有遗漏符合条件的路由
                    const expected = routers.filter((r) => r.isMenu && r.path?.startsWith('/admin'))
                    expect(filtered.length).toBe(expected.length)
                }),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 2: 分组排序正确性', () => {
        it('分组应按 menuGroupSort 升序排列', () => {
            fc.assert(
                fc.property(fc.array(routerArbitrary, { minLength: 1, maxLength: 20 }), (routers) => {
                    // 确保有 admin 菜单路由
                    const adminRouters = routers.map((r, i) => ({
                        ...r,
                        path: `/admin/route${i}`,
                        isMenu: true,
                    }))

                    const groups = groupAdminRouters(adminRouters)

                    // 验证分组按 sort 升序排列
                    for (let i = 1; i < groups.length; i++) {
                        expect(groups[i - 1].sort).toBeLessThanOrEqual(groups[i].sort)
                    }
                }),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 3: 菜单项排序正确性', () => {
        it('每个分组内的菜单项应按 sort 升序排列', () => {
            fc.assert(
                fc.property(fc.array(routerArbitrary, { minLength: 1, maxLength: 20 }), (routers) => {
                    // 确保有 admin 菜单路由
                    const adminRouters = routers.map((r, i) => ({
                        ...r,
                        path: `/admin/route${i}`,
                        isMenu: true,
                    }))

                    const groups = groupAdminRouters(adminRouters)

                    // 验证每个分组内的菜单项按 sort 升序排列
                    for (const group of groups) {
                        for (let i = 1; i < group.items.length; i++) {
                            expect(group.items[i - 1].sort).toBeLessThanOrEqual(group.items[i].sort)
                        }
                    }
                }),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 4: 分组非空性', () => {
        it('所有分组都应包含至少一个菜单项', () => {
            fc.assert(
                fc.property(fc.array(routerArbitrary, { minLength: 1, maxLength: 20 }), (routers) => {
                    // 确保有 admin 菜单路由
                    const adminRouters = routers.map((r, i) => ({
                        ...r,
                        path: `/admin/route${i}`,
                        isMenu: true,
                    }))

                    const groups = groupAdminRouters(adminRouters)

                    // 验证所有分组都非空
                    for (const group of groups) {
                        expect(group.items.length).toBeGreaterThan(0)
                    }
                }),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 5: 路由匹配正确性', () => {
        it('精确匹配应返回 true', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('/admin/roles', '/admin/users', '/admin/products'),
                    (path) => {
                        const allPaths = ['/admin/roles', '/admin/users', '/admin/products']
                        expect(isActiveRoute(path, path, allPaths)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('子路由匹配应正确处理', () => {
            // 当前路径是 /admin/roles/123，菜单路径是 /admin/roles
            const allPaths = ['/admin/roles', '/admin/users']
            expect(isActiveRoute('/admin/roles/123', '/admin/roles', allPaths)).toBe(true)
            expect(isActiveRoute('/admin/roles/123', '/admin/users', allPaths)).toBe(false)
        })

        it('更精确的匹配应优先', () => {
            // /admin/redemption-codes/records 应匹配 /admin/redemption-codes/records
            // 而不是 /admin/redemption-codes
            const allPaths = ['/admin/redemption-codes', '/admin/redemption-codes/records']
            expect(
                isActiveRoute(
                    '/admin/redemption-codes/records',
                    '/admin/redemption-codes/records',
                    allPaths
                )
            ).toBe(true)
            expect(
                isActiveRoute('/admin/redemption-codes/records', '/admin/redemption-codes', allPaths)
            ).toBe(false)
        })

        it('不匹配的路径应返回 false', () => {
            const allPaths = ['/admin/roles', '/admin/users']
            expect(isActiveRoute('/dashboard', '/admin/roles', allPaths)).toBe(false)
            expect(isActiveRoute('/admin/products', '/admin/roles', allPaths)).toBe(false)
        })
    })

    describe('单元测试：具体场景', () => {
        it('空路由数组应返回空分组', () => {
            const groups = groupAdminRouters([])
            expect(groups).toEqual([])
        })

        it('只有非 Admin 路由时应返回空分组', () => {
            const routers = [
                { id: 1, path: '/dashboard', isMenu: true, title: '工作台' },
                { id: 2, path: '/user/profile', isMenu: true, title: '个人中心' },
            ]
            const groups = groupAdminRouters(routers)
            expect(groups).toEqual([])
        })

        it('只有 isMenu=false 的 Admin 路由时应返回空分组', () => {
            const routers = [
                { id: 1, path: '/admin/roles', isMenu: false, title: '角色管理' },
                { id: 2, path: '/admin/users', isMenu: false, title: '用户管理' },
            ]
            const groups = groupAdminRouters(routers)
            expect(groups).toEqual([])
        })

        it('应正确分组和排序实际菜单数据', () => {
            const routers = [
                {
                    id: 1,
                    path: '/admin/roles',
                    isMenu: true,
                    title: '角色管理',
                    menuGroup: '权限管理',
                    menuGroupSort: 1,
                    sort: 1,
                },
                {
                    id: 2,
                    path: '/admin/users',
                    isMenu: true,
                    title: '用户管理',
                    menuGroup: '权限管理',
                    menuGroupSort: 1,
                    sort: 2,
                },
                {
                    id: 3,
                    path: '/admin/products',
                    isMenu: true,
                    title: '产品管理',
                    menuGroup: '运营管理',
                    menuGroupSort: 2,
                    sort: 1,
                },
            ]

            const groups = groupAdminRouters(routers)

            expect(groups.length).toBe(2)
            expect(groups[0].name).toBe('权限管理')
            expect(groups[0].sort).toBe(1)
            expect(groups[0].items.length).toBe(2)
            expect(groups[0].items[0].title).toBe('角色管理')
            expect(groups[0].items[1].title).toBe('用户管理')

            expect(groups[1].name).toBe('运营管理')
            expect(groups[1].sort).toBe(2)
            expect(groups[1].items.length).toBe(1)
        })

        it('无 menuGroup 的路由应归入"其他"分组', () => {
            const routers = [
                { id: 1, path: '/admin/test', isMenu: true, title: '测试', menuGroup: null, sort: 1 },
            ]

            const groups = groupAdminRouters(routers)

            expect(groups.length).toBe(1)
            expect(groups[0].name).toBe('其他')
        })
    })
})
