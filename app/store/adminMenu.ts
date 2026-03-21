import { defineStore } from 'pinia'
import type { AdminMenuItem, AdminMenuGroup } from '~/composables/useAdminMenu'

/** adminMenuStore 返回类型 */
export interface AdminMenuStoreReturn {
  rawRouters: any[]
  isLoading: boolean
  error: ComputedRef<string | null>
  collapsedIds: Set<string>
  activeId: string
  scrollPosition: number
  menuGroups: ComputedRef<AdminMenuGroup[]>
  fetchMenuData: () => Promise<void>
  toggleSubmenu: (id: number) => void
  setActive: (path: string) => void
  setScrollPosition: (pos: number) => void
  isSubmenuCollapsed: (id: number) => boolean
  isActive: (path: string) => boolean
}

export const useAdminMenuStore = defineStore('adminMenu', (): AdminMenuStoreReturn => {
  // 原始路由数据
  const rawRouters = ref<any[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // UI 状态
  const collapsedIds = ref<Set<string>>(new Set())
  const activeId = ref<string>('')
  const scrollPosition = ref<number>(0)

  /** 加载菜单数据（有缓存则不重复请求） */
  async function fetchMenuData() {
    if (rawRouters.value.length > 0) return
    if (isLoading.value) return

    isLoading.value = true
    error.value = null
    try {
      const data = await $fetch<any>('/api/v1/admin/menu-routers')
      // API 返回 resSuccess 格式：{ code, message, data }
      if (data.code === 200 && data.data) {
        rawRouters.value = data.data
      }
    }
    catch (err: any) {
      error.value = err?.message || '获取菜单失败'
      console.error('获取 Admin 菜单失败:', err)
    }
    finally {
      isLoading.value = false
    }
  }

  /** 切换子菜单展开状态 */
  function toggleSubmenu(id: number) {
    const key = String(id)
    if (collapsedIds.value.has(key)) {
      collapsedIds.value.delete(key)
    }
    else {
      collapsedIds.value.add(key)
    }
    collapsedIds.value = new Set(collapsedIds.value) // 触发响应式
  }

  /** 设置当前激活菜单 */
  function setActive(path: string) {
    activeId.value = path
  }

  /** 设置滚动位置 */
  function setScrollPosition(pos: number) {
    scrollPosition.value = pos
  }

  /** 检查菜单是否折叠 */
  function isSubmenuCollapsed(id: number): boolean {
    return collapsedIds.value.has(String(id))
  }

  /** 检查菜单是否激活 */
  function isActive(path: string): boolean {
    return activeId.value === path
  }

  /** 分组后的菜单数据（带权限过滤） */
  const permissionStore = usePermissionStore()
  const menuGroups = computed<AdminMenuGroup[]>(() => {
    const routers = rawRouters.value
      .filter((r: any) => r.isMenu && r.path?.startsWith('/admin'))
      .filter((r: any) => permissionStore.isSuperAdmin || permissionStore.hasRoutePermission(r.path))

    const groupMap = new Map<string, AdminMenuItem[]>()
    const groupSortMap = new Map<string, number>()

    for (const router of routers) {
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
        icon: getAdminIcon(router.icon),
        sort: router.sort ?? 0,
      })
    }

    return Array.from(groupMap.entries())
      .map(([name, items]) => ({
        name,
        sort: groupSortMap.get(name) ?? 999,
        items: items.sort((a, b) => a.sort - b.sort),
      }))
      .filter(group => group.items.length > 0)
      .sort((a, b) => a.sort - b.sort)
  })

  return {
    rawRouters,
    isLoading,
    error: computed(() => error.value),
    collapsedIds,
    activeId,
    scrollPosition,
    menuGroups,
    fetchMenuData,
    toggleSubmenu,
    setActive,
    setScrollPosition,
    isSubmenuCollapsed,
    isActive,
  }
})
