/**
 * useUserMenu composable 测试
 *
 * 测试基于 Nuxt 路由 meta 的用户菜单收集 + 分组归并 + RBAC 过滤 + 动作项注入
 *
 * **Feature: dashboard-user-menu**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { UserMenuRouteMeta } from '#shared/types/userMenu'

// ========== hoisted mock state ==========
// vi.mock 工厂在 module 解析时被 hoist 到顶部 — 必须用 vi.hoisted 让 mock 函数能引用这些状态
const {
  mockRoutes,
  mockUserRoles,
  mockGroups,
  mockActions,
  loggerWarn,
  handleLogoutStub,
} = vi.hoisted(() => ({
  mockRoutes: { value: [] as Array<{ path: string; meta: Record<string, unknown> }> },
  mockUserRoles: { value: [] as Array<{ code?: string; name?: string }> },
  mockGroups: { value: [] as Array<{ id: string; title?: string; order: number }> },
  mockActions: { value: [] as Array<{ id: string; title: string; icon: string; danger?: boolean; order: number; roles?: string[]; handler: 'logout' }> },
  loggerWarn: vi.fn(),
  handleLogoutStub: vi.fn(),
}))

// ========== module mocks ==========

// composable 自动导入 useRouter — mock vue-router 模块本体替换它
vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
  return {
    ...actual,
    useRouter: () => ({
      getRoutes: () => mockRoutes.value,
    }),
  }
})

// composable 显式 import useRoleStore — mock 该模块
vi.mock('~/store/role', () => ({
  useRoleStore: () => ({
    get userRoles() { return mockUserRoles.value },
  }),
}))

// getAdminIcon — 'INVALID' 返回 null，其他名返回伪 component
vi.mock('~/composables/useAdminMenu', () => ({
  getAdminIcon: (name: string) => {
    if (name === 'INVALID') return null
    return { __iconName: name }
  },
}))

// useUserNavigation — handleLogout 是 stub，可断言被绑到 action.onClick
vi.mock('~/composables/useUserNavigation', () => ({
  useUserNavigation: () => ({
    handleLogout: handleLogoutStub,
    displayName: ref('dx'),
    maskedPhone: ref('130****8490'),
  }),
}))

// 中央骨架 — 用 getter 让测试用例可注入
vi.mock('~/config/userMenu', () => ({
  get userMenuGroups() { return mockGroups.value },
  get userMenuActions() { return mockActions.value },
}))

// logger 由 composable 显式 import — mock 该模块的 named export
vi.mock('#shared/utils/logger', () => ({
  logger: { warn: loggerWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

// 被测函数 — 必须在 mock 之后导入
const { useUserMenu } = await import('~/composables/useUserMenu')

// ========== helpers ==========

function makeRoute(path: string, userMenu?: UserMenuRouteMeta, title?: string) {
  return { path, meta: { userMenu, title } }
}

beforeEach(() => {
  mockRoutes.value = []
  mockUserRoles.value = []
  mockGroups.value = []
  mockActions.value = []
  loggerWarn.mockClear()
  handleLogoutStub.mockClear()
})

// ========== tests ==========

describe('useUserMenu', () => {
  it('路由表为空 + 无动作项 → 返回空数组', () => {
    const { items } = useUserMenu()
    expect(items.value).toEqual([])
  })

  it('单一 home 项 + group 无 title → 一个 route 节点、无 group-header', () => {
    mockGroups.value = [{ id: 'home', order: 0 }]
    mockRoutes.value = [
      makeRoute('/dashboard', { group: 'home', title: '首页', icon: 'Home', order: 0 }),
    ]

    const { items } = useUserMenu()
    expect(items.value).toHaveLength(1)
    expect(items.value[0]).toMatchObject({ kind: 'route', path: '/dashboard', title: '首页' })
  })

  it('多 group 多项 → 按 group.order → item.order 排序，分组有 title 时出 group-header', () => {
    mockGroups.value = [
      { id: 'home',       order: 0  },
      { id: 'membership', title: '会员中心', order: 10 },
      { id: 'settings',   title: '账户设置', order: 20 },
    ]
    // 故意打乱顺序传入
    mockRoutes.value = [
      makeRoute('/dashboard/settings/profile',  { group: 'settings',   title: '个人资料', icon: 'User',  order: 1 }),
      makeRoute('/dashboard/membership/redeem', { group: 'membership', title: '兑换会员', icon: 'Gift',  order: 2 }),
      makeRoute('/dashboard/membership',        { group: 'membership', title: '我的会员', icon: 'Crown', order: 1 }),
      makeRoute('/dashboard',                   { group: 'home',       title: '首页',    icon: 'Home',  order: 0 }),
    ]

    const { items } = useUserMenu()
    expect(items.value.map((n) => n.kind)).toEqual([
      'route',                  // 首页（home 无 title，无 header）
      'group-header',           // 会员中心
      'route',                  // 我的会员
      'route',                  // 兑换会员
      'group-header',           // 账户设置
      'route',                  // 个人资料
    ])
    expect((items.value[2] as any).title).toBe('我的会员')
    expect((items.value[3] as any).title).toBe('兑换会员')
  })

  it('meta.roles 不命中当前角色 → 该项被过滤', () => {
    mockGroups.value = [{ id: 'home', order: 0 }]
    mockUserRoles.value = [{ code: 'user' }]
    mockRoutes.value = [
      makeRoute('/dashboard/admin',  { group: 'home', title: '管理后台', icon: 'Shield', order: 0, roles: ['super_admin'] }),
      makeRoute('/dashboard',        { group: 'home', title: '首页',    icon: 'Home',   order: 1 }),
    ]

    const { items } = useUserMenu()
    expect(items.value).toHaveLength(1)
    expect((items.value[0] as any).title).toBe('首页')
  })

  it('某分组下所有项被过滤 → 该 group-header 不出现', () => {
    mockGroups.value = [
      { id: 'home',       order: 0  },
      { id: 'membership', title: '会员中心', order: 10 },
    ]
    mockUserRoles.value = [{ code: 'user' }]
    mockRoutes.value = [
      makeRoute('/dashboard',         { group: 'home',       title: '首页', icon: 'Home', order: 0 }),
      makeRoute('/dashboard/vip-only',{ group: 'membership', title: 'VIP', icon: 'Crown', order: 0, roles: ['vip'] }),
    ]

    const { items } = useUserMenu()
    // 只有首页一项；membership group-header 不应出现
    expect(items.value).toHaveLength(1)
    expect(items.value[0]).toMatchObject({ kind: 'route', title: '首页' })
  })

  it('末尾 separator + action 节点正确插入，action 按 order 排序', () => {
    mockGroups.value = [{ id: 'home', order: 0 }]
    mockActions.value = [
      { id: 'logout', title: '退出登录', icon: 'LogOut', danger: true, order: 100, handler: 'logout' },
    ]
    mockRoutes.value = [
      makeRoute('/dashboard', { group: 'home', title: '首页', icon: 'Home', order: 0 }),
    ]

    const { items } = useUserMenu()
    expect(items.value.map((n) => n.kind)).toEqual(['route', 'separator', 'action'])
    const action = items.value[2] as any
    expect(action.id).toBe('logout')
    expect(action.danger).toBe(true)
    expect(action.onClick).toBe(handleLogoutStub)
  })

  it('action.roles 不命中 → 该动作被过滤', () => {
    mockGroups.value = [{ id: 'home', order: 0 }]
    mockActions.value = [
      { id: 'logout',     title: '退出登录', icon: 'LogOut', danger: true, order: 100, handler: 'logout' },
      { id: 'admin-only', title: '管理',    icon: 'Shield', order: 50,  roles: ['super_admin'], handler: 'logout' },
    ]
    mockUserRoles.value = [{ code: 'user' }]
    mockRoutes.value = [
      makeRoute('/dashboard', { group: 'home', title: '首页', icon: 'Home', order: 0 }),
    ]

    const { items } = useUserMenu()
    // 期望：route + separator + 1 个 action（logout，admin-only 被过滤）
    expect(items.value).toHaveLength(3)
    expect(items.value.map((n) => n.kind)).toEqual(['route', 'separator', 'action'])
    expect((items.value[2] as any).id).toBe('logout')
  })

  it('icon 名 getAdminIcon 返回 null → 跳过该项 + logger.warn', () => {
    mockGroups.value = [{ id: 'home', order: 0 }]
    mockRoutes.value = [
      makeRoute('/dashboard/bad',   { group: 'home', title: 'Bad',  icon: 'INVALID', order: 0 }),
      makeRoute('/dashboard/good',  { group: 'home', title: 'Good', icon: 'Home',    order: 1 }),
    ]

    const { items } = useUserMenu()
    expect(items.value).toHaveLength(1)
    expect((items.value[0] as any).title).toBe('Good')
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('INVALID'))
  })

  it('用户多角色 → 任一命中即通过', () => {
    mockGroups.value = [{ id: 'home', order: 0 }]
    mockUserRoles.value = [{ code: 'user' }, { code: 'editor' }]
    mockRoutes.value = [
      makeRoute('/dashboard/edit', { group: 'home', title: '编辑', icon: 'Home', order: 0, roles: ['editor', 'admin'] }),
    ]

    const { items } = useUserMenu()
    expect(items.value).toHaveLength(1)
    expect((items.value[0] as any).title).toBe('编辑')
  })

  it('meta.userMenu.title 未填 → fallback 到 meta.title', () => {
    mockGroups.value = [{ id: 'home', order: 0 }]
    mockRoutes.value = [
      makeRoute('/dashboard', { group: 'home', icon: 'Home', order: 0 }, '工作台'),
    ]

    const { items } = useUserMenu()
    expect((items.value[0] as any).title).toBe('工作台')
  })
})
