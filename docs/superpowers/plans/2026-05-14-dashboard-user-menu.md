# Dashboard 用户菜单 — 路由驱动 + RBAC 过滤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 dashboard 用户菜单（PC 左下角 `DashboardNavUser`、移动端右上角 `DashboardNavUserRight`）从硬编码改成由 Nuxt 路由 `meta.userMenu` 声明、中央骨架管理分组顺序、运行时按角色 RBAC 过滤的统一机制，两端共享同一份渲染节点。

**Architecture:** 中央骨架配置（`app/config/userMenu.ts`）定义分组顺序 + 动作项；8 个 page 的 `definePageMeta.userMenu` 声明具体菜单项；composable `useUserMenu()` 扫路由 + 归并 + RBAC 过滤 + 注入 logout 动作，输出 `UserMenuRenderNode[]`；共享子组件 `UserMenuList.vue` 渲染，被 `navUser.vue` 与 `navUserRight.vue` 复用。无后端 / 无数据库迁移。

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + shadcn-vue DropdownMenu + lucide-vue-next（通过 `~/utils/lucideIcons` + `getAdminIcon()`） + Vitest（client 单测，`vi.stubGlobal` 模式）

**Spec:** `docs/superpowers/specs/2026-05-14-dashboard-user-menu-design.md`

**Pre-conditions:**
- `roles` 表的 `code` 字段已确认存在且 `@unique`（见 `prisma/models/rbac.prisma`），实施中**直接用 `code`，不保留 `?? r.name` fallback**。
- `app/utils/lucideIcons.ts` 已存在并整包导出 lucide-vue-next。
- `app/composables/useAdminMenu.ts:40` 已暴露 `getAdminIcon(iconName)`。
- `app/composables/useUserNavigation.ts` 已提供 `handleLogout` / `displayName` / `maskedPhone`。
- `useRoleStore.userRoles` 在 `app/app.vue:41` 已 await 完成（无 SSR 未水合窗口）。

---

## File Structure（共 15 个文件）

**新增（5）**：
- `shared/types/userMenu.ts` — 用户菜单类型定义（route meta / group / action / render node 4 种 kind）
- `app/config/userMenu.ts` — 中央骨架（分组顺序 + 动作项；不含具体菜单项）
- `app/composables/useUserMenu.ts` — 核心 composable，输出 `ComputedRef<UserMenuRenderNode[]>`
- `app/components/dashboard/UserMenuList.vue` — 共享渲染组件（接收 items props，4 种 kind 分支渲染）
- `tests/client/composables/useUserMenu.test.ts` — composable 单测

**改造（2）**：
- `app/components/dashboard/navUser.vue` — PC 触发器保留，菜单内容换成 `<UserMenuList :items />`
- `app/components/dashboard/navUserRight.vue` — 同上 + 触发器 `hover:bg-gray-100 → hover:bg-muted`

**page meta 追加（8）**：
- `app/pages/dashboard/index.vue` — userMenu: home/首页/Home/0
- `app/pages/dashboard/membership/index.vue` — userMenu: membership/我的会员/Crown/1
- `app/pages/dashboard/membership/redeem.vue` — userMenu: membership/兑换会员/Gift/2
- `app/pages/dashboard/membership/point.vue` — userMenu: membership/我的积分/Coins/3
- `app/pages/dashboard/membership/invitation.vue` — userMenu: membership/邀请注册/UserPlus/4
- `app/pages/dashboard/membership/order.vue` — userMenu: membership/我的订单/ListChecks/5
- `app/pages/dashboard/settings/profile.vue` — userMenu: settings/个人资料/User/1
- `app/pages/dashboard/settings/security.vue` — userMenu: settings/安全设置/Lock/2

---

## Task 1: 类型定义 `shared/types/userMenu.ts`

**Files:**
- Create: `shared/types/userMenu.ts`

- [ ] **Step 1: 创建文件，写入完整类型定义**

```ts
import type { Component } from 'vue'

/**
 * lucide-vue-next 图标名（字符串）
 *
 * 运行时由 `getAdminIcon()` 在 `~/utils/lucideIcons` 中查表；未知名跳过 + logger.warn。
 * 不在类型层硬约束 lucide 实际导出名 — 否则 shared/ 需反向引用 `~/utils`（违反层次）。
 */
export type LucideIconName = string

/** 写在 page 的 `definePageMeta.userMenu` 里 */
export interface UserMenuRouteMeta {
  /** 归属分组 id，对应 userMenuGroups.id */
  group: string
  /** 菜单显示文案；不写则 fallback 到 `meta.title` */
  title?: string
  /** lucide 图标名 */
  icon: LucideIconName
  /** 分组内排序（asc） */
  order: number
  /** 角色 code 白名单；不写或空数组 = 所有登录用户可见 */
  roles?: string[]
}

/** 中央骨架里的分组定义 */
export interface UserMenuGroup {
  /** home / membership / settings ... */
  id: string
  /** 不写 = 独立平铺、不显示灰色小标题（home 用） */
  title?: string
  /** 分组之间的排序 */
  order: number
}

/** 动作 handler 字面量集合 — 扩展时往这里加 */
export type UserMenuActionHandler = 'logout'

/** 中央骨架里的动作项 — 永远在末尾、分隔线下方 */
export interface UserMenuActionItem {
  id: string
  title: string
  icon: LucideIconName
  /** 危险样式（红色） */
  danger?: boolean
  order: number
  roles?: string[]
  handler: UserMenuActionHandler
}

/** composable 输出给组件渲染的扁平节点 */
export type UserMenuRenderNode =
  | { kind: 'group-header'; id: string; title: string }
  | { kind: 'route'; path: string; title: string; icon: Component }
  | { kind: 'separator'; id: string }
  | { kind: 'action'; id: string; title: string; icon: Component; danger: boolean; onClick: () => void | Promise<void> }
```

- [ ] **Step 2: 跑 typecheck 确认无错**

Run: `bun run typecheck`

Expected: 退出码 0，无与 `shared/types/userMenu.ts` 相关的错误。

- [ ] **Step 3: Commit**

```bash
git add shared/types/userMenu.ts
git commit -m "feat(ui): 新增 dashboard 用户菜单类型定义"
```

---

## Task 2: 中央骨架配置 `app/config/userMenu.ts`

**Files:**
- Create: `app/config/userMenu.ts`（目录 `app/config/` 项目当前不存在，新建即可）

- [ ] **Step 1: 检查 `app/config/` 目录是否已存在**

Run: `ls -d app/config/ 2>/dev/null || echo MISSING`

Expected: `MISSING`（确认需要新建目录）

- [ ] **Step 2: 创建文件 + 写入分组骨架与动作项**

```ts
import type { UserMenuGroup, UserMenuActionItem } from '#shared/types/userMenu'

/**
 * 分组骨架 — 决定分组顺序与标题
 *
 * 不写 `title` 表示该组下的项目独立平铺、不显示灰色小标题（home 用）。
 */
export const userMenuGroups: UserMenuGroup[] = [
  { id: 'home',       order: 0  },
  { id: 'membership', title: '会员中心', order: 10 },
  { id: 'settings',   title: '账户设置', order: 20 },
]

/**
 * 动作项 — 永远在末尾、分隔线下方
 *
 * `icon` 走字符串名（lucide-vue-next），由 `getAdminIcon()` 运行时解析。
 * `handler` 走字符串字面量 — composable 内 handlerMap 绑实际函数。
 */
export const userMenuActions: UserMenuActionItem[] = [
  { id: 'logout', title: '退出登录', icon: 'LogOut', danger: true, order: 100, handler: 'logout' },
]
```

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`

Expected: 退出码 0。

- [ ] **Step 4: Commit**

```bash
git add app/config/userMenu.ts
git commit -m "feat(ui): 新增 dashboard 用户菜单中央骨架配置"
```

---

## Task 3: composable 单测（先写测试，TDD 红灯阶段）

**Files:**
- Create: `tests/client/composables/useUserMenu.test.ts`

参考已有测试模板：`tests/client/composables/useAdminMenu.test.ts`（同样用 `vi.stubGlobal` 模拟 store / route / lucideIcons）。

- [ ] **Step 1: 创建测试文件，写入完整测试用例**

```ts
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

// ========== mocks ==========

/** mock 路由表 — 每个用例重置 */
const mockRoutes = ref<Array<{ path: string; meta: Record<string, unknown> }>>([])
vi.stubGlobal('useRouter', () => ({
  getRoutes: () => mockRoutes.value,
}))

/** mock 角色 store */
const mockUserRoles = ref<Array<{ code?: string; name?: string }>>([])
vi.stubGlobal('useRoleStore', () => ({
  userRoles: mockUserRoles.value,
}))

/** mock logger（spec 要求未知 icon 时 logger.warn） */
const loggerWarn = vi.fn()
vi.stubGlobal('logger', { warn: loggerWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() })

/** mock computed — vitest setup 已自动导入，但 stubGlobal 覆盖以避免边缘） */
// 注意：computed 来自 Vue，已通过 import 解决；此处不 stub

/** mock getAdminIcon — 把字符串名当作伪 component 返回；'INVALID' 返回 null */
vi.mock('~/composables/useAdminMenu', () => ({
  getAdminIcon: vi.fn((name: string) => {
    if (name === 'INVALID') return null
    return { __iconName: name } as unknown as import('vue').Component
  }),
}))

/** mock useUserNavigation — handleLogout 是 stub，可断言被绑到 action.onClick */
const handleLogoutStub = vi.fn()
vi.mock('~/composables/useUserNavigation', () => ({
  useUserNavigation: () => ({
    handleLogout: handleLogoutStub,
    displayName: ref('dx'),
    maskedPhone: ref('130****8490'),
  }),
}))

/** mock 中央骨架 — 让测试用例可控注入 */
const mockGroups = ref<Array<{ id: string; title?: string; order: number }>>([])
const mockActions = ref<Array<{ id: string; title: string; icon: string; danger?: boolean; order: number; roles?: string[]; handler: 'logout' }>>([])
vi.mock('~/config/userMenu', () => ({
  get userMenuGroups() { return mockGroups.value },
  get userMenuActions() { return mockActions.value },
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
```

- [ ] **Step 2: 跑测试，确认全部失败（composable 还没实现）**

Run: `npx vitest run tests/client/composables/useUserMenu.test.ts --reporter=verbose`

Expected: 全部 10 个用例失败，错误信息含 `Cannot find module '~/composables/useUserMenu'` 或类似（因为 composable 文件还不存在）。

- [ ] **Step 3: Commit（红灯阶段）**

```bash
git add tests/client/composables/useUserMenu.test.ts
git commit -m "test(ui): 新增 useUserMenu composable 单测（红灯）"
```

---

## Task 4: composable 实现 `app/composables/useUserMenu.ts`（TDD 绿灯阶段）

**Files:**
- Create: `app/composables/useUserMenu.ts`

- [ ] **Step 1: 创建文件，写入实现**

```ts
import type { ComputedRef } from 'vue'
import type { UserMenuRenderNode, UserMenuRouteMeta } from '#shared/types/userMenu'
import { userMenuGroups, userMenuActions } from '~/config/userMenu'
import { useRoleStore } from '~/store/role'
import { useUserNavigation } from '~/composables/useUserNavigation'
import { getAdminIcon } from '~/composables/useAdminMenu'

/**
 * Dashboard 用户菜单 composable
 *
 * 数据流：
 * 1. 扫 `useRouter().getRoutes()` 收集 `meta.userMenu` 非空的路由
 * 2. 按 `meta.userMenu.group` 归并到中央骨架的分组里，按 `order` 排序
 * 3. 末尾插入分隔线 + 动作项（如 logout）
 * 4. 按当前 `useRoleStore.userRoles[i].code` 做 RBAC 过滤（meta.roles / action.roles）
 * 5. 隐藏空分组、跳过未登记的 icon
 *
 * 输出 `ComputedRef<UserMenuRenderNode[]>`，给 `<UserMenuList>` 组件直接 v-for。
 */
export function useUserMenu(): { items: ComputedRef<UserMenuRenderNode[]> } {
  const router = useRouter()
  const roleStore = useRoleStore()
  const { handleLogout } = useUserNavigation()

  const handlerMap: Record<string, () => void | Promise<void>> = {
    logout: handleLogout,
  }

  const items = computed<UserMenuRenderNode[]>(() => {
    // 当前角色 code 集合（用于 RBAC 过滤）
    const myRoleCodes = new Set(
      (roleStore.userRoles ?? [])
        .map((r) => (r as { code?: string }).code)
        .filter((c): c is string => !!c),
    )
    const allowed = (roles?: string[]) =>
      !roles || roles.length === 0 || roles.some((c) => myRoleCodes.has(c))

    // 1. 扫路由（PageMeta 自带 [key: string]: unknown 索引签名 — cast 自定义字段）
    type Collected = UserMenuRouteMeta & { path: string; fallbackTitle?: string }
    const collected: Collected[] = []
    for (const r of router.getRoutes()) {
      const userMenu = r.meta.userMenu as UserMenuRouteMeta | undefined
      if (!userMenu) continue
      if (!allowed(userMenu.roles)) continue
      collected.push({
        ...userMenu,
        path: r.path,
        fallbackTitle: r.meta.title as string | undefined,
      })
    }

    // 2. 按 group 归并 + 排序
    const grouped = new Map<string, Collected[]>()
    for (const c of collected) {
      const arr = grouped.get(c.group) ?? []
      arr.push(c)
      grouped.set(c.group, arr)
    }
    for (const arr of grouped.values()) arr.sort((a, b) => a.order - b.order)

    const nodes: UserMenuRenderNode[] = []
    const sortedGroups = [...userMenuGroups].sort((a, b) => a.order - b.order)
    for (const g of sortedGroups) {
      const arr = grouped.get(g.id) ?? []
      if (arr.length === 0) continue
      if (g.title) nodes.push({ kind: 'group-header', id: g.id, title: g.title })
      for (const c of arr) {
        const icon = getAdminIcon(c.icon)
        if (!icon) {
          logger.warn(`[useUserMenu] 未知 icon: ${c.icon}（路由 ${c.path}），跳过`)
          continue
        }
        nodes.push({
          kind: 'route',
          path: c.path,
          title: c.title || c.fallbackTitle || '',
          icon,
        })
      }
    }

    // 3. 末尾分隔线 + 动作项
    const visibleActions = userMenuActions
      .filter((a) => allowed(a.roles))
      .sort((a, b) => a.order - b.order)
    if (visibleActions.length > 0) {
      nodes.push({ kind: 'separator', id: 'actions' })
      for (const a of visibleActions) {
        const icon = getAdminIcon(a.icon)
        const onClick = handlerMap[a.handler]
        if (!icon) {
          logger.warn(`[useUserMenu] 未知 action icon: ${a.icon}，跳过`)
          continue
        }
        if (!onClick) continue
        nodes.push({
          kind: 'action',
          id: a.id,
          title: a.title,
          icon,
          danger: a.danger ?? false,
          onClick,
        })
      }
    }

    return nodes
  })

  return { items }
}
```

- [ ] **Step 2: 跑测试，确认全部通过**

Run: `npx vitest run tests/client/composables/useUserMenu.test.ts --reporter=verbose`

Expected: 10 个用例全部 ✓ 绿灯。

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`

Expected: 退出码 0，无相关错误。

- [ ] **Step 4: Commit**

```bash
git add app/composables/useUserMenu.ts
git commit -m "feat(ui): 新增 useUserMenu composable（路由 meta + RBAC 过滤 + 动作注入）"
```

---

## Task 5: 共享渲染组件 `app/components/dashboard/UserMenuList.vue`

**Files:**
- Create: `app/components/dashboard/UserMenuList.vue`

- [ ] **Step 1: 创建文件，写入模板与脚本**

```vue
<template>
  <template v-for="(node, idx) in items" :key="`${node.kind}-${'id' in node ? node.id : ('path' in node ? node.path : idx)}`">
    <DropdownMenuLabel
      v-if="node.kind === 'group-header'"
      class="px-2 py-1.5 text-xs text-muted-foreground font-normal"
    >
      {{ node.title }}
    </DropdownMenuLabel>

    <!-- 路由项：as-child 把 menuitem 角色 + data-highlighted 行为透传给 NuxtLink -->
    <DropdownMenuItem
      v-else-if="node.kind === 'route'"
      as-child
      class="cursor-pointer"
    >
      <NuxtLink
        :to="node.path"
        active-class="bg-accent text-accent-foreground"
        exact-active-class="bg-accent text-accent-foreground font-medium"
      >
        <component :is="node.icon" class="mr-2 h-4 w-4" />
        {{ node.title }}
      </NuxtLink>
    </DropdownMenuItem>

    <DropdownMenuSeparator v-else-if="node.kind === 'separator'" />

    <DropdownMenuItem
      v-else-if="node.kind === 'action'"
      :class="[
        'cursor-pointer group',
        node.danger && 'text-red-500 data-highlighted:bg-red-50 data-highlighted:text-red-600',
      ]"
      @click="node.onClick"
    >
      <component :is="node.icon" :class="['mr-2 h-4 w-4', node.danger && 'group-hover:text-red-600']" />
      <span :class="[node.danger && 'group-hover:text-red-600']">{{ node.title }}</span>
    </DropdownMenuItem>
  </template>
</template>

<script setup lang="ts">
import type { UserMenuRenderNode } from '#shared/types/userMenu'

defineProps<{ items: UserMenuRenderNode[] }>()
</script>
```

> **不要 import** `DropdownMenuItem` / `DropdownMenuLabel` / `DropdownMenuSeparator` — shadcn-nuxt 已自动注册（见 `.claude/rules/ui.md`）。

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`

Expected: 退出码 0。

- [ ] **Step 3: Commit**

```bash
git add app/components/dashboard/UserMenuList.vue
git commit -m "feat(ui): 新增 UserMenuList 共享渲染组件（4 种 kind 分支 + as-child active 态）"
```

---

## Task 6: 给 8 个 page 追加 `userMenu` meta

**Files:**
- Modify: `app/pages/dashboard/index.vue`（已有 `definePageMeta` 在第 207 行）
- Modify: `app/pages/dashboard/membership/index.vue`（第 6 行）
- Modify: `app/pages/dashboard/membership/redeem.vue`（第 45 行）
- Modify: `app/pages/dashboard/membership/point.vue`（第 86 行）
- Modify: `app/pages/dashboard/membership/invitation.vue`（第 137 行）
- Modify: `app/pages/dashboard/membership/order.vue`（第 62 行）
- Modify: `app/pages/dashboard/settings/profile.vue`（第 49 行）
- Modify: `app/pages/dashboard/settings/security.vue`（第 79 行）

对每个文件：用 Edit 工具找到现有的 `definePageMeta({...})` 调用，在其对象字面量内**追加一行** `userMenu: { ... }`。**不要改动现有的 `title` / `layout` 等字段**。

- [ ] **Step 1: 改 `app/pages/dashboard/index.vue`**

先 Read 该文件第 207-210 行确认当前 `definePageMeta` 形状，然后用 Edit 追加 `userMenu` 字段。

示例（当前实际形状已通过实施前调研确认）：

```diff
 definePageMeta({
   title: "工作台",
   layout: "dashboard-layout",
+  userMenu: { group: 'home', title: '首页', icon: 'Home', order: 0 },
 });
```

- [ ] **Step 2: 改 `app/pages/dashboard/membership/index.vue`**

Read 第 6 行附近的 `definePageMeta`，追加：

```ts
userMenu: { group: 'membership', title: '我的会员', icon: 'Crown', order: 1 },
```

- [ ] **Step 3: 改 `app/pages/dashboard/membership/redeem.vue`**

追加：

```ts
userMenu: { group: 'membership', title: '兑换会员', icon: 'Gift', order: 2 },
```

- [ ] **Step 4: 改 `app/pages/dashboard/membership/point.vue`**

追加：

```ts
userMenu: { group: 'membership', title: '我的积分', icon: 'Coins', order: 3 },
```

- [ ] **Step 5: 改 `app/pages/dashboard/membership/invitation.vue`**

追加：

```ts
userMenu: { group: 'membership', title: '邀请注册', icon: 'UserPlus', order: 4 },
```

- [ ] **Step 6: 改 `app/pages/dashboard/membership/order.vue`**

追加：

```ts
userMenu: { group: 'membership', title: '我的订单', icon: 'ListChecks', order: 5 },
```

- [ ] **Step 7: 改 `app/pages/dashboard/settings/profile.vue`**

追加：

```ts
userMenu: { group: 'settings', title: '个人资料', icon: 'User', order: 1 },
```

- [ ] **Step 8: 改 `app/pages/dashboard/settings/security.vue`**

追加：

```ts
userMenu: { group: 'settings', title: '安全设置', icon: 'Lock', order: 2 },
```

- [ ] **Step 9: typecheck**

Run: `bun run typecheck`

Expected: 退出码 0。`userMenu` 字段由于 Nuxt PageMeta 的 `[key: string]: unknown` 索引签名允许，不会报错。

- [ ] **Step 10: Commit（一次提交 8 个 page meta）**

```bash
git add app/pages/dashboard/index.vue app/pages/dashboard/membership/ app/pages/dashboard/settings/
git commit -m "feat(ui): 为 8 个 dashboard 页面追加 userMenu meta（首页 + 会员中心 + 账户设置）"
```

---

## Task 7: 改造 `app/components/dashboard/navUser.vue`（PC 左下角）

**Files:**
- Modify: `app/components/dashboard/navUser.vue`（整体重写）

**当前现状**（仅供执行者了解，不必逐字对照）：第 35-49 行是硬编码的菜单 + 退出登录 DropdownMenuItem。第 60 行 `import { useUserNavigation }`。

- [ ] **Step 1: 用 Write 整体替换为新内容**

```vue
<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            size="lg"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <Avatar class="h-8 w-8 rounded-lg">
              <AvatarFallback class="rounded-lg">LS</AvatarFallback>
            </Avatar>
            <div class="grid flex-1 text-left text-sm leading-tight">
              <span class="truncate font-semibold">{{ displayName }}</span>
              <span class="truncate text-xs">{{ maskedPhone }}</span>
            </div>
            <ChevronsUpDown class="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          class="w-[--reka-dropdown-menu-trigger-width] min-w-56 rounded-lg"
          side="right"
          align="end"
          :side-offset="4"
        >
          <DropdownMenuLabel class="p-0 font-normal">
            <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <Avatar class="h-8 w-8 rounded-lg">
                <AvatarFallback class="rounded-lg">LS</AvatarFallback>
              </Avatar>
              <div class="grid flex-1 text-left text-sm leading-tight">
                <span class="truncate font-semibold">{{ displayName }}</span>
                <span class="truncate text-xs">{{ maskedPhone }}</span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <UserMenuList :items="items" />
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>

<script setup lang="ts">
import { ChevronsUpDown } from 'lucide-vue-next'
import UserMenuList from '~/components/dashboard/UserMenuList.vue'
import { useUserNavigation } from '~/composables/useUserNavigation'
import { useUserMenu } from '~/composables/useUserMenu'

// 用户卡片信息
const { displayName, maskedPhone } = useUserNavigation()

// 菜单数据（共享给两端）
const { items } = useUserMenu()
</script>
```

> 注意：`SidebarMenu` / `SidebarMenuItem` / `SidebarMenuButton` / `DropdownMenu*` / `Avatar*` 都是 shadcn-vue 自动注册组件，不需要显式 import。`computed` / `ref` 等也走自动导入。

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`

Expected: 退出码 0。

- [ ] **Step 3: Commit**

```bash
git add app/components/dashboard/navUser.vue
git commit -m "refactor(ui): navUser（PC 端）接入 useUserMenu + UserMenuList，去掉硬编码菜单"
```

---

## Task 8: 改造 `app/components/dashboard/navUserRight.vue`（移动端右上角）

**Files:**
- Modify: `app/components/dashboard/navUserRight.vue`（整体重写）

**当前现状**：第 4 行触发器用了 `hover:bg-gray-100`（dark 模式不友好），第 22-37 行是硬编码菜单，第 49 行有 TODO 注释。

- [ ] **Step 1: 用 Write 整体替换为新内容**

```vue
<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button class="p-2 rounded-md hover:bg-muted transition-colors focus:outline-none">
        <User class="h-6 w-6" />
      </button>
    </DropdownMenuTrigger>

    <DropdownMenuContent
      class="min-w-56 rounded-lg"
      side="bottom"
      align="end"
      :side-offset="8"
    >
      <DropdownMenuLabel class="p-0 font-normal">
        <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
          <Avatar class="h-8 w-8 rounded-lg">
            <AvatarFallback class="rounded-lg">LS</AvatarFallback>
          </Avatar>
          <div class="grid flex-1 text-left text-sm leading-tight">
            <span class="truncate font-semibold">{{ displayName }}</span>
            <span class="truncate text-xs">{{ maskedPhone }}</span>
          </div>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />

      <UserMenuList :items="items" />
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { User } from 'lucide-vue-next'
import UserMenuList from '~/components/dashboard/UserMenuList.vue'
import { useUserNavigation } from '~/composables/useUserNavigation'
import { useUserMenu } from '~/composables/useUserMenu'

const { displayName, maskedPhone } = useUserNavigation()
const { items } = useUserMenu()
</script>
```

> 与 PC 版的差异：触发器是 `<button>` + `<User>` 图标（不是 SidebarMenuButton），`DropdownMenuContent` 用 `side="bottom"`。**触发器的 `hover:bg-gray-100` 已改为 `hover:bg-muted`**，与 dashboardLayout 顶部其他按钮一致、兼容深色模式。

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`

Expected: 退出码 0。

- [ ] **Step 3: Commit**

```bash
git add app/components/dashboard/navUserRight.vue
git commit -m "refactor(ui): navUserRight（移动端）接入 useUserMenu + UserMenuList，hover 改用 muted"
```

---

## Task 9: 手动浏览器验证

**Files:** 无文件改动；只跑 dev + chrome-devtools。

- [ ] **Step 1: 启动 dev 服务器（如未启动）**

Run: `bun dev`（后台运行；如果已经在跑则跳过此步）

等待启动完成（控制台出现 `Listening on http://localhost:3000`）。

- [ ] **Step 2: 用 chrome-devtools MCP 打开 dashboard 并登录**

跳到 `http://localhost:3000/dashboard`（用一个测试账号登录；超管账号或普通用户均可，因为本期菜单不按角色过滤）。

- [ ] **Step 3: 验证 PC 宽窗 左下角菜单（顺序与内容）**

调整窗口到 PC 宽度（> 1024px）。点击左下角用户卡片（LS dx 130****8490）。

期望（自上而下）：
1. 用户卡片 header（LS 头像 + dx + 130****8490）
2. 分隔线
3. **首页**（无分组标题，独立平铺）
4. 灰色小标题 **会员中心**
5. 我的会员 / 兑换会员 / 我的积分 / 邀请注册 / 我的订单（5 项）
6. 灰色小标题 **账户设置**
7. 个人资料 / 安全设置（2 项）
8. 分隔线
9. **退出登录**（红色）

- [ ] **Step 4: 验证移动端右上角菜单（顺序与内容一致）**

调整窗口到移动端宽度（< 768px）。点击右上角 User 图标。

期望：菜单内容**完全等同**第 3 步，仅触发位置和 side（bottom）不同。

- [ ] **Step 5: 验证深色模式**

切深色模式（顶部主题切换按钮）。

期望：
- 分组小标题用 `muted-foreground`，正常可读
- "退出登录"在深色模式下仍是红色（`text-red-500`）+ hover 高亮
- 移动端触发器 hover 不再发白色（`hover:bg-muted` 生效）

- [ ] **Step 6: 验证 active 态**

点击"兑换会员" → 跳到 `/dashboard/membership/redeem`，弹层自动关闭。**再次打开菜单**，"兑换会员"项应有 active 高亮（`bg-accent text-accent-foreground`）。

切到 `/dashboard/membership/point` 重复，应该是"我的积分"亮、"兑换会员"不亮。

> 这是验证 NuxtLink 的 `router-link-active` / `router-link-exact-active` 自动行为。

- [ ] **Step 7: 验证子页 active 不互窜**

跳到 `/dashboard/membership/redeem` 子路径（精确路径）。打开菜单，确认**只有"兑换会员"亮**，"我的会员"（精确路径 `/dashboard/membership`）**不亮**。这验证 `exact-active-class` 与 `active-class` 的区分。

- [ ] **Step 8: 验证键盘 a11y**

打开菜单后按方向键（↑↓），焦点应该在菜单项之间循环，按 Enter 触发当前焦点项。**这验证 `as-child` 把 menuitem 角色透传给 NuxtLink 成功**。

如果方向键不工作（焦点不切换），说明 Radix 没正确识别 NuxtLink 作为 menuitem 候选，需要回退到 spec 注记的 fallback 方案：把路由项改成 `<DropdownMenuItem class="cursor-pointer" @click="navigateTo(node.path)">...</DropdownMenuItem>`（用 click 跳转代替 NuxtLink）。**如果出现这种情况立即停止、回报，不要继续后续 task**。

- [ ] **Step 9: 验证退出登录**

点击"退出登录"。期望：跳转到 `/login` 页面，用户信息清空。

> 这一步会真的登出！验证完后用账号重新登录再继续后续 task（如果还有手动操作）。

- [ ] **Step 10: 没有改动需提交 — 跳过 commit**

如果第 8 步发现 a11y 问题已回退到 fallback 方案并修改了 `UserMenuList.vue`，则单独 commit：

```bash
git add app/components/dashboard/UserMenuList.vue
git commit -m "fix(ui): UserMenuList 改用 click+navigateTo（as-child 兼容性 fallback）"
```

否则本 task 无 commit。

---

## Task 10: 终验 — typecheck + 单测全跑

**Files:** 无文件改动。

- [ ] **Step 1: 类型检查**

Run: `bun run typecheck`

Expected: 退出码 0，无与本次改动相关的错误。

- [ ] **Step 2: 跑本次新增的 composable 单测**

Run: `npx vitest run tests/client/composables/useUserMenu.test.ts --reporter=verbose`

Expected: 10 个用例全部 ✓ 绿灯。

- [ ] **Step 3: 跑 client 测试集，确保未引入回归**

Run: `bun run test:client`

Expected: 所有 client 测试通过。如有失败，定位是否因本次改动引入。本次改动只新增/修改前端文件，**没有改任何已有 store / composable 的对外 API**，理论上不会破坏其他测试。

- [ ] **Step 4: 检查 git 状态干净**

Run: `git status --short`

Expected: 只有本任务计划之外的预存改动（如根目录的 `shared/utils/tools/*` 等历史未提交），与本次 task 无关；本次涉及的 15 个文件都已 commit。

Run: `git log --oneline -15`

期望看到本计划产生的 8-9 个 commit：
- `feat(ui): 新增 dashboard 用户菜单类型定义`
- `feat(ui): 新增 dashboard 用户菜单中央骨架配置`
- `test(ui): 新增 useUserMenu composable 单测（红灯）`
- `feat(ui): 新增 useUserMenu composable（路由 meta + RBAC 过滤 + 动作注入）`
- `feat(ui): 新增 UserMenuList 共享渲染组件（4 种 kind 分支 + as-child active 态）`
- `feat(ui): 为 8 个 dashboard 页面追加 userMenu meta（首页 + 会员中心 + 账户设置）`
- `refactor(ui): navUser（PC 端）接入 useUserMenu + UserMenuList，去掉硬编码菜单`
- `refactor(ui): navUserRight（移动端）接入 useUserMenu + UserMenuList，hover 改用 muted`
- （可选）`fix(ui): UserMenuList 改用 click+navigateTo（as-child 兼容性 fallback）`

- [ ] **Step 5: 跑 simplify skill 优化代码（CLAUDE.md 要求）**

> CLAUDE.md 第"文档规范"段："每次完成编码后都使用 `simplify` 技能优化代码"

在终端运行：

```
/simplify
```

按 simplify 提示对本次新增/修改的文件做最后一轮代码瘦身（如有可砍的死代码、可合并的 ref、可去的中间变量）。完成后如有改动，单独 commit。

---

## 实施完成验收

完成上面 10 个 task 后，应该满足：

- [x] PC 左下角点击 → 菜单按"扁平 + 分组标题"展示完整 8 项 + 退出登录
- [x] 移动端右上角点击 → 内容完全一致，深色模式 hover 不发白
- [x] 当前页对应的菜单项有 active 高亮，子页不互窜
- [x] 键盘方向键能在 menuitem 之间循环聚焦（a11y）
- [x] composable 单测 10 个用例全绿
- [x] typecheck / client 测试集均通过
- [x] 8 次原子 commit（按 task 划分）

按 spec "未决细节"剩余项：

- [x] `roles` 表字段确认（实施前已确认 `code` 字段 `@unique` 存在，composable 直接用 `code`、无 fallback）

---

## 风险与回退

| 风险点 | 触发条件 | 回退方案 |
|---|---|---|
| `DropdownMenuItem as-child` + NuxtLink 键盘 a11y 失效 | Task 9 Step 8 方向键不工作 | UserMenuList 路由项改用 `<DropdownMenuItem @click="navigateTo(node.path)">`，放弃 NuxtLink 内套（牺牲 prefetch / hover preload，但保 menuitem 角色） |
| RBAC 过滤导致菜单空白 | 任意用户登录后看不到菜单 | 检查 `useRoleStore.userRoles` 在 `app.vue:41` 是否成功 await；本次菜单 8 项均无 `roles` 限制，理论上所有登录用户都应看到完整 8 项 |
| 角色 `code` 字段缺失（妄言） | 实施前已确认存在，几乎不可能发生 | 改用 `name` 字段：把 composable 第 X 行 `.map((r) => (r as { code?: string }).code)` 改成 `.map((r) => (r as { name?: string }).name)` |
| typecheck 失败 — `r.meta.userMenu` 类型冲突 | 项目里别处已有同名 meta 字段 | 重命名 spec 的 `userMenu` 字段为更专属的 `dashboardUserMenu`，同步改 8 个 page meta + composable cast 类型 |
