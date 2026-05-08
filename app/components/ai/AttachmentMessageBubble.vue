<script setup lang="ts">
/**
 * 附件消息气泡：用户上传的多个文件聚合在一个气泡内，每个文件一张卡片
 *
 * 协议：useAssistantChat.sendMessage 把附件元数据（fileName/fileType/fileSize/id）
 * 发到 LangChain message 的 additional_kwargs.attachments + content sentinel
 * 双轨承载，useMessageParser 在 ParsedMessage.attachments 字段升级为一等公民。
 *
 * 体验对齐案件详情页"案件材料"：点击卡片 → 调起
 *   - CaseAnalysisDocPreviewDialog（docx / pdf / 图片 / 通用文档）
 *   - CaseAnalysisAudioPreviewDialog（音频）
 */
import {
    FileIcon,
    FileTextIcon,
    FileSpreadsheetIcon,
    PresentationIcon,
    FileImageIcon,
    FileAudioIcon,
    FileVideoIcon,
    FileArchiveIcon,
    EyeIcon,
} from 'lucide-vue-next'
import { isAudioFile } from '~~/shared/utils/fileType'
import CaseAnalysisDocPreviewDialog from '~/components/caseAnalysis/DocPreviewDialog.vue'
import CaseAnalysisAudioPreviewDialog from '~/components/caseAnalysis/AudioPreviewDialog.vue'

export interface AttachmentLite {
    id: number
    fileName: string
    fileType?: string
    fileSize?: number
    encrypted?: boolean
}

interface IconStyle {
    icon: typeof FileIcon
    /** Tailwind text 颜色（用于 SVG 描边） */
    color: string
    /** Tailwind bg 颜色（用于图标容器，半透明） */
    bg: string
}

const props = defineProps<{
    attachments: AttachmentLite[]
}>()

const previewFile = ref<AttachmentLite | null>(null)
const docDialogOpen = ref(false)
const audioDialogOpen = ref(false)

/**
 * 文件类型 → 图标 + 配色（让多文件场景视觉不单调）
 * 配色统一 text 颜色 + bg 半透明（10%），浅色 / 暗色模式都协调。
 */
function pickStyle(fileName: string): IconStyle {
    const lower = fileName.toLowerCase()
    // 浅色用 bg-{color}-50（实色淡底）+ text-{color}-600（深一档对比够），
    // 深色用 bg-{color}-500/15（半透明）+ text-{color}-400（柔一档不刺眼）
    if (/\.(png|jpe?g|gif|webp|svg|bmp)$/.test(lower)) {
        return { icon: FileImageIcon, color: 'text-pink-600 dark:text-pink-400', bg: 'bg-pink-50 dark:bg-pink-500/15' }
    }
    if (/\.(mp3|wav|m4a|flac|aac|ogg)$/.test(lower)) {
        return { icon: FileAudioIcon, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-500/15' }
    }
    if (/\.(mp4|mov|avi|mkv|webm)$/.test(lower)) {
        return { icon: FileVideoIcon, color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-500/15' }
    }
    if (/\.(xlsx?|csv)$/.test(lower)) {
        return { icon: FileSpreadsheetIcon, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/15' }
    }
    if (/\.(pptx?)$/.test(lower)) {
        return { icon: PresentationIcon, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-500/15' }
    }
    if (/\.(zip|gz|tar|rar|7z)$/.test(lower)) {
        return { icon: FileArchiveIcon, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/15' }
    }
    if (/\.(docx?|pdf|txt|rtf|md)$/.test(lower)) {
        return { icon: FileTextIcon, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/15' }
    }
    return { icon: FileIcon, color: 'text-muted-foreground', bg: 'bg-muted' }
}

function formatSize(bytes?: number): string {
    if (!bytes || !Number.isFinite(bytes)) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function openPreview(att: AttachmentLite) {
    previewFile.value = att
    if (isAudioFile(att.fileName)) {
        audioDialogOpen.value = true
    } else {
        docDialogOpen.value = true
    }
}
</script>

<template>
    <!-- 单文件 sm:max-w-[320px] 避免独占两列宽显得太空 -->
    <div
        class="flex w-full max-w-2xl flex-wrap gap-2"
        :class="attachments.length === 1 ? 'sm:max-w-[320px]' : ''"
    >
        <button
            v-for="att in attachments"
            :key="att.id"
            type="button"
            class="group flex min-w-0 flex-1 basis-[200px] items-center gap-3 rounded-xl border border-border/70 bg-card px-3.5 py-3 text-left transition-colors hover:border-border hover:ring-1 hover:ring-foreground/5 sm:basis-[220px] sm:grow-0 sm:max-w-[280px]"
            @click="openPreview(att)"
        >
            <!-- 图标容器：圆角色块 + 类型分色 -->
            <div
                :class="['flex size-10 shrink-0 items-center justify-center rounded-lg', pickStyle(att.fileName).bg]"
            >
                <component
                    :is="pickStyle(att.fileName).icon"
                    :class="['size-5', pickStyle(att.fileName).color]"
                />
            </div>

            <!-- 文件信息 -->
            <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-foreground">
                    {{ att.fileName }}
                </div>
                <div class="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span v-if="formatSize(att.fileSize)">{{ formatSize(att.fileSize) }}</span>
                    <span v-if="formatSize(att.fileSize)" class="opacity-60">·</span>
                    <EyeIcon class="size-3" />
                    <span>点击预览</span>
                </div>
            </div>
        </button>

        <!-- 预览 Dialog（按文件类型分发，体验对齐案件详情页"案件材料"）-->
        <CaseAnalysisDocPreviewDialog
            v-if="previewFile && !isAudioFile(previewFile.fileName)"
            v-model:open="docDialogOpen"
            :oss-file-id="previewFile.id"
            :file-name="previewFile.fileName"
            :file-type="previewFile.fileType ?? 'application/octet-stream'"
            :encrypted="previewFile.encrypted"
        />
        <CaseAnalysisAudioPreviewDialog
            v-if="previewFile && isAudioFile(previewFile.fileName)"
            v-model:open="audioDialogOpen"
            :oss-file-id="previewFile.id"
            :file-name="previewFile.fileName"
            :encrypted="previewFile.encrypted"
        />
    </div>
</template>
