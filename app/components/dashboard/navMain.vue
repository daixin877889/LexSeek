<template>
  <SidebarGroup>
    <SidebarGroupContent>
      <SidebarMenu>
        <template v-for="item in menuItems" :key="item.title">
          <SidebarMenuItem
            :class="item.active ? 'rounded-md' : ''"
            :style="item.active ? activeBgStyle : undefined"
          >
            <span
              v-if="item.active"
              aria-hidden="true"
              class="absolute left-0 top-1.5 bottom-1.5 z-10 w-[3px] rounded-full"
              :style="stripeStyle"
            />
            <SidebarMenuButton as-child :tooltip="item.title" :class="[
              'p-4 pt-5 pb-5 text-base',
              item.active ? 'font-medium text-primary' : ''
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
import { useRoleStore } from '~/store/role'
import lucideIcons from '~/utils/lucideIcons'
const roleStore = useRoleStore();
const route = useRoute();

/** 选中项左侧 3px 品牌竖条 */
const stripeStyle = { background: 'linear-gradient(180deg, #1EEDC4, #1E9EED, #090380)' }
/** 选中项淡渐变底（青/蓝低透明 → 透明） */
const activeBgStyle = {
  backgroundImage: 'linear-gradient(90deg, rgba(30,237,196,0.16), rgba(30,158,237,0.16) 60%, transparent)',
}

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

/** 主菜单项 + 预标注激活态（避免模板里反复 filter 与多次调用 isActive） */
const menuItems = computed(() =>
  roleStore.currentRoleRouters
    .filter((item: any) => item.isMenu && item.groupId === 1)
    .map((item: any) => ({ ...item, active: isActive(item.path) })),
)

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
