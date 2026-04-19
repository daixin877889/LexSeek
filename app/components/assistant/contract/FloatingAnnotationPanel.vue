<script setup lang="ts">
/**
 * 浮动批注面板（M6.2 Task 17）
 *
 * 右下角悬浮的可拖拽、可最小化的风险速览面板。
 * - 正常态 w-72 h-96：显示分组风险列表
 * - 最小化态 w-12 h-12：仅显示风险数徽章
 * - header mousedown 拖拽（纯原生 mouse 事件，不引入第三方库）
 * - 拖拽边界：距顶 / 底至少 20px，距左 / 右至少 20px
 * - localStorage 持久化最小化状态（不持久化位置，刷新归位右下角）
 * - 点击风险条目 emit focusRisk，activeRiskId 短暂高亮
 *
 * **Feature: contract-review-m6.2**
 */
import { MinusIcon, XIcon, PinIcon } from 'lucide-vue-next'
import type { Risk } from '#shared/types/contract'

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
const MARGIN = 20

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

// ── 位置状态（px，右下对齐）─────────────────────────────────────────────────
// 每次挂载默认 bottom: 24, right: 24；拖拽时转为 left/top 绝对定位
const useAbsolutePos = ref(false)
const pos = reactive({ left: 0, top: 0 })

// ── 原生拖拽实现 ───────────────────────────────────────────────────────────

const panelRef = ref<HTMLElement | null>(null)
let dragStartX = 0
let dragStartY = 0
let startLeft = 0
let startTop = 0

function onHeaderMouseDown(e: MouseEvent) {
    // 仅响应主键；忽略最小化 / 关闭按钮点击冒泡
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('[data-no-drag]')) return

    const el = panelRef.value
    if (!el) return

    // 首次拖拽：把 bottom/right 定位换算成 left/top
    if (!useAbsolutePos.value) {
        const rect = el.getBoundingClientRect()
        pos.left = rect.left
        pos.top = rect.top
        useAbsolutePos.value = true
    }

    dragStartX = e.clientX
    dragStartY = e.clientY
    startLeft = pos.left
    startTop = pos.top

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    e.preventDefault()
}

function onMouseMove(e: MouseEvent) {
    const el = panelRef.value
    if (!el) return
    const dx = e.clientX - dragStartX
    const dy = e.clientY - dragStartY
    const w = el.offsetWidth
    const h = el.offsetHeight
    const maxLeft = window.innerWidth - w - MARGIN
    const maxTop = window.innerHeight - h - MARGIN
    pos.left = Math.min(Math.max(MARGIN, startLeft + dx), maxLeft)
    pos.top = Math.min(Math.max(MARGIN, startTop + dy), maxTop)
}

function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
}

onBeforeUnmount(() => {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
})

// ── 风险列表派生 ───────────────────────────────────────────────────────────

const groupedRisks = computed(() => {
    const groups: Record<'high' | 'medium' | 'low', Risk[]> = { high: [], medium: [], low: [] }
    for (const r of props.risks) {
        groups[r.level].push(r)
    }
    // 组内按 clauseIndex 升序
    for (const k of Object.keys(groups) as Array<'high' | 'medium' | 'low'>) {
        groups[k] = [...groups[k]].sort((a, b) => a.clauseIndex - b.clauseIndex)
    }
    return groups
})

const LEVEL_LABEL: Record<'high' | 'medium' | 'low', string> = {
    high: '高风险',
    medium: '中风险',
    low: '低风险',
}
const LEVEL_BADGE: Record<'high' | 'medium' | 'low', string> = {
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

// ── 样式 ───────────────────────────────────────────────────────────────────

const panelStyle = computed(() => {
    if (useAbsolutePos.value) {
        return { left: `${pos.left}px`, top: `${pos.top}px` }
    }
    return { right: '24px', bottom: '24px' }
})
</script>

<template>
    <div
        v-if="visible"
        ref="panelRef"
        class="fixed z-50 bg-background border rounded-lg shadow-lg flex flex-col overflow-hidden select-none"
        :class="collapsed ? 'w-12 h-12' : 'w-72 h-96'"
        :style="panelStyle"
    >
        <!-- 最小化态：徽章 -->
        <button
            v-if="collapsed"
            type="button"
            class="flex-1 flex flex-col items-center justify-center gap-0.5 text-xs font-medium hover:bg-muted transition-colors"
            :title="`${risks.length} 个风险`"
            @click="toggleCollapse"
        >
            <PinIcon class="size-4" />
            <span class="text-[10px] leading-none">{{ risks.length }}</span>
        </button>

        <!-- 正常态 -->
        <template v-else>
            <div
                class="flex items-center gap-2 px-3 py-2 border-b bg-muted/40 cursor-move"
                @mousedown="onHeaderMouseDown"
            >
                <PinIcon class="size-4 text-muted-foreground" />
                <span class="text-sm font-medium">风险速览（{{ risks.length }}）</span>
                <div class="ml-auto flex items-center gap-1" data-no-drag>
                    <button
                        type="button"
                        class="p-1 rounded hover:bg-muted"
                        title="最小化"
                        @click="toggleCollapse"
                    >
                        <MinusIcon class="size-3.5" />
                    </button>
                    <button
                        type="button"
                        class="p-1 rounded hover:bg-muted"
                        title="关闭"
                        @click="close"
                    >
                        <XIcon class="size-3.5" />
                    </button>
                </div>
            </div>

            <ScrollArea class="flex-1">
                <div class="p-2 space-y-3">
                    <div v-if="!risks.length" class="text-xs text-muted-foreground text-center py-6">
                        暂无风险条目
                    </div>

                    <template v-for="level in (['high', 'medium', 'low'] as const)" :key="level">
                        <div v-if="groupedRisks[level].length" class="space-y-1">
                            <div class="flex items-center gap-1.5 px-1">
                                <span class="size-2 rounded-full" :class="LEVEL_BADGE[level]" />
                                <span class="text-xs font-medium text-muted-foreground">
                                    {{ LEVEL_LABEL[level] }}（{{ groupedRisks[level].length }}）
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
        </template>
    </div>
</template>
