<template>
  <SidebarHeader>
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg">
          <NuxtLink to="/" class="flex items-center gap-2">
            <BrandLogo size="md" />
            <div class="grid flex-1 text-left text-sm leading-tight">
              <span class="truncate font-semibold text-zinc-900 dark:text-zinc-100 text-base"> LexSeek ｜ 法索 AI </span>
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
