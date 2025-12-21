<template>
  <SidebarProvider>
    <!-- 侧边栏 -->
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg">
              <div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <NuxtImg src="/logo-white.svg" class="size-6" />
              </div>
              <div class="grid flex-1 text-left text-sm leading-tight">
                <span class="truncate font-semibold text-primary text-base"> LexSeek ｜ 法索 AI </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <!-- 菜单组 -->
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <template v-for="item in dashboardMenu" :key="item.title">
                <SidebarMenuItem @click="activeMenu = item.path" :class="item.path === activeMenu ? 'bg-primary/10 rounded-md' : ''">
                  <SidebarMenuButton as-child :tooltip="item.title" class="p-4 pt-5 pb-5 text-primary text-base">
                    <NuxtLink :to="item.path">
                      <component :is="item.icon" />
                      <span>{{ item.title }}</span>
                    </NuxtLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </template>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <!-- 侧边栏底部 -->
      <SidebarFooter>
        <!-- <NavUser class="hidden md:block" /> -->
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
    <SidebarInset>
      <!-- 头部 -->
      <header class="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div class="flex items-center gap-2 px-4">
          <SidebarTrigger class="-ml-1" />
        </div>
      </header>
      <!-- 内容区域 -->
      <div class="flex flex-1 flex-col gap-4 p-0">
        <slot />
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>
<script setup lang="ts">
const activeMenu = ref("");
const route = useRoute();

onMounted(() => {
  // 初始化激活菜单
  activeMenu.value = dashboardMenu.value.find((item) => item.path === route.path)?.path ?? "";
});

const dashboardMenu = ref([
  {
    path: "/dashboard",
    title: "工作台",
    icon: lucideIcons.LayoutDashboardIcon,
  },
  {
    path: "/dashboard/cases",
    title: "我的案件",
    icon: lucideIcons.FolderIcon,
  },
]);
</script>
