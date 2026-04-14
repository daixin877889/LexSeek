<script lang="ts" setup>
/**
 * 模块对话最小化状态条
 *
 * 显示在右下角（小索悬浮按钮上方），每个活跃模块显示为一个小状态条
 * 点击标签展开对应模块的对话窗口，点击关闭按钮隐藏标签（不中断底层 chat）
 */
import { Loader2Icon, CheckCircleIcon, XIcon } from 'lucide-vue-next'
import type { ModuleChatInstance } from '~/composables/useModuleChatManager'

defineProps<{
    modules: ModuleChatInstance[]
}>()

const emit = defineEmits<{
    expand: [moduleName: string]
    close: [moduleName: string]
}>()

function handleClose(moduleName: string, e: Event) {
    e.stopPropagation()
    emit('close', moduleName)
}
</script>

<template>
    <!-- 定位在小索悬浮按钮（bottom-4 size-12 ≈ 64px）上方，避免重叠 -->
    <div v-if="modules.length > 0" class="fixed bottom-36 md:bottom-20 right-4 z-[60] flex flex-col gap-1 items-end">
        <div v-for="mod in modules" :key="mod.moduleName"
            class="group flex items-center gap-1 pl-3 pr-1 py-1 bg-background border rounded-full shadow-sm hover:shadow-md transition-shadow text-xs">
            <button class="flex items-center gap-2 cursor-pointer" @click="emit('expand', mod.moduleName)">
                <Loader2Icon v-if="mod.isLoading.value" class="size-3 animate-spin" />
                <CheckCircleIcon v-else class="size-3 text-green-500" />
                <span>{{ mod.moduleTitle }}</span>
            </button>
            <button
                class="size-5 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                aria-label="关闭标签"
                @click="handleClose(mod.moduleName, $event)">
                <XIcon class="size-3" />
            </button>
        </div>
    </div>
</template>
