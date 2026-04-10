<script lang="ts" setup>
/**
 * 模块对话最小化状态条
 *
 * 显示在右下角，每个正在分析或有活跃对话的模块显示为一个小状态条
 * 点击展开对应模块的对话窗口
 */
import { Loader2Icon, CheckCircleIcon } from 'lucide-vue-next'
import type { ModuleChatInstance } from '~/composables/useModuleChatManager'

defineProps<{
    modules: ModuleChatInstance[]
}>()

const emit = defineEmits<{
    expand: [moduleName: string]
}>()
</script>

<template>
    <!-- 定位在小索悬浮按钮（bottom-4 size-12 ≈ 64px）上方，避免重叠 -->
    <div v-if="modules.length > 0" class="fixed bottom-20 right-4 z-50 flex flex-col gap-1 items-end">
        <button v-for="mod in modules" :key="mod.moduleName"
            class="flex items-center gap-2 px-3 py-1.5 bg-background border rounded-full shadow-sm hover:shadow-md transition-shadow text-xs"
            @click="emit('expand', mod.moduleName)">
            <Loader2Icon v-if="mod.isLoading.value" class="size-3 animate-spin" />
            <CheckCircleIcon v-else class="size-3 text-green-500" />
            <span>{{ mod.moduleTitle }}</span>
        </button>
    </div>
</template>
