/**
 * Admin 菜单 Composable
 * 读写 adminMenuStore，为组件提供响应式菜单数据
 */

import type { Component } from 'vue'
import { useAdminMenuStore } from '~/store/adminMenu'
import lucideIcons from '~/utils/lucideIcons'

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
    isSubmenuCollapsed: (id: number) => boolean
    toggleSubmenu: (id: number) => void
}

/**
 * 获取图标组件
 * 复用 Dashboard 的图标映射逻辑
 */
export const getAdminIcon = (iconName: string | null): Component | null => {
    if (!iconName) return null
    if (iconName.startsWith('lucideIcons.')) {
        const name = iconName.replace('lucideIcons.', '')
        return (lucideIcons[name as keyof typeof lucideIcons] as Component) || null
    }
    return (lucideIcons[iconName as keyof typeof lucideIcons] as Component) || null
}

/**
 * Admin 菜单 Composable
 * 委托给 adminMenuStore，组件层无需感知 Store 细节
 */
export function useAdminMenu(): UseAdminMenuReturn {
    const store = useAdminMenuStore()
    const route = useRoute()

    // 路由变化时更新激活状态
    watch(() => route.path, (path) => {
        // 从所有菜单路由中找到最长前缀匹配（最精确匹配）
        const matchedRouter = store.rawRouters
            .filter((r: any) => r.path === path || path.startsWith(r.path + '/'))
            .sort((a: any, b: any) => b.path.length - a.path.length)[0]
        if (matchedRouter) {
            store.setActive(matchedRouter.path)
        }
    }, { immediate: true })

    return {
        menuGroups: computed(() => store.menuGroups),
        isLoading: computed(() => store.isLoading),
        error: computed(() => store.error),
        isActive: store.isActive,
        isSubmenuCollapsed: store.isSubmenuCollapsed,
        toggleSubmenu: store.toggleSubmenu,
    }
}
