<script setup lang="ts">
/**
 * 浮动批注面板（M6.2 Task 17 · M6.1 跟进：可拖拽调宽高）
 *
 * 右下角悬浮的可拖拽、可 resize 的风险速览面板。
 * - 正常态：useDraggableResize 托管 width/height/position（复用文书编辑器 ChatWindowShell 的同套 composable）
 * - 最小化态 w-12 h-12：仅显示风险数徽章
 * - 点击风险条目 emit focusRisk，activeRiskId 短暂高亮
 *
 * **Feature: contract-review-m6.2**
 */
import { MinusIcon, XIcon, PinIcon } from 'lucide-vue-next'
import { RISK_LEVEL_LABEL, type Risk, type RiskLevel } from '#shared/types/contract'

interface Props {
    risks: Risk[]
    activeRiskId?: string
    visible: boolean
}
const props = withDefaults(defineProps<Props>(), {
    activeRiskId: undefined,
})

const emit = defineEmits<{
    'update:visible': [v: boolean]
    focusRisk: [riskId: string]
}>()

const STORAGE_KEY = 'contract-annotation-panel-collapsed'

// ── 最小化状态 + 持久化 ─────────────────────────────────────────────────────

const collapsed = ref(false)
onMounted(() => {
    try {
        collapsed.value = localStorage.getItem(STORAGE_KEY) === '1'
    } catch { /* SSR or 禁用 storage 时静默 */ }
})
watch(collapsed, (v) => {
    try {
        localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
    } catch { /* 静默 */ }
})

// ── 拖拽 + resize（正常态专用，collapsed 时不启用） ───────────────────────
// 复用文书编辑器 ChatWindowShell 的同套 composable，支持四边/四角拖拽调尺寸
const { style: windowStyle, onDragStart, onEdgeDetect, onResizeStart, cursor, isInteracting }
    = useDraggableResize({
        initialWidth: 288,   // w-72
        initialHeight: 384,  // h-96
        minWidth: 240,
        minHeight: 280,
    })

const panelContainerStyle = computed(() => ({
    ...windowStyle.value,
    cursor: cursor.value,
}))

// ── 风险列表派生 ───────────────────────────────────────────────────────────

const groupedRisks = computed(() => {
    const groups: Record<RiskLevel, Risk[]> = { high: [], medium: [], low: [] }
    for (const r of props.risks) {
        groups[r.level].push(r)
    }
    groups.high.sort((a, b) => a.clauseIndex - b.clauseIndex)
    groups.medium.sort((a, b) => a.clauseIndex - b.clauseIndex)
    groups.low.sort((a, b) => a.clauseIndex - b.clauseIndex)
    return groups
})

const LEVEL_BADGE: Record<RiskLevel, string> = {
    high: 'bg-red-500',
    medium: 'bg-orange-500',
    low: 'bg-gray-400',
}

function handleRiskClick(riskId: string) {
    emit('focusRisk', riskId)
}

function toggleCollapse() {
    collapsed.value = !collapsed.value
}

function close() {
    emit('update:visible', false)
}
</script>

<template>
    <!-- 最小化态：固定在右下角徽章（不 resize） -->
    <button
        v-if="visible && collapsed"
        type="button"
        class="fixed z-50 right-6 bottom-6 w-12 h-12 flex flex-col items-center justify-center gap-0.5 rounded-lg bg-background border shadow-lg text-xs font-medium hover:bg-muted transition-colors"
        :title="`${risks.length} 个风险`"
        @click="toggleCollapse"
    >
        <PinIcon class="size-4" />
        <span class="text-[10px] leading-none">{{ risks.length }}</span>
    </button>

    <!-- 正常态：可拖拽 + 可 resize（复用 useDraggableResize） -->
    <div
        v-else-if="visible"
        class="fixed z-50 bg-background border rounded-lg shadow-lg flex flex-col overflow-hidden"
        :class="{ 'select-none': isInteracting }"
        :style="panelContainerStyle"
        @pointermove="onEdgeDetect($event)"
        @pointerdown="onResizeStart($event)"
    >
        <!-- 标题栏（可拖拽） -->
        <div
            class="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-muted/40 cursor-grab active:cursor-grabbing"
            @pointerdown="onDragStart($event)"
        >
            <PinIcon class="size-4 text-muted-foreground" />
            <span class="text-sm font-medium">风险速览（{{ risks.length }}）</span>
            <div class="ml-auto flex items-center gap-1" data-no-drag>
                <button
                    type="button"
                    class="p-1 rounded hover:bg-muted"
                    title="最小化"
                    @click.stop="toggleCollapse"
                >
                    <MinusIcon class="size-3.5" />
                </button>
                <button
                    type="button"
                    class="p-1 rounded hover:bg-muted"
                    title="关闭"
                    @click.stop="close"
                >
                    <XIcon class="size-3.5" />
                </button>
            </div>
        </div>

        <!-- 滚动容器：flex-1 min-h-0 确保 ScrollArea 能从父 flex-col 拿到确定高度 -->
        <ScrollArea class="flex-1 min-h-0">
            <div class="p-2 space-y-3">
                <div v-if="!risks.length" class="text-xs text-muted-foreground text-center py-6">
                    暂无风险条目
                </div>

                <template v-for="level in (['high', 'medium', 'low'] as const)" :key="level">
                    <div v-if="groupedRisks[level].length" class="space-y-1">
                        <div class="flex items-center gap-1.5 px-1">
                            <span class="size-2 rounded-full" :class="LEVEL_BADGE[level]" />
                            <span class="text-xs font-medium text-muted-foreground">
                                {{ RISK_LEVEL_LABEL[level] }}风险（{{ groupedRisks[level].length }}）
                            </span>
                        </div>
                        <button
                            v-for="r in groupedRisks[level]"
                            :key="r.id"
                            type="button"
                            class="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted transition-colors"
                            :class="{ 'bg-primary/10 ring-1 ring-primary/40': activeRiskId === r.id }"
                            @click="handleRiskClick(r.id)"
                        >
                            <div class="flex items-center gap-1">
                                <span class="text-muted-foreground">#{{ r.clauseIndex }}</span>
                                <span class="font-medium truncate">{{ r.category }}</span>
                            </div>
                            <div class="text-muted-foreground line-clamp-1 mt-0.5">{{ r.problem }}</div>
                        </button>
                    </div>
                </template>
            </div>
        </ScrollArea>
    </div>
</template>
