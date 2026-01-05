/**
 * Admin 菜单 Composable
 * 
 * 从 Role Store 获取路由数据，按 menuGroup 分组并排序
 * 复用 Dashboard 的图标映射逻辑
 */

import type { Component } from 'vue'

/** 菜单项 */
export interface AdminMenuItem {
    id: number
    path: string
    title: string
    icon: Component | null
    sort: number
}

/** 菜单分组 */
export interface AdminMenuGroup {
    name: string
    sort: number
    items: AdminMenuItem[]
}

/** useAdminMenu 返回类型 */
export interface UseAdminMenuReturn {
    menuGroups: ComputedRef<AdminMenuGroup[]>
    isLoading: ComputedRef<boolean>
    error: ComputedRef<string | null>
    isActive: (path: string) => boolean
}

/**
 * 获取图标组件
 * 复用 Dashboard 的图标映射逻辑
 */
export const getAdminIcon = (iconName: string | null): Component | null => {
    if (!iconName) return null
    // 如果格式是 "lucideIcons.LayoutDashboardIcon"
    if (iconName.startsWith('lucideIcons.')) {
        const name = iconName.replace('lucideIcons.', '')
        return (lucideIcons[name as keyof typeof lucideIcons] as Component) || null
    }
    // 如果只是图标名称 "LayoutDashboardIcon"
    return (lucideIcons[iconName as keyof typeof lucideIcons] as Component) || null
}

/**
 * Admin 菜单 Composable
 * 
 * 从权限 Store 获取路由权限，按 menuGroup 分组并排序
 * 超级管理员直接获取所有 Admin 路由
 */
export function useAdminMenu(): UseAdminMenuReturn {
    const permissionStore = usePermissionStore()
    const route = useRoute()

    // Admin 路由数据
    const adminRouters = ref<any[]>([])
    const isLoading = ref(false)
    const error = ref<string | null>(null)

    // 获取 Admin 路由数据
    const fetchAdminRouters = async () => {
        isLoading.value = true
        error.value = null
        try {
            // 直接从数据库获取所有 Admin 菜单路由
            const data = await $fetch<any>('/api/v1/admin/menu-routers')
            if (data.success && data.data) {
                adminRouters.value = data.data
            }
        } catch (err: any) {
            error.value = err?.message || '获取菜单失败'
            console.error('获取 Admin 菜单失败:', err)
        } finally {
            isLoading.value = false
        }
    }

    // 初始化时获取数据
    onMounted(() => {
        // 只有超级管理员或有 Admin 路由权限的用户才获取菜单
        if (permissionStore.isSuperAdmin || permissionStore.routePermissions.some(p => p.startsWith('/admin'))) {
            fetchAdminRouters()
        }
    })

    // 将路由数据按 menuGroup 分组
    const menuGroups = computed<AdminMenuGroup[]>(() => {
        const routers = adminRouters.value
            .filter((r: any) => r.isMenu && r.path?.startsWith('/admin'))
            // 超级管理员显示所有菜单，否则根据权限过滤
            .filter((r: any) => permissionStore.isSuperAdmin || permissionStore.hasRoutePermission(r.path))

        // 按 menuGroup 分组
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

        // 转换为数组并排序
        return Array.from(groupMap.entries())
            .map(([name, items]) => ({
                name,
                sort: groupSortMap.get(name) ?? 999,
                items: items.sort((a, b) => a.sort - b.sort),
            }))
            .filter(group => group.items.length > 0)
            .sort((a, b) => a.sort - b.sort)
    })

    /**
     * 判断菜单是否激活（精确匹配或子路由匹配）
     */
    const isActive = (path: string): boolean => {
        // 精确匹配当前路径
        if (route.path === path) return true
        // 子路由匹配：当前路径以 path/ 开头
        if (route.path.startsWith(path + '/')) {
            // 检查是否有更精确的菜单项匹配当前路径
            const allPaths = adminRouters.value
                .filter((r: any) => r.isMenu)
                .map((r: any) => r.path)
            const hasMoreSpecificMatch = allPaths.some((p: string) => p !== path && route.path.startsWith(p))
            return !hasMoreSpecificMatch
        }
        return false
    }

    return {
        menuGroups,
        isLoading: computed(() => isLoading.value),
        error: computed(() => error.value),
        isActive,
    }
}
