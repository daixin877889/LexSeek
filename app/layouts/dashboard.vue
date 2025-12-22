<template>
  <SidebarProvider>
    <!-- 侧边栏 -->
    <Sidebar>
      <!-- 顶部logo -->
      <DashboardLogoBox />
      <SidebarContent>
        <!-- 菜单组 -->
        <DashboardNavMain />
      </SidebarContent>
      <!-- 侧边栏底部 -->
      <SidebarFooter>
        <!-- 用户导航栏 -->
        <DashboardNavUser class="hidden md:block" />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
    <SidebarInset>
      <!-- 头部 -->
      <header class="flex h-12 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 fixed bg-white w-full z-500 shadow-sm">
        <!-- 折叠按钮 -->
        <div class="flex items-center gap-2 px-4">
          <SidebarTrigger class="-ml-1" />
          <!-- 面包屑导航 -->
          <DashboardBreadcrumbNav class="hidden md:flex" />
        </div>
      </header>
      <!-- 内容区域 -->
      <div class="flex flex-1 flex-col gap-4 p-0 mt-12">
        <slot />
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>

<script setup lang="ts">
import type { Component } from "vue";

const activeMenu = ref("");
const route = useRoute();
const roleStore = useRoleStore();

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
