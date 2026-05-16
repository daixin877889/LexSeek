<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'
import {
    BookOpen,
    CheckCircle2,
    File,
    FileCode,
    FileJson,
    FileText,
    Loader2,
    PauseCircle,
    XCircle,
} from 'lucide-vue-next'
import { useSkillLabels } from '~/composables/useSkillLabels'

/**
 * 写入技能文件工具卡片
 *
 * 与 ReadSkillFileTool 同款（FileCard 风格），副标题文字区分动作。
 * 写入态额外用 spinner + primary 边框 + "进行中 · 12.3 KB" 提示，让长时间写入有明显反馈。
 */
const props = defineProps<{
    toolName: string
    input?: { path?: string, content?: string } | any
    output?: any
    state: ExtendedToolState
}>()

const filePath = computed<string>(() => {
    const p = props.input?.path
    return typeof p === 'string' && p.trim() ? p.trim() : ''
})

const fileName = computed<string>(() => {
    const p = filePath.value
    if (!p) return ''
    const segments = p.split('/').filter(Boolean)
    return segments[segments.length - 1] || p
})

const dirPath = computed<string>(() => {
    const p = filePath.value
    if (!p) return ''
    const idx = p.lastIndexOf('/')
    return idx > 0 ? p.slice(0, idx) : ''
})

const FileIconComponent = computed(() => {
    const name = fileName.value.toLowerCase()
    if (name === 'skill.md') return BookOpen
    if (name.endsWith('.md')) return FileText
    if (name.endsWith('.json') || name.endsWith('.yaml') || name.endsWith('.yml')) return FileJson
    if (/\.(ts|js|mjs|cjs|py|sh)$/.test(name)) return FileCode
    if (name.endsWith('.txt') || name.endsWith('.log')) return FileText
    return File
})

const isWriting = computed(() =>
    props.state === 'input-streaming' || props.state === 'input-available',
)

// content 字节数估算（含中文等多字节）；写入态副标题里展示，让用户对"为何耗时"有直观感
const contentSize = computed<string>(() => {
    const c = props.input?.content
    if (typeof c !== 'string' || !c) return ''
    const bytes = new Blob([c]).size
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
})

const { label: skillLabelOf } = useSkillLabels()

// 把 dirPath 里 ".deepagents/skills/<英文 skill 名>" 段替换为中文展示名；
// 路径其它段保持原样。原始英文路径仍作鼠标悬停 :title，不丢可追溯性。
const dirDisplay = computed<string>(() => {
    const dir = dirPath.value
    if (!dir) return ''
    const m = dir.match(/^(\.deepagents\/skills)\/([^/]+)(\/.*)?$/)
    if (!m) return dir
    const [, prefix = '', sName = '', rest = ''] = m
    return `${prefix}/${skillLabelOf(sName)}${rest}`
})
</script>

<template>
    <div
        class="not-prose group my-2 inline-flex w-full max-w-sm items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors"
        :class="isWriting
            ? 'border-primary/40 bg-primary/5'
            : 'hover:border-border hover:bg-muted/30'"
    >
        <!-- 左侧文件图标方块；写入态变 spinner -->
        <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Loader2 v-if="isWriting" class="size-5 animate-spin text-primary" />
            <component :is="FileIconComponent" v-else class="size-5 text-primary" />
        </div>

        <!-- 主信息：文件名 + 副标题（"写入技能文件 · 12.3 KB · 进行中…" 或 "写入技能文件 · 12.3 KB"） -->
        <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-foreground" :title="filePath">
                {{ fileName || '写入技能文件' }}
            </p>
            <p
                class="mt-0.5 truncate text-xs"
                :class="isWriting ? 'text-primary' : 'text-muted-foreground'"
                :title="dirPath"
            >
                <span>写入技能文件</span>
                <template v-if="contentSize"> · {{ contentSize }}</template>
                <template v-if="isWriting"> · 进行中…</template>
                <template v-else-if="dirDisplay"> · {{ dirDisplay }}</template>
            </p>
        </div>

        <!-- 右侧状态小图标 -->
        <CheckCircle2
            v-if="state === 'output-available'"
            class="size-4 shrink-0 text-green-500"
        />
        <XCircle
            v-else-if="state === 'output-error'"
            class="size-4 shrink-0 text-red-500"
        />
        <XCircle
            v-else-if="state === 'output-denied'"
            class="size-4 shrink-0 text-orange-500"
        />
        <PauseCircle
            v-else-if="state === 'input-paused'"
            class="size-4 shrink-0 text-yellow-500"
        />
    </div>
</template>
