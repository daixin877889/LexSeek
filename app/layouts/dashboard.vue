<template>
  <SidebarProvider>
    <AppSidebar :dashboardRouters="dashboardRouters" />
    <SidebarInset class="overflow-x-hidden">
      <header
        class="flex h-12 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 fixed bg-white w-full z-50 shadow-sm">
        <div class="flex items-center gap-2 px-4">
          <!-- logo -->
          <div class="flex items-center gap-2 md:hidden">
            <router-link to="/dashboard" class="flex items-center gap-2">
              <!-- <ScaleIcon class="h-6 w-6 text-primary" /> -->
              <img src="/logo.svg" class="h-6 text-primary" />
              <h1 class="text-xl font-bold">LexSeek｜法索 AI</h1>
            </router-link>
          </div>

          <SidebarTrigger ref="sidebarTriggerRef" class="-ml-1 hidden md:flex" />
          <BreadcrumbNav class="hidden md:flex" />
        </div>

        <div class="ml-auto pr-4 flex items-center md:hidden">
          <button class="p-2 rounded-md hover:bg-gray-100 transition-colors focus:outline-none focus:ring-offset-2"
            @click="toggleSidebar">
            <MenuIcon class="h-6 w-6" />
          </button>
          <NavUserRight :userRoutes="userRoutes" />
        </div>
      </header>
      <div class="flex flex-1 flex-col gap-4 p-0 pt-12 group-has-data-[collapsible=icon]/sidebar-wrapper:pt-12">
        <slot />
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>

<script lang="ts" setup>
import { ref } from 'vue'

const dashboardRouters = ref([]);
const userRoutes = ref([]);
const sidebarTriggerRef = ref(null);
// 模拟点击侧边栏触发器
const toggleSidebar = () => {
  // 查找并点击页面中已存在的侧边栏触发器按钮
  const triggerButton = document.querySelector('button[data-sidebar="trigger"]');
  if (triggerButton) {
    (triggerButton as HTMLElement).click();
  }
};
</script>

<style></style>
