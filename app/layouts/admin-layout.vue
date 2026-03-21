<template>
  <SidebarProvider>
    <!-- 侧边栏 -->
    <Sidebar collapsible="icon">
      <!-- 顶部logo -->
      <SidebarHeader class="border-b">
        <div
          class="flex items-center py-3 px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <NuxtLink to="/admin" class="flex items-center gap-2">
            <img src="/logo.svg" alt="Logo" class="h-6 w-6 dark:invert" />
            <span class="font-semibold text-lg group-data-[collapsible=icon]:hidden">管理后台</span>
          </NuxtLink>
        </div>
      </SidebarHeader>
      <SidebarContent data-sidebar-content>
        <!-- 菜单组 -->
        <AdminNavMain />
      </SidebarContent>
      <!-- 侧边栏底部 -->
      <SidebarFooter>
        <div class="p-4 group-data-[collapsible=icon]:p-2">
          <NuxtLink to="/dashboard" class="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
            <ArrowLeft class="h-4 w-4" />
            <span class="group-data-[collapsible=icon]:hidden">返回主站</span>
          </NuxtLink>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
    <SidebarInset class="h-screen overflow-hidden">
      <div class="flex h-full flex-col">
        <!-- 头部 -->
        <header class="flex h-12 shrink-0 items-center justify-between gap-2 bg-background border-b">
          <div class="flex items-center gap-2 px-4">
            <SidebarTrigger class="-ml-1" />
            <Separator orientation="vertical" class="mr-2 h-4" />
            <AdminBreadcrumb />
          </div>
          <div class="ml-auto pr-4 flex items-center gap-2">
            <ClientOnly>
              <GeneralThemeToggle />
            </ClientOnly>
          </div>
        </header>
        <!-- 内容区域 -->
        <div class="flex-1 overflow-y-auto">
          <div class="p-6">
            <slot />
          </div>
        </div>
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>

<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'

const store = useAdminMenuStore()
const permissionStore = usePermissionStore()

// SSR: 并行获取菜单数据和权限数据（useFetch 自动转发 cookie）
if (store.rawRouters.length === 0 || !permissionStore.initialized) {
  const [menuResult, permResult] = await Promise.all([
    store.rawRouters.length === 0
      ? useFetch<any>('/api/v1/admin/menu-routers', { key: 'admin-menu-routers' })
      : Promise.resolve(null),
    !permissionStore.initialized
      ? useFetch<any>('/api/v1/users/permissions', { key: 'admin-user-permissions' })
      : Promise.resolve(null),
  ])

  if (menuResult?.data?.value?.success && menuResult.data.value.data) {
    store.setRawRouters(menuResult.data.value.data)
  }

  if (permResult?.data?.value?.success && permResult.data.value.data) {
    const permData = permResult.data.value.data
    permissionStore.apiPermissions = permData.apiPermissions
    permissionStore.routePermissions = permData.routePermissions
    permissionStore.isSuperAdmin = permData.isSuperAdmin
    permissionStore.initialized = true
  }
}

// 客户端: 恢复和监听滚动位置（仅浏览器有 DOM）
onMounted(() => {
  const contentEl = document.querySelector('[data-sidebar-content]') as HTMLElement
  if (contentEl) {
    if (store.scrollPosition > 0) {
      contentEl.scrollTop = store.scrollPosition
    }
    const handleScroll = () => {
      store.setScrollPosition(contentEl.scrollTop)
    }
    contentEl.addEventListener('scroll', handleScroll, { passive: true })
    onUnmounted(() => contentEl.removeEventListener('scroll', handleScroll))
  }
})
</script>
