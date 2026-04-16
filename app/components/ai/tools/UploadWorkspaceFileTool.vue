<script setup lang="ts">
/**
 * upload_workspace_file 工具调用渲染器
 *
 * 直接把工具调用渲染为"文件卡片 / 错误条 / 上传中条"三种形态之一，
 * 不再套用通用的工具折叠面板（`AiElementsTool`），避免交付物被折叠
 * 层级淹没导致用户忽略。
 *
 * 工具输出保持 `[file-card]\nkey: value\n[/file-card]` 文本格式（与
 * 后端 `uploadWorkspaceFile.tool.ts` 的 `formatFileCard` 一致），这里
 * 解析成结构化数据传给 `AiFileCard`；输出为 `Error: ...` 时走错误分支。
 */
import { AlertCircleIcon, Loader2Icon } from 'lucide-vue-next'
import type { ExtendedToolState } from '@/components/ai-elements/types'

const props = defineProps<{
  toolName: string
  input?: {
    fileName?: string
  }
  output?: unknown
  state: ExtendedToolState
}>()

interface FileCardData {
  fileId: string
  fileName: string
  fileSize: number
  mimeType: string
  temporary: boolean
  expiresAt?: string
}

interface ParsedOutput {
  card: FileCardData | null
  errorText: string | null
}

/** 解析工具输出文本 */
function parseOutput(output: unknown): ParsedOutput {
  if (typeof output !== 'string' || !output) {
    return { card: null, errorText: null }
  }
  if (output.startsWith('Error')) {
    return { card: null, errorText: output }
  }

  const match = /\[file-card\]([\s\S]*?)\[\/file-card\]/.exec(output)
  if (!match) return { card: null, errorText: null }

  const fields: Record<string, string> = {}
  for (const rawLine of match[1]!.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const sepIdx = line.indexOf(':')
    if (sepIdx === -1) continue
    const key = line.slice(0, sepIdx).trim()
    const value = line.slice(sepIdx + 1).trim()
    if (key && value) fields[key] = value
  }

  if (!fields.fileId || !fields.fileName) return { card: null, errorText: null }

  return {
    card: {
      fileId: fields.fileId,
      fileName: fields.fileName,
      fileSize: Number(fields.fileSize ?? 0) || 0,
      mimeType: fields.mimeType ?? 'application/octet-stream',
      temporary: fields.temporary === 'true',
      expiresAt: fields.expiresAt,
    },
    errorText: null,
  }
}

const parsed = computed(() => parseOutput(props.output))

/** 上传中显示的文件名占位 */
const pendingFileName = computed(() => props.input?.fileName || '文件')
</script>

<template>
  <!-- 成功：直接渲染文件卡片（不再套工具折叠面板） -->
  <AiFileCard
    v-if="parsed.card"
    :file-id="parsed.card.fileId"
    :file-name="parsed.card.fileName"
    :file-size="parsed.card.fileSize"
    :mime-type="parsed.card.mimeType"
    :temporary="parsed.card.temporary"
    :expires-at="parsed.card.expiresAt"
  />

  <!-- 失败：简洁错误条，视觉体量与文件卡片一致 -->
  <div
    v-else-if="parsed.errorText"
    class="my-2 inline-flex w-full max-w-sm items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive shadow-sm"
  >
    <AlertCircleIcon class="mt-0.5 size-4 shrink-0" />
    <span class="min-w-0 flex-1 break-words">{{ parsed.errorText }}</span>
  </div>

  <!-- 进行中：上传中条 -->
  <div
    v-else-if="props.state === 'input-available'"
    class="my-2 inline-flex w-full max-w-sm items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm"
  >
    <Loader2Icon class="size-4 shrink-0 animate-spin" />
    <span class="min-w-0 flex-1 truncate">正在上传 {{ pendingFileName }} 到云盘…</span>
  </div>
</template>
