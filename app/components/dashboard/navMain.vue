<template>
  <SidebarGroup>
    <SidebarGroupContent>
      <SidebarMenu>
        <template v-for="item in roleStore.currentRoleRouters.filter((item: any) => item.isMenu && item.groupId === 1)" :key="item.title">
          <SidebarMenuItem :class="isActive(item.path) ? 'bg-primary/10 rounded-md' : ''">
            <SidebarMenuButton as-child :tooltip="item.title" :class="[
              'p-4 pt-5 pb-5 text-base',
              isActive(item.path) ? 'text-primary' : ''
            ]">
              <NuxtLink :to="item.path">
                <component v-if="item.icon" :is="getIcon(item.icon)" />
                <span>{{ item.title }}</span>
              </NuxtLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </template>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
</template>
<script setup lang="ts">
const roleStore = useRoleStore();
const route = useRoute();

/** 判断菜单是否激活（精确匹配或子路由匹配） */
const isActive = (path: string) => {
  // 精确匹配当前路径
  if (route.path === path) return true
  // 子路由匹配：当前路径以 path/ 开头
  if (route.path.startsWith(path + '/')) {
    // 检查是否有更精确的菜单项匹配当前路径
    const allPaths = roleStore.currentRoleRouters
      .filter((item: any) => item.isMenu)
      .map((item: any) => item.path)
    const hasMoreSpecificMatch = allPaths.some((p: string) => p !== path && route.path.startsWith(p))
    return !hasMoreSpecificMatch
  }
  return false
}

const getIcon = (iconName: string): Component | undefined => {
  if (!iconName) return undefined;
  // 如果格式是 "lucideIcons.LayoutDashboardIcon"
  if (iconName.startsWith("lucideIcons.")) {
    const name = iconName.replace("lucideIcons.", "");
    return lucideIcons[name as keyof typeof lucideIcons] as Component;
  }
  // 如果只是图标名称 "LayoutDashboardIcon"
  return lucideIcons[iconName as keyof typeof lucideIcons] as Component;
};
</script>
