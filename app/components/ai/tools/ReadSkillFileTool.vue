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
 * 读取技能文件工具卡片
 *
 * 视觉与上传文件 FileCard 同款：左侧 size-10 文件图标方块 + 文件名（主标题）
 * + "读取技能文件 · <目录>"（副标题）+ 右侧状态小图标。
 * 不渲染 input.path 以外的参数，也不渲染 output 文件正文，避免技能内容泄露到对话视图。
 */
const props = defineProps<{
    toolName: string
    input?: { path?: string } | any
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

const { label: skillLabelOf } = useSkillLabels()

// 从路径里提取 skill 英文名作为主标题查表用。
// 兼容后端注入的 4 种前缀（.deepagents/skills/, ./skills/, skills/, 无前缀），
// 与 readSkillFile.tool.ts 的 normalize 正则保持一致；_workspace 前缀不属于 skill 范畴。
const skillSlug = computed<string>(() => {
    const p = filePath.value
    if (!p || p.startsWith('_workspace/')) return ''
    const normalized = p.replace(/^(?:\.?\/?)?(?:\.?deepagents\/)?skills\//, '')
    const segs = normalized.split('/').filter(Boolean)
    return segs[0] ?? ''
})

// 主标题：skill 中文展示名（label 未加载或未匹配时退化为原 slug）
const skillTitle = computed<string>(() => {
    const slug = skillSlug.value
    return slug ? skillLabelOf(slug) : ''
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

const isLoading = computed(() =>
    props.state === 'input-streaming' || props.state === 'input-available',
)
</script>

<template>
    <div
        class="not-prose group my-2 inline-flex w-full max-w-sm items-center gap-3 rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-colors"
        :class="isLoading
            ? 'border-primary/40 bg-primary/5'
            : 'hover:border-border hover:bg-muted/30'"
    >
        <!-- 左侧文件图标方块（与 FileCard 同款） -->
        <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Loader2 v-if="isLoading" class="size-5 animate-spin text-primary" />
            <component :is="FileIconComponent" v-else class="size-5 text-primary" />
        </div>

        <!-- 主信息：skill 中文名（强调）+ 副标题（"读取技能文件 · 文件名"） -->
        <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-foreground" :title="filePath">
                {{ skillTitle || fileName || '读取技能文件' }}
            </p>
            <p
                class="mt-0.5 truncate text-xs"
                :class="isLoading ? 'text-primary' : 'text-muted-foreground'"
                :title="filePath"
            >
                <span>读取技能文件</span>
                <template v-if="isLoading"> · 进行中…</template>
                <template v-else-if="fileName"> · {{ fileName }}</template>
            </p>
        </div>

        <!-- 右侧状态小图标（完成/错误/拒绝/暂停），加载态用左侧 spinner 表达，不再重复 -->
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
