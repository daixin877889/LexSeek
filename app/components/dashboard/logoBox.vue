<template>
  <SidebarHeader>
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg">
          <NuxtLink to="/" class="flex items-center gap-2">
            <!-- logo 图标：浅色主题深灰背景，深色主题浅灰背景 -->
            <div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-zinc-900 dark:bg-zinc-100">
              <NuxtImg src="/logo-white.svg" class="size-6 dark:invert" />
            </div>
            <!-- 文字：浅色主题深灰，深色主题浅灰 -->
            <div class="grid flex-1 text-left text-sm leading-tight">
              <span class="truncate font-semibold text-zinc-900 dark:text-zinc-100 text-base"> LexSeek ｜ 法索 AI </span>
            </div>
          </NuxtLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  </SidebarHeader>
</template>

<script lang="ts" setup></script>

<style></style>
