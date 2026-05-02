<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'
import {
    CheckCircle2,
    FileCode,
    FileText,
    Loader2,
    PauseCircle,
    Play,
    Terminal,
    XCircle,
} from 'lucide-vue-next'
import { useSkillLabels } from '~/composables/useSkillLabels'

/**
 * 运行技能脚本工具卡片
 *
 * 视觉与 ReadSkillFileTool / WriteSkillFileTool 同款（FileCard 风格）。
 * 不渲染 input.args 详情和完整 output。错误态用 destructive 色边框 + 副标题表达，
 * 完整错误堆栈不在对话视图里展开（避免污染流），用户需要细节时可问 AI 复述。
 */
const props = defineProps<{
    toolName: string
    input?: { skillName?: string, scriptName?: string, action?: string, args?: Record<string, string> } | any
    output?: any
    state: ExtendedToolState
}>()

const scriptName = computed<string>(() => {
    const n = props.input?.scriptName
    return typeof n === 'string' && n.trim() ? n.trim() : ''
})

const skillName = computed<string>(() => {
    const n = props.input?.skillName
    if (typeof n !== 'string' || !n.trim()) return ''
    // _workspace 是特殊值（在会话工作区执行），给个友好别名
    return n === '_workspace' ? '会话工作区' : n.trim()
})

const { label: skillLabelOf } = useSkillLabels()

// 把英文 skill 名替换成中文展示名；若已是 "会话工作区" 或非 kebab-case 英文名就保持原样
const skillDisplay = computed<string>(() => {
    const en = skillName.value
    if (!en || en === '会话工作区') return en
    return /^[a-z0-9-]+$/.test(en) ? skillLabelOf(en) : en
})

const action = computed<string>(() => {
    const a = props.input?.action
    return typeof a === 'string' && a.trim() ? a.trim() : ''
})

// 根据脚本扩展名选图标，让用户对脚本类型有直观感（.py/.sh/.js 一眼区分）
const ScriptIconComponent = computed(() => {
    const name = scriptName.value.toLowerCase()
    if (/\.(js|cjs|mjs|ts|py|sh)$/.test(name)) return FileCode
    if (name.endsWith('.txt') || name.endsWith('.log')) return FileText
    return Terminal
})

const isRunning = computed(() =>
    props.state === 'input-streaming' || props.state === 'input-available',
)

const isError = computed(() =>
    props.state === 'output-error' || props.state === 'output-denied',
)

// 副标题文案：根据状态拼接 "运行 <skill> · <action> · 进行中/失败/已拒绝"
const subtitle = computed<string>(() => {
    const parts: string[] = ['运行技能脚本']
    if (skillDisplay.value) parts.push(skillDisplay.value)
    if (action.value) parts.push(action.value)
    if (isRunning.value) parts.push('进行中…')
    else if (props.state === 'output-error') parts.push('失败')
    else if (props.state === 'output-denied') parts.push('已拒绝')
    else if (props.state === 'input-paused') parts.push('已暂停')
    return parts.join(' · ')
})
</script>

<template>
    <div
        class="not-prose group my-2 inline-flex w-full max-w-sm items-center gap-3 rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-colors"
        :class="[
            isRunning && 'border-primary/40 bg-primary/5',
            isError && 'border-destructive/40 bg-destructive/5',
            !isRunning && !isError && 'hover:border-border hover:bg-muted/30',
        ]"
    >
        <!-- 左侧图标方块：运行中 spinner / 失败红色 X / 默认 Play -->
        <div
            class="flex size-10 shrink-0 items-center justify-center rounded-md"
            :class="isError ? 'bg-destructive/10' : 'bg-primary/10'"
        >
            <Loader2 v-if="isRunning" class="size-5 animate-spin text-primary" />
            <XCircle v-else-if="isError" class="size-5 text-destructive" />
            <Play v-else class="size-5 text-primary" />
        </div>

        <!-- 主信息：脚本名 + 副标题 -->
        <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-1.5">
                <component :is="ScriptIconComponent" class="size-3.5 shrink-0 text-muted-foreground" />
                <p class="truncate text-sm font-medium text-foreground" :title="scriptName">
                    {{ scriptName || '运行技能脚本' }}
                </p>
            </div>
            <p
                class="mt-0.5 truncate text-xs"
                :class="[
                    isRunning && 'text-primary',
                    isError && 'text-destructive',
                    !isRunning && !isError && 'text-muted-foreground',
                ]"
                :title="subtitle"
            >
                {{ subtitle }}
            </p>
        </div>

        <!-- 右侧状态小图标（运行中由左侧 spinner 表达，这里不重复） -->
        <CheckCircle2
            v-if="state === 'output-available'"
            class="size-4 shrink-0 text-green-500"
        />
        <XCircle
            v-else-if="state === 'output-error'"
            class="size-4 shrink-0 text-destructive"
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
