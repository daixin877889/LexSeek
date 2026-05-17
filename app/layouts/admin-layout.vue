<template>
  <SidebarProvider class="theme-brand">
    <!-- 侧边栏 -->
    <Sidebar collapsible="icon">
      <!-- 顶部logo -->
      <SidebarHeader class="theme-brand">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" class="hover:bg-primary/[0.08]">
              <NuxtLink to="/admin" class="flex items-center gap-2">
                <BrandLogo size="md" />
                <div class="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                  <span class="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">管理后台</span>
                </div>
              </NuxtLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent data-sidebar-content>
        <!-- 菜单组 -->
        <AdminNavMain />
      </SidebarContent>
      <!-- 侧边栏底部 -->
      <SidebarFooter>
        <div class="p-4 group-data-[collapsible=icon]:p-2">
          <NuxtLink to="/dashboard"
            class="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-primary/[0.08] hover:text-primary group-data-[collapsible=icon]:justify-center">
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
import AdminBreadcrumb from '~/components/admin/Breadcrumb.vue'
import AdminNavMain from '~/components/admin/NavMain.vue'
import GeneralThemeToggle from '~/components/general/ThemeToggle.vue'
import BrandLogo from '~/components/general/BrandLogo.vue'
import { useApi } from '~/composables/useApi'
import { useAdminMenuStore } from '~/store/adminMenu'
import { usePermissionStore } from '~/store/permission'

// 私密区域，禁止搜索引擎索引
useHead({
  meta: [{ name: 'robots', content: 'noindex,nofollow' }]
})

const store = useAdminMenuStore()
const permissionStore = usePermissionStore()

// SSR: 并行获取菜单数据和权限数据
if (store.rawRouters.length === 0 || !permissionStore.initialized) {
  const [menuResult, permResult] = await Promise.all([
    store.rawRouters.length === 0
      ? useApi('/api/v1/admin/menu-routers', { key: 'admin-menu-routers' })
      : null,
    !permissionStore.initialized
      ? useApi('/api/v1/users/permissions', { key: 'admin-user-permissions' })
      : null,
  ])

  if (menuResult?.data?.value) {
    store.setRawRouters(menuResult.data.value)
  }

  if (permResult?.data?.value) {
    const permData = permResult.data.value
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
