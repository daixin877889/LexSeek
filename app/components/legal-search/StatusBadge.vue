<template>
    <span class="inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium leading-5"
        :class="toneClass">
        <slot />
    </span>
</template>

<script lang="ts" setup>
/**
 * 法律法规检索通用状态徽章
 * 用于类型徽章（法律/行政法规/司法解释/指导意见）与生效状态徽章（现行有效/尚未生效/已失效）
 */

type BadgeTone = 'info' | 'success' | 'warn' | 'muted'

interface Props {
    /** 色调 */
    tone?: BadgeTone
}

const props = withDefaults(defineProps<Props>(), {
    tone: 'info',
})

/** 色调 → Tailwind 类（亮/暗双色安全） */
const TONE_CLASS: Record<BadgeTone, string> = {
    info: 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-300',
    success: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-300',
    warn: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-300',
    muted: 'bg-muted text-muted-foreground border-border',
}

const toneClass = computed(() => TONE_CLASS[props.tone])
</script>
