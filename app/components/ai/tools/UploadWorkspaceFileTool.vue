<script setup lang="ts">
/**
 * upload_workspace_file 工具调用渲染器
 *
 * 把工具调用结果直接渲染为 `<AiFileCard>`，避免依赖 LLM 在回复文本中
 * 嵌入 `[file-card]` 标记的脆弱约定。
 *
 * 工具输出保持 `[file-card]\nkey: value\n[/file-card]` 文本格式（与后端
 * `uploadWorkspaceFile.tool.ts` 的 `formatFileCard` 一致），renderer 直接
 * 解析成结构化数据传给 `AiFileCard`。输出为 `Error: ...` 时走错误分支。
 */
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

/** 折叠区默认标题（"上传工作区文件"）由 ai-elements 的 tool name map 提供 */
</script>

<template>
  <AiElementsTool>
    <AiElementsToolHeader
      title="上传文件"
      :type="`tool-${props.toolName}`"
      :state="props.state as any"
    />
    <AiElementsToolContent>
      <AiElementsToolInput v-if="props.input" :input="props.input" />

      <!-- 成功：渲染为文件卡片 -->
      <div v-if="parsed.card" class="px-4 pb-3">
        <AiFileCard
          :file-id="parsed.card.fileId"
          :file-name="parsed.card.fileName"
          :file-size="parsed.card.fileSize"
          :mime-type="parsed.card.mimeType"
          :temporary="parsed.card.temporary"
          :expires-at="parsed.card.expiresAt"
        />
      </div>

      <!-- 失败：显示错误信息 -->
      <AiElementsToolOutput
        v-else-if="parsed.errorText"
        :output="null"
        :error-text="parsed.errorText"
      />

      <!-- 进行中：上传中提示 -->
      <div
        v-else-if="props.state === 'input-available'"
        class="px-4 pb-3 text-sm text-muted-foreground"
      >
        正在上传文件到云盘...
      </div>
    </AiElementsToolContent>
  </AiElementsTool>
</template>
