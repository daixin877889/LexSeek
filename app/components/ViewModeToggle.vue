<template>
    <div class="flex items-center bg-muted/50 rounded-lg p-0.5">
        <button v-for="opt in OPTS" :key="opt.value"
            class="size-7 flex items-center justify-center rounded-md transition-all"
            :class="modelValue === opt.value ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'"
            @click="modelValue = opt.value">
            <component :is="opt.icon" class="size-3.5" />
        </button>
    </div>
</template>

<script lang="ts" setup>
import { LayoutGridIcon, ListIcon } from 'lucide-vue-next'

const OPTS = [
    { value: 'grid' as const, icon: LayoutGridIcon },
    { value: 'list' as const, icon: ListIcon },
]

const modelValue = defineModel<'grid' | 'list'>({ required: true })
</script>
