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
    <SidebarInset class="h-screen overflow-hidden">
      <!-- 使用 flex 布局，header 固定高度，内容区域可滚动 -->
      <div class="flex h-full flex-col">
        <!-- 头部 - 固定在顶部 -->
        <header
          class="flex h-12 shrink-0 items-center justify-between gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 bg-background border-b z-50">
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

          <!-- 右侧操作区 -->
          <div class="ml-auto pr-4 flex items-center gap-2">
            <!-- 主题切换按钮 -->
            <ClientOnly>
              <GeneralThemeToggle />
              <template #fallback>
                <Button variant="ghost" size="icon" class="h-9 w-9">
                  <Sun class="h-5 w-5" />
                </Button>
              </template>
            </ClientOnly>

            <!-- 移动端菜单按钮 -->
            <button class="p-2 rounded-md hover:bg-muted transition-colors focus:outline-none md:hidden"
              @click="toggleSidebar">
              <MenuIcon class="h-6 w-6" />
            </button>

            <!-- 移动端用户导航 -->
            <div class="md:hidden">
              <ClientOnly>
                <DashboardNavUserRight />
                <template #fallback>
                  <div class="p-2">
                    <User class="h-6 w-6 text-muted-foreground" />
                  </div>
                </template>
              </ClientOnly>
            </div>
          </div>
        </header>

        <!-- 内容区域 - 可滚动 -->
        <div class="flex-1 overflow-y-auto">
          <div class="flex flex-col gap-4 p-0">
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
        </div>
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>

<script setup lang="ts">
import { MenuIcon, User, Sun } from "lucide-vue-next";
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
