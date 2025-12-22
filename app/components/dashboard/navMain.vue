<template>
  <SidebarGroup>
    <SidebarGroupContent>
      <SidebarMenu>
        <template v-for="item in roleStore.currentRoleRouters.filter((item: any) => item.isMenu)" :key="item.title">
          <SidebarMenuItem @click="activeMenu = item.path" :class="item.path === activeMenu ? 'bg-primary/10 rounded-md' : ''">
            <SidebarMenuButton as-child :tooltip="item.title" class="p-4 pt-5 pb-5 text-primary text-base">
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
const activeMenu = ref("");

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
