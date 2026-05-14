# Dashboard 用户菜单 — 路由驱动 + RBAC 过滤设计

- 日期：2026-05-14
- 范围：仅 dashboard 用户菜单（PC 左下角 `DashboardNavUser`、移动端右上角 `DashboardNavUserRight`）
- 不影响：admin 后台菜单（已有独立机制）、dashboard 侧边栏（`DashboardNavMain`）

## 目标

把当前 PC 端 `app/components/dashboard/navUser.vue` 和移动端 `app/components/dashboard/navUserRight.vue` 里硬编码的菜单项（"首页 + 退出登录"）改成由 Nuxt 路由 `definePageMeta.userMenu` 声明、中央骨架配置文件管理分组顺序、运行时按当前角色 RBAC 过滤的统一机制。两端共享同一份渲染节点，避免任何重复硬编码。

## 已确认的核心决策

| 决策点 | 选择 |
|---|---|
| 管理粒度 | 混合：路由 meta 自描述 + 运行时 RBAC 过滤（不走后端表） |
| 菜单排版 | 扁平 + 灰色分组小标题，PC 与移动端使用同一排版 |
| 声明位置 | 中央骨架（分组顺序 + 动作项） + page 的 `definePageMeta.userMenu`（路由项） |
| 图标载体 | page meta 写 lucide 字符串名；中央配置文件维护白名单 map → Component |
| 动作绑定 | meta 写 `handler: 'logout'` 字符串字面量；composable 内 handlerMap 绑函数 |
| 角色匹配 | 按 `roles.code` 字段（实施 step 1 确认；若该字段不存在改用 `name`） |
| 渲染层 | 抽 `UserMenuList.vue` 共享子组件，两端组件保留各自触发器和用户卡片 header |

## 菜单内容范围

| 分组 | 菜单项 | 对应路由 |
|---|---|---|
| `home`（无分组标题） | 首页 | `/dashboard` |
| `membership`（"会员中心"） | 我的会员、兑换会员、我的积分、邀请注册、我的订单 | `/dashboard/membership` / `membership/redeem` / `membership/point` / `membership/invitation` / `membership/order` |
| `settings`（"账户设置"） | 个人资料、安全设置 | `/dashboard/settings/profile` / `settings/security` |
| 末尾动作 | 退出登录（红色） | 调用 `useUserNavigation.handleLogout` |

> 现有 `membership/level.vue` 不进菜单。其他 dashboard 子路由（cases / contract / document / legal / tools / assistant / disk-space / buy / analysis）也不进 — 它们是侧边栏入口。

## 架构与数据流

```
app/config/userMenu.ts                 ─┐
  groups   : home, membership, settings │
  actions  : logout                     │
  iconMap  : lucide 白名单              │
                                        │
Nuxt 路由表  useRouter().getRoutes()    ├─► useUserMenu()  ──►  UserMenuRenderNode[]
  meta.userMenu = { group, title, icon, │     1. 扫路由收集                ▲
                    order, roles, hidden}│    2. 按 group 归并 + 排序     │
                                        │     3. 末尾插 separator + action│
useRoleStore.userRoles                  │     4. RBAC 过滤                │
useUserNavigation.handleLogout         ─┘     5. 隐藏空分组                │
                                                                          │
            ┌─────────────────────────────────────────────────────────────┘
            ▼
  <UserMenuList :items="items" />（共享渲染组件）
            │
   ┌────────┴────────┐
   ▼                 ▼
 navUser.vue   navUserRight.vue
 (PC 左下角)   (移动端右上角)
```

**响应式**：`useUserMenu()` 返回 `computed`，依赖 `useRoleStore.userRoles` 和 `useRouter().getRoutes()`。角色切换或路由表变化时自动重算。

## 数据结构

### `shared/types/userMenu.ts`

```ts
import type { Component } from 'vue'

export type LucideIconName = string

export interface UserMenuRouteMeta {
  group: string
  title?: string
  icon: LucideIconName
  order: number
  roles?: string[]
  hidden?: boolean
}

export interface UserMenuGroup {
  id: string
  title?: string         // 不写 = 独立平铺、不显示分组标题（home 用）
  order: number
}

export type UserMenuActionHandler = 'logout'

export interface UserMenuActionItem {
  id: string
  title: string
  icon: LucideIconName
  danger?: boolean
  order: number
  roles?: string[]
  handler: UserMenuActionHandler
}

export type UserMenuRenderNode =
  | { kind: 'group-header'; id: string; title: string }
  | { kind: 'route'; path: string; title: string; icon: Component }
  | { kind: 'separator'; id: string }
  | { kind: 'action'; id: string; title: string; icon: Component; danger: boolean; onClick: () => void | Promise<void> }
```

### `app/config/userMenu.ts`

```ts
import type { Component } from 'vue'
import { Crown, Gift, Coins, UserPlus, ListChecks, User, Lock, Home, LogOut } from 'lucide-vue-next'
import type { UserMenuGroup, UserMenuActionItem, LucideIconName } from '#shared/types/userMenu'

export const userMenuGroups: UserMenuGroup[] = [
  { id: 'home',       order: 0  },
  { id: 'membership', title: '会员中心', order: 10 },
  { id: 'settings',   title: '账户设置', order: 20 },
]

export const userMenuActions: UserMenuActionItem[] = [
  { id: 'logout', title: '退出登录', icon: 'LogOut', danger: true, order: 100, handler: 'logout' },
]

export const userMenuIconMap: Record<LucideIconName, Component> = {
  Home, Crown, Gift, Coins, UserPlus, ListChecks, User, Lock, LogOut,
}
```

> 图标白名单 = page meta 用字符串引用 + 编译期类型检查兜底。新增图标 = map 加一行。

### page meta 标记表

| 页面文件 | userMenu meta |
|---|---|
| `app/pages/dashboard/index.vue` | `{ group: 'home', title: '首页', icon: 'Home', order: 0 }` |
| `app/pages/dashboard/membership/index.vue` | `{ group: 'membership', title: '我的会员', icon: 'Crown', order: 1 }` |
| `app/pages/dashboard/membership/redeem.vue` | `{ group: 'membership', title: '兑换会员', icon: 'Gift', order: 2 }` |
| `app/pages/dashboard/membership/point.vue` | `{ group: 'membership', title: '我的积分', icon: 'Coins', order: 3 }` |
| `app/pages/dashboard/membership/invitation.vue` | `{ group: 'membership', title: '邀请注册', icon: 'UserPlus', order: 4 }` |
| `app/pages/dashboard/membership/order.vue` | `{ group: 'membership', title: '我的订单', icon: 'ListChecks', order: 5 }` |
| `app/pages/dashboard/settings/profile.vue` | `{ group: 'settings', title: '个人资料', icon: 'User', order: 1 }` |
| `app/pages/dashboard/settings/security.vue` | `{ group: 'settings', title: '安全设置', icon: 'Lock', order: 2 }` |

## composable 实现

### `app/composables/useUserMenu.ts`

```ts
import { computed, type ComputedRef } from 'vue'
import { useRouter } from 'vue-router'
import type { UserMenuRenderNode, UserMenuRouteMeta } from '#shared/types/userMenu'
import { userMenuGroups, userMenuActions, userMenuIconMap } from '~/config/userMenu'
import { useRoleStore } from '~/store/role'
import { useUserNavigation } from '~/composables/useUserNavigation'

export function useUserMenu(): { items: ComputedRef<UserMenuRenderNode[]> } {
  const router = useRouter()
  const roleStore = useRoleStore()
  const { handleLogout } = useUserNavigation()

  const handlerMap: Record<string, () => void | Promise<void>> = {
    logout: handleLogout,
  }

  const items = computed<UserMenuRenderNode[]>(() => {
    const myRoleCodes = new Set(
      (roleStore.userRoles ?? [])
        .map((r) => (r as { code?: string; name?: string }).code ?? r.name)
        .filter((c): c is string => !!c),
    )
    const allowed = (roles?: string[]) =>
      !roles || roles.length === 0 || roles.some((c) => myRoleCodes.has(c))

    // 1. 扫路由
    type Collected = UserMenuRouteMeta & { path: string; fallbackTitle?: string }
    const collected: Collected[] = []
    for (const r of router.getRoutes()) {
      const meta = (r.meta as { userMenu?: UserMenuRouteMeta; title?: string } | undefined)
      if (!meta?.userMenu || meta.userMenu.hidden) continue
      if (!allowed(meta.userMenu.roles)) continue
      collected.push({ ...meta.userMenu, path: r.path, fallbackTitle: meta.title })
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
        const icon = userMenuIconMap[c.icon]
        if (!icon) continue
        nodes.push({
          kind: 'route',
          path: c.path,
          title: c.title || c.fallbackTitle || c.path,
          icon,
        })
      }
    }

    // 3. 分隔线 + 动作项
    const visibleActions = userMenuActions
      .filter((a) => allowed(a.roles))
      .sort((a, b) => a.order - b.order)
    if (visibleActions.length > 0) {
      nodes.push({ kind: 'separator', id: 'actions' })
      for (const a of visibleActions) {
        const icon = userMenuIconMap[a.icon]
        const onClick = handlerMap[a.handler]
        if (!icon || !onClick) continue
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

## 共享渲染组件

### `app/components/dashboard/UserMenuList.vue`

只渲染 `UserMenuRenderNode[]`，不含外层 DropdownMenu 容器、不含触发器、不含数据获取。

```vue
<template>
  <template v-for="(node, idx) in items" :key="`${node.kind}-${'id' in node ? node.id : ('path' in node ? node.path : idx)}`">
    <DropdownMenuLabel v-if="node.kind === 'group-header'" class="px-2 py-1.5 text-xs text-muted-foreground font-normal">
      {{ node.title }}
    </DropdownMenuLabel>

    <NuxtLink v-else-if="node.kind === 'route'" :to="node.path" class="block">
      <DropdownMenuItem class="cursor-pointer">
        <component :is="node.icon" class="mr-2 h-4 w-4" />
        {{ node.title }}
      </DropdownMenuItem>
    </NuxtLink>

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
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '~/components/ui/dropdown-menu'
import type { UserMenuRenderNode } from '#shared/types/userMenu'

defineProps<{ items: UserMenuRenderNode[] }>()
</script>
```

## 组件改造

### `app/components/dashboard/navUser.vue`（PC 左下角）

- 触发器保持原样：`SidebarMenuButton size="lg"` + 头像 + 名字 + 手机号 + ChevronsUpDown 图标
- `DropdownMenuContent`：`side="right"` `align="end"`，保留用户卡片 header
- 用户卡片 header 下方原本的硬编码菜单 + 退出登录 → 替换为 `<UserMenuList :items="items" />`
- 引入 `useUserMenu()` 获取 `items`

### `app/components/dashboard/navUserRight.vue`（移动端右上角）

- 触发器保持原样：`<button>` + `<User class="h-6 w-6" />`
- `DropdownMenuContent`：`side="bottom"` `align="end"`，保留用户卡片 header
- 同样替换为 `<UserMenuList :items="items" />`
- 移除组件内部所有 TODO 注释

> 用户卡片 header 在两个组件里几乎一致但触发器不同，**不抽**共享 header 组件；如果未来出现第三个使用方再抽。

## RBAC 过滤策略

- **角色来源**：`useRoleStore.userRoles`（已在登录后初始化，SSR 水合兼容）
- **匹配字段**：`roles.code` 优先，fallback `name`；实施 step 1 用 `npx tsx -e` 或读 `prisma/models/rbac.prisma` 确认实际字段
- **规则**：
  - `meta.userMenu.roles` / `action.roles` 未写或空数组 = 所有登录用户可见
  - 写了 = 任一当前角色 code 命中即通过
- **未登录态**：dashboard layout 已有登录中间件保护，菜单 composable 不处理
- **角色未水合时**：当成"无角色"处理（仅显示无 roles 限制的项），水合完成 computed 自动重算

## 测试策略

### Composable 单测 — `tests/client/composables/useUserMenu.test.ts`

| 用例 | 期望 |
|---|---|
| 路由表为空 | 返回空数组 |
| 单一 home 项（group 无 title） | 一个 route 节点，无 group-header |
| 多 group 多项 | 按 group.order → item.order 排序 |
| `meta.hidden = true` | 该项被过滤 |
| `meta.roles` 不命中当前角色 | 该项被过滤 |
| 某分组下所有项被过滤 | 该 group-header 不出现 |
| 末尾 separator + action 节点正确插入 | action 按 order 排序 |
| action.roles 不命中 | 该动作被过滤 |
| `meta.icon` 名未登记 | 跳过该项，不抛错 |
| 用户多角色 | 任一命中即通过 |

mock 策略：
- `useRouter` → 返回固定 `routes` 数组（手工构造）
- `useRoleStore` → `setActivePinia(createTestingPinia({ initialState }))`
- `useUserNavigation` → stub `handleLogout`，断言 action 节点 `onClick === stub`

**不做** E2E。UI 改造的渲染层很薄，由 DropdownMenu 行为保证可用性。

### 手动浏览器验证清单

完成实施后，用 chrome-devtools MCP 启动 dev 并依次验证：

1. PC 宽窗 → 左下角触发，菜单结构与"扁平 + 分组标题" mockup 一致
2. 窄窗（<md）→ 右上角 User 图标触发，菜单内容完全一致
3. 深色模式切换 → 分组标题（muted-foreground）和危险动作（红色）正常
4. 点击任意路由项 → 正确跳转 + 弹层关闭
5. 点击"退出登录" → 调用现有 logout 流程

## 边界处理

| 场景 | 处理 |
|---|---|
| 路由无 `meta.userMenu` | 不进用户菜单（侧边栏入口的默认情况） |
| `meta.userMenu.icon` 未登记 | 跳过该项 + `logger.warn`（防御，不抛错） |
| 中央骨架登记的 group 无任何项 | 空分组隐藏 |
| `meta.userMenu.title` 未填 | fallback 到 `meta.title`，再 fallback 到 `path` |
| SSR 阶段角色未水合 | 仅显示无 roles 限制的项，水合后 computed 自动重算 |
| 用户多角色 | 任一命中即通过 |
| 弹层超出视口 | shadcn `DropdownMenuContent` 自带滚动 |
| 无障碍 | `DropdownMenuLabel` / `DropdownMenuItem` 自带语义，无需额外 sr-only |

## 实施清单（文件影响范围）

**新增文件（5）**：
- `shared/types/userMenu.ts`
- `app/config/userMenu.ts`
- `app/composables/useUserMenu.ts`
- `app/components/dashboard/UserMenuList.vue`
- `tests/client/composables/useUserMenu.test.ts`

**改造文件（2）**：
- `app/components/dashboard/navUser.vue`
- `app/components/dashboard/navUserRight.vue`

**page meta 追加（8）**：
- `app/pages/dashboard/index.vue`
- `app/pages/dashboard/membership/index.vue`
- `app/pages/dashboard/membership/redeem.vue`
- `app/pages/dashboard/membership/point.vue`
- `app/pages/dashboard/membership/invitation.vue`
- `app/pages/dashboard/membership/order.vue`
- `app/pages/dashboard/settings/profile.vue`
- `app/pages/dashboard/settings/security.vue`

**总计影响 15 个文件，全部前端，无后端 / 无数据库迁移。**

## 非目标（明确不做）

- 不为 dashboard 用户菜单建后端表 / API（暂时不需要运营配置）
- 不改造 admin 用户菜单（admin 后台已有独立菜单机制，不在本设计范围）
- 不改造 dashboard 侧边栏 `DashboardNavMain`（侧边栏入口与用户菜单是不同维度）
- 不做菜单项的 i18n（本期保持中文硬编码 title，与项目当前其他菜单一致）
- 不抽 `UserMenuHeader` 共享组件（仅 2 个使用方，重复 8 行模板可以接受）

## 未决细节（实施时确认）

1. `roles` 表的角色 code 字段名（`code` vs `name`）— 看 `prisma/models/rbac.prisma`
2. 移动端右上角的 `hover:bg-gray-100` 当前是写死的，dark 模式不友好 — 顺手改成 `hover:bg-muted`（已在段 3 草稿里改了）
