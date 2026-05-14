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
