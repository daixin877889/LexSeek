<script setup lang="ts">
/**
 * 用户消息渲染：解析 `[附件: 文件名 · id=N]` 标记 → 渲染为可点击预览卡片
 *
 * 用户上传的附件元数据通过 useAssistantChat.sendMessage 以
 * `[附件: <文件名> · id=<ossFileId>]` 形式追加到 message.content 末尾，
 * 让 LLM 能从对话上下文里直接拿 ossFileId 调工具。前端把这些标记从可见
 * 文本里抽离，渲染成 lucide 图标 + 文件名 + 点击下载/预览的卡片，避免
 * 用户看到 "id=1012" 这类技术性 token。
 *
 * 阶段 7 计划：把附件 metadata 移到 LangGraph state 独立字段，从根本
 * 上和 message.content 解耦；本组件届时简化为"读 props.attachments 渲染"。
 */
import { FileIcon, FileTextIcon, FileSpreadsheetIcon, PresentationIcon, FileImageIcon, FileAudioIcon, FileVideoIcon, FileArchiveIcon, DownloadIcon, Loader2Icon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useApiFetch } from '~/composables/useApiFetch'

interface Props {
    content: string
}

const props = defineProps<Props>()

interface ParsedAttachment {
    id: number
    fileName: string
}

interface Parsed {
    cleanText: string
    attachments: ParsedAttachment[]
}

// 匹配 `[附件: 文件名 · id=数字]`（兼容 · 和 · 与 ; 分隔符）
const ATTACH_RE = /\[附件:\s*([^·\]]+?)\s*[··]\s*id=(\d+)\]/g

const parsed = computed<Parsed>(() => {
    const text = props.content ?? ''
    const attachments: ParsedAttachment[] = []
    let cleanText = text.replace(ATTACH_RE, (_match, name: string, idStr: string) => {
        const id = Number.parseInt(idStr, 10)
        if (Number.isFinite(id)) {
            attachments.push({ id, fileName: name.trim() })
        }
        return ''
    })
    cleanText = cleanText.replace(/\n{2,}/g, '\n\n').trim()
    return { cleanText, attachments }
})

function pickIcon(fileName: string) {
    const lower = fileName.toLowerCase()
    if (/\.(png|jpe?g|gif|webp|svg|bmp)$/.test(lower)) return FileImageIcon
    if (/\.(mp3|wav|m4a|flac)$/.test(lower)) return FileAudioIcon
    if (/\.(mp4|mov|avi|mkv|webm)$/.test(lower)) return FileVideoIcon
    if (/\.(xlsx?|csv)$/.test(lower)) return FileSpreadsheetIcon
    if (/\.(pptx?)$/.test(lower)) return PresentationIcon
    if (/\.(zip|gz|tar|rar|7z)$/.test(lower)) return FileArchiveIcon
    if (/\.(docx?|pdf|txt|rtf|md)$/.test(lower)) return FileTextIcon
    return FileIcon
}

const downloadingId = ref<number | null>(null)

async function handleDownload(att: ParsedAttachment) {
    if (downloadingId.value === att.id) return
    downloadingId.value = att.id
    try {
        const resp = await useApiFetch<Array<{ ossFileId: number; downloadUrl: string }>>(
            '/api/v1/files/oss/download-url',
            { method: 'POST', body: { ossFileIds: [att.id] }, showError: false } as any,
        )
        const url = resp?.[0]?.downloadUrl
        if (!url) {
            toast.error('文件不可下载（可能已删除）')
            return
        }
        window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
        toast.error(err instanceof Error ? err.message : '下载失败')
    } finally {
        downloadingId.value = null
    }
}
</script>

<template>
    <div class="flex flex-col gap-2">
        <!-- 文本部分（去掉附件 marker 后的干净内容） -->
        <div v-if="parsed.cleanText" class="whitespace-pre-wrap break-words">{{ parsed.cleanText }}</div>

        <!-- 附件卡片（多个文件并排） -->
        <div v-if="parsed.attachments.length" class="flex flex-wrap gap-2">
            <button v-for="att in parsed.attachments" :key="att.id" type="button"
                class="group inline-flex items-center gap-2 rounded-md border bg-background/60 px-3 py-2 text-left transition-colors hover:bg-accent disabled:opacity-50"
                :disabled="downloadingId === att.id" @click="handleDownload(att)">
                <component :is="pickIcon(att.fileName)" class="size-5 shrink-0 text-muted-foreground" />
                <span class="text-sm font-medium text-foreground line-clamp-1 max-w-[220px]">
                    {{ att.fileName }}
                </span>
                <Loader2Icon v-if="downloadingId === att.id" class="size-4 shrink-0 animate-spin text-muted-foreground" />
                <DownloadIcon v-else class="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
        </div>
    </div>
</template>
