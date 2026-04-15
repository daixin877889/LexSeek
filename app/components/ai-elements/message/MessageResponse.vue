<script setup lang="ts">
/**
 * AI 消息响应渲染组件
 *
 * 在 Markdown 渲染前先解析 [file-card] 标记，将消息内容拆分为
 * markdown 片段与文件卡片的交替序列，然后分别渲染。
 */
import type { HTMLAttributes } from 'vue'
import { cn } from '@repo/shadcn-vue/lib/utils'
import { Markdown } from 'vue-stream-markdown'
import 'vue-stream-markdown/index.css'
import { parseMessageSegments } from '~/utils/fileCardParser'

interface Props {
  content?: string
  class?: HTMLAttributes['class']
  mode?: 'streaming' | 'static'
}

const props = defineProps<Props>()

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

const segments = computed(() => parseMessageSegments(rawContent.value))

/** 流式模式下，最后一个 markdown 片段使用 streaming 模式，其余用 static */
function segmentMode(index: number): 'streaming' | 'static' {
  if (props.mode !== 'streaming') return 'static'
  // 找到最后一个 markdown 片段的索引
  let lastMarkdownIdx = -1
  for (let i = segments.value.length - 1; i >= 0; i--) {
    if (segments.value[i]!.type === 'markdown') {
      lastMarkdownIdx = i
      break
    }
  }
  return index === lastMarkdownIdx ? 'streaming' : 'static'
}
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
    <template v-for="(seg, idx) in segments" :key="idx">
      <!-- Markdown 片段 -->
      <Markdown
        v-if="seg.type === 'markdown'"
        :content="seg.text"
        :mode="segmentMode(idx)"
        class="size-full [&>*:first-child]:mt-0! [&>*:last-child]:mb-0!"
      />

      <!-- 文件卡片 -->
      <AiFileCard
        v-else-if="seg.type === 'file-card'"
        :file-id="seg.data.fileId"
        :file-name="seg.data.fileName"
        :file-size="seg.data.fileSize"
        :mime-type="seg.data.mimeType"
        :temporary="seg.data.temporary"
        :expires-at="seg.data.expiresAt"
      />
    </template>
  </div>
</template>
