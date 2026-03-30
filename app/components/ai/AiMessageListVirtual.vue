<script setup lang="ts">
/**
 * 虚拟滚动消息列表（内部组件）
 *
 * 必须放在 AiElementsConversation（StickToBottom）内部，
 * 通过 useStickToBottomContext 获取滚动容器 ref 传给 useVirtualizer。
 *
 * StickToBottom 通过 ResizeObserver 监听 contentElement 高度变化自动滚底，
 * 虚拟化器的 getTotalSize spacer 高度变化会触发 ResizeObserver，两者天然兼容。
 */
import type { Component } from 'vue'
import type { ParsedMessage } from './composables/useMessageParser'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useStickToBottomContext } from 'vue-stick-to-bottom'

interface Props {
  messages: ParsedMessage[]
  loading?: boolean
  toolMap?: Record<string, Component>
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
})

const emit = defineEmits<{
  (e: 'tool-confirm', data: { toolCallId: string; data: any }): void
  (e: 'tool-reject', data: { toolCallId: string }): void
}>()

const { scrollRef } = useStickToBottomContext()

const virtualizer = useVirtualizer(computed(() => ({
  count: props.messages.length,
  getScrollElement: () => scrollRef.value ?? null,
  estimateSize: () => 120,
  overscan: 10,
})))
</script>

<template>
  <div
    :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }"
  >
    <div
      v-for="virtualRow in virtualizer.getVirtualItems()"
      :key="String(virtualRow.key)"
      :ref="(el) => virtualizer.measureElement(el as Element)"
      :data-index="virtualRow.index"
      :style="{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        transform: `translateY(${virtualRow.start}px)`,
      }"
      class="px-8 pb-6"
    >
      <AiMessageListVirtualItem
        v-if="messages[virtualRow.index]"
        :msg="messages[virtualRow.index]!"
        :is-last="virtualRow.index === messages.length - 1"
        :loading="loading"
        :tool-map="toolMap"
        @tool-confirm="(d) => emit('tool-confirm', d)"
        @tool-reject="(d) => emit('tool-reject', d)"
      />
    </div>
  </div>
</template>
