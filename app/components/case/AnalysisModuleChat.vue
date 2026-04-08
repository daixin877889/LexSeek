<script lang="ts" setup>
/**
 * 模块对话悬浮窗组件
 *
 * 参考 CaseDetailXiaosuo.vue 的 UI 结构
 * 使用 AiChat 组件渲染对话
 * 支持拖拽移动和自由缩放
 */
import { XIcon, MaximizeIcon, MinimizeIcon } from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'
import type { ModuleChatInstance } from '~/composables/useModuleChatManager'

const props = defineProps<{
    caseId: number
    chatInstance: ModuleChatInstance
}>()

const isOpen = defineModel<boolean>({ default: false })

const isMobile = useMediaQuery('(max-width: 767px)')
const isFullscreen = ref(false)
const thinking = ref(true)

// 拖拽和缩放
const moduleChatZIndex = ref(40)
const { style: windowStyle, onDragStart, onEdgeDetect, onResizeStart, cursor, isInteracting, reset }
    = useDraggableResize({
        initialWidth: 380,
        initialHeight: 640,
        minWidth: 300,
        minHeight: 350,
        positionOffset: { x: -40, y: -40 },
        zIndex: moduleChatZIndex,
    })

// 合并 style（模板中直接绑定）
const containerStyle = computed(() => ({
    ...windowStyle.value,
    cursor: cursor.value,
}))

// 关闭时重置全屏和窗口位置
watch(isOpen, (open) => {
    if (!open) {
        isFullscreen.value = false
        reset()
    }
})

function handleSubmit(data: { text: string }) {
    if (data.text.trim()) {
        props.chatInstance.sendMessage(data.text, { thinking: thinking.value })
    }
}
</script>

<template>
    <!-- 桌面端 -->
    <template v-if="!isMobile">
        <!-- 全屏模式 -->
        <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0"
            enter-to-class="opacity-100" leave-active-class="transition duration-150 ease-in"
            leave-from-class="opacity-100" leave-to-class="opacity-0">
            <div v-if="isOpen && isFullscreen" class="fixed md:absolute inset-0 z-50 bg-background flex flex-col">
                <div class="shrink-0 h-12 flex items-center justify-between px-4 border-b bg-muted/30">
                    <div class="text-sm font-medium">{{ chatInstance.moduleTitle }}</div>
                    <div class="flex items-center gap-1">
                        <Button variant="ghost" size="icon" class="size-8" @click="isFullscreen = false">
                            <MinimizeIcon class="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" class="size-8" @click="isOpen = false">
                            <XIcon class="size-4" />
                        </Button>
                    </div>
                </div>
                <div class="flex-1 overflow-hidden">
                    <AiChat :messages="chatInstance.messages.value" :loading="chatInstance.isLoading.value"
                        panel-mode="left" :show-header="false" v-model:thinking="thinking" :enable-file-upload="false"
                        prompt-placeholder="输入消息优化分析结果..." @submit="handleSubmit"
                        @stop="chatInstance.stopGeneration()" />
                </div>
            </div>
        </Transition>

        <!-- 小窗模式（可拖拽、可缩放） -->
        <Transition enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0" enter-to-class="opacity-100"
            leave-active-class="transition duration-150 ease-in"
            leave-from-class="opacity-100" leave-to-class="opacity-0">
            <div v-if="isOpen && !isFullscreen"
                class="fixed bg-background border rounded-xl shadow-xl flex flex-col overflow-hidden"
                :class="{ 'select-none': isInteracting }"
                :style="containerStyle"
                @pointermove="onEdgeDetect"
                @pointerdown="onResizeStart">
                <div class="shrink-0 h-10 flex items-center justify-between px-3 border-b bg-muted/30
                            cursor-grab active:cursor-grabbing"
                    @pointerdown="onDragStart">
                    <div class="text-sm font-medium">{{ chatInstance.moduleTitle }}</div>
                    <div class="flex items-center gap-0.5">
                        <Button variant="ghost" size="icon" class="size-6" @click="isFullscreen = true">
                            <MaximizeIcon class="size-3" />
                        </Button>
                        <Button variant="ghost" size="icon" class="size-6" @click="isOpen = false">
                            <XIcon class="size-3.5" />
                        </Button>
                    </div>
                </div>
                <div class="flex-1 overflow-hidden">
                    <AiChat :messages="chatInstance.messages.value" :loading="chatInstance.isLoading.value"
                        panel-mode="left" :show-header="false" v-model:thinking="thinking" :enable-file-upload="false"
                        prompt-placeholder="输入消息优化分析结果..." @submit="handleSubmit"
                        @stop="chatInstance.stopGeneration()" />
                </div>
            </div>
        </Transition>
    </template>

    <!-- 移动端：底部 Sheet -->
    <Sheet v-else v-model:open="isOpen">
        <SheetContent side="bottom" class="h-[90vh] flex flex-col p-0">
            <SheetHeader class="shrink-0 px-4 pt-4 pb-2">
                <SheetTitle class="text-sm">{{ chatInstance.moduleTitle }}</SheetTitle>
            </SheetHeader>
            <div class="flex-1 overflow-hidden">
                <AiChat :messages="chatInstance.messages.value" :loading="chatInstance.isLoading.value"
                    panel-mode="left" :show-header="false" :show-thinking-toggle="false" :enable-file-upload="false"
                    prompt-placeholder="输入消息优化分析结果..." @submit="handleSubmit" @stop="chatInstance.stopGeneration()" />
            </div>
        </SheetContent>
    </Sheet>
</template>
