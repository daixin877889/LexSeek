<template>
  <!-- 动态渲染菜单分组 -->
  <template v-for="group in navGroups" :key="group.name">
    <SidebarGroup class="theme-brand">
      <SidebarGroupLabel>{{ group.name }}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem
            v-for="item in group.items"
            :key="item.id"
            :class="item.active ? 'rounded-md' : ''"
            :style="item.active ? activeBgStyle : undefined"
          >
            <span
              v-if="item.active"
              aria-hidden="true"
              class="absolute bottom-1.5 left-0 top-1.5 z-10 w-[3px] rounded-full"
              :style="stripeStyle"
            />
            <SidebarMenuButton as-child :tooltip="item.title" :class="[
              'hover:bg-primary/[0.08]',
              item.active ? 'font-medium text-primary' : '',
            ]">
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

/** 选中项左侧 3px 品牌竖条，与 dashboard 侧边栏一致。 */
const stripeStyle = { background: 'linear-gradient(180deg, #1EEDC4, #1E9EED, #090380)' }

/** 选中项淡渐变底，与 dashboard 侧边栏一致。 */
const activeBgStyle = {
  backgroundImage: 'linear-gradient(90deg, rgba(30,237,196,0.16), rgba(30,158,237,0.16) 60%, transparent)',
}

const navGroups = computed(() =>
  menuGroups.value.map(group => ({
    ...group,
    items: group.items.map(item => ({ ...item, active: isActive(item.path) })),
  })),
)
</script>
