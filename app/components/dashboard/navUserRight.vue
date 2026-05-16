<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button class="p-2 rounded-md hover:bg-muted transition-colors focus:outline-none">
        <User class="h-6 w-6" />
      </button>
    </DropdownMenuTrigger>

    <DropdownMenuContent
      class="min-w-56 rounded-lg"
      side="bottom"
      align="end"
      :side-offset="8"
    >
      <DropdownMenuLabel class="p-0 font-normal">
        <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
          <Avatar class="h-8 w-8 rounded-lg">
            <AvatarFallback class="rounded-lg bg-gradient-brand text-white font-semibold">LS</AvatarFallback>
          </Avatar>
          <div class="grid flex-1 text-left text-sm leading-tight">
            <span class="truncate font-semibold">{{ displayName }}</span>
            <span class="truncate text-xs">{{ maskedPhone }}</span>
          </div>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />

      <UserMenuList :items="items" />
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { User } from 'lucide-vue-next'
import UserMenuList from '~/components/dashboard/UserMenuList.vue'
import { useUserNavigation } from '~/composables/useUserNavigation'
import { useUserMenu } from '~/composables/useUserMenu'

const { displayName, maskedPhone } = useUserNavigation()
const { items } = useUserMenu()
</script>
