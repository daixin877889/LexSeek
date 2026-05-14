<template>
  <template v-for="(node, idx) in items" :key="`${node.kind}-${'id' in node ? node.id : ('path' in node ? node.path : idx)}`">
    <DropdownMenuLabel
      v-if="node.kind === 'group-header'"
      class="px-2 py-1.5 text-xs text-muted-foreground font-normal"
    >
      {{ node.title }}
    </DropdownMenuLabel>

    <!-- 路由项：as-child 把 menuitem 角色 + data-highlighted 行为透传给 NuxtLink -->
    <DropdownMenuItem
      v-else-if="node.kind === 'route'"
      as-child
      class="cursor-pointer"
    >
      <NuxtLink
        :to="node.path"
        active-class="bg-accent text-accent-foreground"
        exact-active-class="bg-accent text-accent-foreground font-medium"
      >
        <component :is="node.icon" class="mr-2 h-4 w-4" />
        {{ node.title }}
      </NuxtLink>
    </DropdownMenuItem>

    <DropdownMenuSeparator v-else-if="node.kind === 'separator'" />

    <DropdownMenuItem
      v-else-if="node.kind === 'action'"
      :class="[
        'cursor-pointer group',
        node.danger && 'text-red-500 data-highlighted:bg-red-50 data-highlighted:text-red-600',
      ]"
      @click="node.onClick"
    >
      <component :is="node.icon" :class="['mr-2 h-4 w-4', node.danger && 'group-hover:text-red-600']" />
      <span :class="[node.danger && 'group-hover:text-red-600']">{{ node.title }}</span>
    </DropdownMenuItem>
  </template>
</template>

<script setup lang="ts">
import type { UserMenuRenderNode } from '#shared/types/userMenu'

defineProps<{ items: UserMenuRenderNode[] }>()
</script>
