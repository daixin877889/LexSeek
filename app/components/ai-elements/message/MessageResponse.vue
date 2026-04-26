<script setup lang="ts">
/**
 * AI 消息响应渲染组件
 *
 * 渲染消息正文为 Markdown。文件卡片由 AiToolsUploadWorkspaceFileTool
 * 直接从工具调用结果渲染（不依赖 LLM 在文本中嵌入 `[file-card]` 标记）。
 * 历史消息中可能残留的 `[file-card]` 文本会被剥离，避免 markdown 渲染异常。
 */
import type { HTMLAttributes } from 'vue'
import { cn } from '@repo/shadcn-vue/lib/utils'
import { Markdown } from 'vue-stream-markdown'
import 'vue-stream-markdown/index.css'
import { useMermaidHdPng } from '~/composables/useMermaidHdPng'
import type { nodes } from '~~/generated/prisma/client'

interface Props {
  content?: string
  class?: HTMLAttributes['class']
  mode?: 'streaming' | 'static'
}

const props = defineProps<Props>()

// 拦截 mermaid 下拉里 PNG 那一项，改走高清导出（带 viewBox → 像素 + DPR × scale 的修复）
// SVG / MMD 继续走 vue-stream-markdown 原生逻辑
const { markdownControls } = useMermaidHdPng()

const slots = useSlots()
const slotContent = computed<string | undefined>(() => {
  const nodes = slots.default?.()
  if (!Array.isArray(nodes)) return undefined
  let text = ''
  for (const node of nodes) {
    if (typeof node.children === 'string') text += node.children
  }
  return text || undefined
})

const rawContent = computed(() => (slotContent.value ?? props.content ?? '') as string)

/**
 * 剥离消息文本中的 [file-card]...[/file-card] 块
 *
 * 文件卡片由工具调用渲染器（AiToolsUploadWorkspaceFileTool）负责渲染，
 * 文本中的 [file-card] 标记是冗余且在 LLM 缩写格式下会破坏 markdown 渲染。
 * 流式输出过程中如果还没收到闭合标签，本次渲染会保留原样，下次更新时再剥离。
 */
const cleanedContent = computed(() =>
  rawContent.value.replace(/\[file-card\][\s\S]*?\[\/file-card\]/g, '').trim(),
)
</script>

<template>
  <div
    :class="
      cn(
        'size-full [&>*:first-child]:mt-0! [&>*:last-child]:mb-0!',
        props.class,
      )
    "
    v-bind="$attrs"
  >
    <Markdown
      :content="cleanedContent"
      :mode="props.mode === 'streaming' ? 'streaming' : 'static'"
      :controls="markdownControls"
      class="size-full [&>*:first-child]:mt-0! [&>*:last-child]:mb-0!"
    />
  </div>
</template>
