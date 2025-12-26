<template>
  <SidebarProvider>
    <!-- 侧边栏 -->
    <Sidebar collapsible="icon">
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
      <header
        class="flex h-12 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 fixed bg-white w-full z-50 shadow-sm">
        <div class="flex gap-2 px-4">
          <!-- logo -->
          <div class="flex items-center gap-2 md:hidden">
            <NuxtLink to="/dashboard" class="flex items-center gap-2">
              <img src="/logo.svg" class="h-6 text-primary" />
              <h1 class="text-xl font-bold">LexSeek｜法索 AI</h1>
            </NuxtLink>
          </div>

          <!-- 折叠按钮 -->
          <SidebarTrigger ref="sidebarTriggerRef" class="-ml-1 hidden md:flex" />

          <!-- 面包屑导航 -->
          <DashboardBreadcrumbNav class="hidden md:flex" />
        </div>

        <!-- 移动端用户导航 -->
        <div class="ml-auto pr-4 flex items-center md:hidden">
          <button class="p-2 rounded-md hover:bg-gray-100 transition-colors focus:outline-none focus:ring-offset-2"
            @click="toggleSidebar">
            <MenuIcon class="h-6 w-6" />
          </button>
          <ClientOnly>
            <DashboardNavUserRight />
            <template #fallback>
              <div class="p-2">
                <User class="h-6 w-6 text-gray-400" />
              </div>
            </template>
          </ClientOnly>
        </div>
      </header>
      <!-- 内容区域 -->

      <div class="flex flex-1 flex-col gap-4 p-0 mt-12">
        <!-- 嵌套布局：根据路由选择不同布局 -->
        <div v-if="$route.path.startsWith('/dashboard/settings')">
          <SettingsLayout>
            <slot />
          </SettingsLayout>
        </div>
        <div v-else-if="$route.path.startsWith('/dashboard/membership')">
          <MembershipLayout>
            <slot />
          </MembershipLayout>
        </div>
        <div v-else>
          <slot />
        </div>
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>

<script setup lang="ts">
import { MenuIcon, User } from "lucide-vue-next";
import SettingsLayout from "./settingsLayout.vue";
import MembershipLayout from "./membershipLayout.vue";

const sidebarTriggerRef = ref<InstanceType<typeof import("@/components/ui/sidebar").SidebarTrigger> | null>(null);

// 通过组件实例的 $el 获取 DOM 元素并点击
const toggleSidebar = () => {
  const el = sidebarTriggerRef.value?.$el;
  if (el) {
    el.click();
  }
};
</script>
