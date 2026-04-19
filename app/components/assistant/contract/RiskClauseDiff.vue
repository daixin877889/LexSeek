<script lang="ts">
import DiffMatchPatch from 'diff-match-patch'

// dmp 实例无状态，挂到 <script>（非 setup）作模块级单例，
// 避免每个 RiskClauseDiff 卡片实例重复构造。
const dmp = new DiffMatchPatch()
</script>

<script setup lang="ts">
/**
 * 单条风险的条款对照（M5：字符级 diff 着色）
 *
 * 用 diff-match-patch 做字符级 diff，原文栏仅显示"相同 + 删除"，
 * 建议栏仅显示"相同 + 新增"。删除红底删除线，新增绿底加粗。
 * 当 suggestedClauseText 为空时 fallback 到 M4 的纯文本行为。
 */

const props = defineProps<{
    clauseText: string
    suggestedClauseText?: string
}>()

type DiffSegment = { kind: 'equal' | 'delete' | 'insert'; text: string }

const diff = computed<{ original: DiffSegment[]; revised: DiffSegment[] } | null>(() => {
    if (!props.suggestedClauseText) return null
    const raw = dmp.diff_main(props.clauseText, props.suggestedClauseText)
    dmp.diff_cleanupSemantic(raw)
    const original: DiffSegment[] = []
    const revised: DiffSegment[] = []
    for (const [op, text] of raw) {
        if (op === 0) {
            original.push({ kind: 'equal', text })
            revised.push({ kind: 'equal', text })
        } else if (op === -1) {
            original.push({ kind: 'delete', text })
        } else if (op === 1) {
            revised.push({ kind: 'insert', text })
        }
    }
    return { original, revised }
})

const CLASS_MAP: Record<DiffSegment['kind'], string> = {
    equal: '',
    delete: 'bg-red-100 dark:bg-red-900/30 line-through',
    insert: 'bg-emerald-100 dark:bg-emerald-900/30 font-medium',
}
</script>

<template>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div class="space-y-1">
            <div class="text-xs text-muted-foreground">原文条款</div>
            <div v-if="diff" class="p-3 rounded-md bg-muted/40 whitespace-pre-wrap">
                <span v-for="(seg, i) in diff.original" :key="`o-${i}`" :class="CLASS_MAP[seg.kind]">{{ seg.text }}</span>
            </div>
            <div v-else class="p-3 rounded-md bg-muted/40 whitespace-pre-wrap">{{ clauseText }}</div>
        </div>
        <div class="space-y-1">
            <div class="text-xs text-muted-foreground">建议改写</div>
            <div v-if="diff" class="p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/30 whitespace-pre-wrap">
                <span v-for="(seg, i) in diff.revised" :key="`r-${i}`" :class="CLASS_MAP[seg.kind]">{{ seg.text }}</span>
            </div>
            <div v-else class="p-3 rounded-md bg-muted/20 text-muted-foreground italic">无建议改写</div>
        </div>
    </div>
</template>
