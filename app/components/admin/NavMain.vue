<template>
  <!-- 动态渲染菜单分组 -->
  <template v-for="group in menuGroups" :key="group.name">
    <SidebarGroup>
      <SidebarGroupLabel>{{ group.name }}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem v-for="item in group.items" :key="item.id">
            <SidebarMenuButton as-child :tooltip="item.title"
              :class="isActive(item.path) ? 'bg-primary/10 text-primary' : ''">
              <NuxtLink :to="item.path">
                <component v-if="item.icon" :is="item.icon" class="h-4 w-4" />
                <span>{{ item.title }}</span>
              </NuxtLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  </template>

  <!-- 加载状态 -->
  <div v-if="isLoading" class="p-4 text-center text-muted-foreground">
    加载中...
  </div>

  <!-- 空状态 -->
  <div v-else-if="menuGroups.length === 0" class="p-4 text-center text-muted-foreground">
    暂无可访问的菜单
  </div>
</template>

<script setup lang="ts">
import { useAdminMenu } from '~/composables/useAdminMenu'
const { menuGroups, isLoading, isActive } = useAdminMenu()
</script>
