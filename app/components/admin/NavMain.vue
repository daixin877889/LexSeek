<template>
  <SidebarGroup>
    <SidebarGroupLabel>权限管理</SidebarGroupLabel>
    <SidebarGroupContent>
      <SidebarMenu>
        <SidebarMenuItem v-for="item in menuItems" :key="item.path">
          <SidebarMenuButton 
            as-child 
            :tooltip="item.title"
            :class="isActive(item.path) ? 'bg-primary/10' : ''"
          >
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
import { Users, Shield, Key, FileText, Settings } from 'lucide-vue-next'

const route = useRoute()

/** 菜单项配置 */
const menuItems = [
  { path: '/admin/roles', title: '角色管理', icon: Shield },
  { path: '/admin/permissions/api', title: 'API 权限', icon: Key },
  { path: '/admin/permissions/routes', title: '路由权限', icon: Settings },
  { path: '/admin/users', title: '用户管理', icon: Users },
  { path: '/admin/audit', title: '审计日志', icon: FileText },
]

/** 判断菜单是否激活 */
const isActive = (path: string) => {
  return route.path.startsWith(path)
}
</script>
