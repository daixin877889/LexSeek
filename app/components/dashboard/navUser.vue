<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton size="lg"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
            <Avatar class="h-8 w-8 rounded-lg">
              <!-- <AvatarImage :src="user.avatar" :alt="user.name" /> -->
              <AvatarFallback class="rounded-lg"> LS </AvatarFallback>
            </Avatar>
            <div class="grid flex-1 text-left text-sm leading-tight">
              <span class="truncate font-semibold text-primary">{{ displayName }}</span>
              <span class="truncate text-xs">{{ maskedPhone }}</span>
            </div>
            <ChevronsUpDown class="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-[--reka-dropdown-menu-trigger-width] min-w-56 rounded-lg" side="right" align="end"
          :side-offset="4">
          <DropdownMenuLabel class="p-0 font-normal">
            <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <Avatar class="h-8 w-8 rounded-lg">
                <!-- <AvatarImage :src="user.avatar" :alt="userStore.userInfo?.name || '用户'" /> -->
                <AvatarFallback class="rounded-lg"> LS </AvatarFallback>
              </Avatar>
              <div class="grid flex-1 text-left text-sm leading-tight">
                <span class="truncate font-semibold">{{ displayName }}</span>
                <span class="truncate text-xs">{{ maskedPhone }}</span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <router-link v-for="route in [{ url: '/dashboard', title: '首页', icon: HomeIcon }]" :to="route.url"
              :key="route.title" class="mt-2 mb-2">
              <DropdownMenuItem>
                <component :is="route.icon" />
                {{ route.title }}
              </DropdownMenuItem>
            </router-link>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="handleLogout"
            class="text-red-500 data-highlighted:bg-red-50 data-highlighted:text-red-600 group cursor-pointer">
            <LogOut class="mr-2 h-4 w-4 group-hover:text-red-600" />
            <span class="group-hover:text-red-600">退出登录</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>

<script setup lang="ts">
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { ChevronsUpDown, LogOut, HomeIcon } from "lucide-vue-next";

// 使用共享的用户导航逻辑
const { displayName, maskedPhone, handleLogout } = useUserNavigation();


</script>
