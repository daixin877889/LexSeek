<script lang="ts" setup>
/**
 * 中断处理调度器（阶段 7）
 *
 * 用法（统一接口，6 个调用方共用）：
 *   <InterruptDispatcher
 *     :interrupt="interruptData"
 *     :is-submitting="false"
 *     @submit="handleSubmit"
 *     @cancel="handleCancel"
 *   />
 *
 * 内部工作：
 * - 按 interruptData.type 查 globalInterruptRegistry 选中处理器组件
 * - 工具卡（isToolCard=true：TemplateSelectCard / StanceSelectCard）用 :interrupt :on-resolve 协议，
 *   onResolve(value) 适配为 emit('submit', value)
 * - 中断卡（isToolCard=false：CaseInfoCheckHandler 等）用 :interrupt :is-submitting @submit @cancel 协议
 *
 * 未注册的 interrupt.type 会渲染兜底文本以便排查（不抛错）。
 */
import type { Component } from 'vue'
import { globalInterruptRegistry } from '~/composables/agent-platform/interruptRegistry'

const props = defineProps<{
    /** 中断数据，必含 type 字段；type 用于查注册表 */
    interrupt: { type?: string;[key: string]: unknown } | null
    isSubmitting?: boolean
}>()

const emit = defineEmits<{
    submit: [value: unknown]
    cancel: []
}>()

const interruptType = computed<string>(() => {
    const t = props.interrupt?.type
    return typeof t === 'string' ? t : ''
})

const HandlerComponent = computed<Component | undefined>(() => {
    if (!interruptType.value) return undefined
    return globalInterruptRegistry.getComponent(interruptType.value)
})

const isToolCard = computed(() => {
    if (!interruptType.value) return false
    return globalInterruptRegistry.isToolCard(interruptType.value)
})

// 工具卡的 onResolve callback：适配为 @submit；null 视为取消（旧合同/文书工具卡协议）
function handleResolve(value: unknown) {
    if (value === null || value === undefined) {
        emit('cancel')
    } else {
        emit('submit', value)
    }
}

function handleSubmit(value: unknown) {
    emit('submit', value)
}

function handleCancel() {
    emit('cancel')
}
</script>

<template>
    <div v-if="!interrupt">
        <!-- 无中断数据：调用方应在 v-if 里控制不渲染本组件，但保留空态防御 -->
    </div>
    <div v-else-if="!HandlerComponent" class="p-4 text-sm text-muted-foreground">
        未注册的中断类型：{{ interruptType || '<empty>' }}
    </div>
    <component
        :is="HandlerComponent"
        v-else-if="isToolCard"
        :interrupt="interrupt"
        :on-resolve="handleResolve"
    />
    <component
        :is="HandlerComponent"
        v-else
        :interrupt="interrupt"
        :is-submitting="isSubmitting"
        @submit="handleSubmit"
        @cancel="handleCancel"
    />
</template>
