<template>
  <!-- 权限管理菜单组 -->
  <SidebarGroup>
    <SidebarGroupLabel>权限管理</SidebarGroupLabel>
    <SidebarGroupContent>
      <SidebarMenu>
        <SidebarMenuItem v-for="item in permissionMenuItems" :key="item.path">
          <SidebarMenuButton as-child :tooltip="item.title" :class="isActive(item.path) ? 'bg-primary/10' : ''">
            <NuxtLink :to="item.path">
              <component :is="item.icon" class="h-4 w-4" />
              <span>{{ item.title }}</span>
            </NuxtLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>

  <!-- 运营管理菜单组 -->
  <SidebarGroup>
    <SidebarGroupLabel>运营管理</SidebarGroupLabel>
    <SidebarGroupContent>
      <SidebarMenu>
        <SidebarMenuItem v-for="item in operationMenuItems" :key="item.path">
          <SidebarMenuButton as-child :tooltip="item.title" :class="isActive(item.path) ? 'bg-primary/10' : ''">
            <NuxtLink :to="item.path">
              <component :is="item.icon" class="h-4 w-4" />
              <span>{{ item.title }}</span>
            </NuxtLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
</template>

<script setup lang="ts">
import { Users, Shield, Key, FileText, Settings, Ticket, History } from 'lucide-vue-next'

const route = useRoute()

/** 权限管理菜单项 */
const permissionMenuItems = [
  { path: '/admin/roles', title: '角色管理', icon: Shield },
  { path: '/admin/permissions/api', title: 'API 权限', icon: Key },
  { path: '/admin/permissions/routes', title: '路由权限', icon: Settings },
  { path: '/admin/users', title: '用户管理', icon: Users },
  { path: '/admin/audit', title: '审计日志', icon: FileText },
]

/** 运营管理菜单项 */
const operationMenuItems = [
  { path: '/admin/redemption-codes', title: '兑换码管理', icon: Ticket },
  { path: '/admin/redemption-codes/records', title: '兑换记录', icon: History },
]

/** 判断菜单是否激活（精确匹配或子路由匹配） */
const isActive = (path: string) => {
  // 精确匹配当前路径
  if (route.path === path) return true
  // 子路由匹配：当前路径以 path/ 开头（注意末尾斜杠，避免 /admin/redemption-codes 匹配 /admin/redemption-codes/records）
  if (route.path.startsWith(path + '/')) {
    // 检查是否有更精确的菜单项匹配当前路径
    const allPaths = [...permissionMenuItems, ...operationMenuItems].map(item => item.path)
    const hasMoreSpecificMatch = allPaths.some(p => p !== path && route.path.startsWith(p))
    return !hasMoreSpecificMatch
  }
  return false
}
</script>
