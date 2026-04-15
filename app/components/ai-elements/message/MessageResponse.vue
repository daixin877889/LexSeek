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

// ---- [file-card] 解析 ----

/** 文件卡片字段（解析后的结构化数据） */
interface FileCardData {
  fileId: string
  fileName: string
  fileSize: number
  mimeType: string
  temporary?: boolean
  expiresAt?: string
}

/** 消息内容片段：markdown 文本或文件卡片 */
type ContentSegment =
  | { type: 'markdown'; text: string }
  | { type: 'file-card'; data: FileCardData }

const FILE_CARD_RE = /\[file-card\]([\s\S]*?)\[\/file-card\]/g

/**
 * 从 [file-card] 块文本中解析字段
 *
 * 字段格式：每行 `key: value`，忽略空行
 * 返回 null 表示缺少必要字段（fileId / fileName），应保留原文
 */
function parseFileCardBlock(block: string): FileCardData | null {
  const fields: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    if (key && value) fields[key] = value
  }

  if (!fields.fileId || !fields.fileName) return null

  return {
    fileId: fields.fileId,
    fileName: fields.fileName,
    fileSize: Number(fields.fileSize ?? 0),
    mimeType: fields.mimeType ?? 'application/octet-stream',
    temporary: fields.temporary === 'true',
    expiresAt: fields.expiresAt,
  }
}

/**
 * 将原始消息内容解析为片段数组
 *
 * 有效的 [file-card] 块替换为 file-card 片段；
 * 解析失败（缺少必要字段）则退化为 markdown 文本原样输出。
 */
const segments = computed<ContentSegment[]>(() => {
  const content = rawContent.value
  if (!content.includes('[file-card]')) {
    return [{ type: 'markdown', text: content }]
  }

  const result: ContentSegment[] = []
  let lastIndex = 0

  for (const match of content.matchAll(FILE_CARD_RE)) {
    const matchStart = match.index!
    const matchEnd = matchStart + match[0].length
    const blockContent = match[1]!

    // 标记前的 markdown 片段
    if (matchStart > lastIndex) {
      const text = content.slice(lastIndex, matchStart)
      if (text) result.push({ type: 'markdown', text })
    }

    const data = parseFileCardBlock(blockContent)
    if (data) {
      result.push({ type: 'file-card', data })
    } else {
      // 解析失败，保留原文
      result.push({ type: 'markdown', text: match[0] })
    }

    lastIndex = matchEnd
  }

  // 剩余 markdown 片段
  if (lastIndex < content.length) {
    result.push({ type: 'markdown', text: content.slice(lastIndex) })
  }

  return result
})

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
