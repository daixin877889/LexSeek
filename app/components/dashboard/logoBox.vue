<template>
  <!-- theme-brand：移动端侧边栏 Sheet 会 portal 出布局的 theme-brand 作用域，这里自带一份 -->
  <SidebarHeader class="theme-brand">
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" class="hover:bg-primary/[0.08]">
          <NuxtLink to="/" class="flex items-center gap-2">
            <BrandLogo size="md" />
            <div class="grid flex-1 text-left text-sm leading-tight">
              <span class="truncate font-semibold text-zinc-900 dark:text-zinc-100 text-base"> 法索 AI ｜ LexSeek</span>
            </div>
          </NuxtLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  </SidebarHeader>
</template>

<script lang="ts" setup>
import BrandLogo from '~/components/general/BrandLogo.vue'
</script>

<style></style>
