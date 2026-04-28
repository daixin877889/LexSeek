<script setup lang="ts">
/**
 * 案件记忆时间轴（左轴右卡片）
 *
 * 视觉：
 * - 左侧一条贯穿主竖线
 * - 每个日期分组前有大圆点 + 日期标签（粗体）
 * - 每条记忆条目对应一个小圆点（marker）+ 时间（HH:mm）+ 卡片
 * - 失效记录的圆点变灰、卡片半透明、文本删除线
 *
 * 卡片内容：类型徽章 + 来源徽章 + 文本 + subject_key（monospace 灰小标）
 * 仅 source=manual_user 显示删除按钮（用 useAlertDialogStore 二次确认 — 父组件处理）
 */
import { computed } from 'vue'
import dayjs from 'dayjs'
import { Trash2Icon } from 'lucide-vue-next'
import type { MemoryItem } from '~/composables/useCaseMemory'

const props = defineProps<{
    memories: MemoryItem[]
    showInvalidated?: boolean
}>()

const emit = defineEmits<{
    delete: [memoryId: string]
}>()

const KIND_COLORS: Record<string, string> = {
    fact: 'bg-blue-100 text-blue-700',
    event: 'bg-emerald-100 text-emerald-700',
    decision: 'bg-amber-100 text-amber-700',
    note: 'bg-gray-100 text-gray-700',
}

const KIND_LABELS: Record<string, string> = {
    fact: '事实',
    event: '事件',
    decision: '决策',
    note: '笔记',
}

const SOURCE_COLORS: Record<string, string> = {
    manual: 'bg-blue-100 text-blue-700',
    consolidator: 'bg-purple-100 text-purple-700',
    auto_extract: 'bg-emerald-100 text-emerald-700',
    manual_user: 'bg-orange-100 text-orange-700',
}

const SOURCE_LABELS: Record<string, string> = {
    manual: 'AI 主动',
    consolidator: '批量整合',
    auto_extract: 'AI 自动',
    manual_user: '用户',
}

interface DayGroup {
    date: string
    label: string
    weekday: string
    items: MemoryItem[]
}

const groupedByDay = computed<DayGroup[]>(() => {
    const visible = props.showInvalidated
        ? props.memories
        : props.memories.filter(m => !m.invalidatedAt)

    const map = new Map<string, MemoryItem[]>()
    for (const m of visible) {
        const date = dayjs(m.createdAt).format('YYYY-MM-DD')
        const arr = map.get(date) ?? []
        arr.push(m)
        map.set(date, arr)
    }

    const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return Array.from(map.entries())
        .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
        .map(([date, items]) => {
            const d = dayjs(date)
            return {
                date,
                label: d.format('YYYY 年 M 月 D 日'),
                weekday: WEEKDAYS[d.day()] ?? '',
                items: items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
            }
        })
})

function formatTime(iso: string): string {
    return dayjs(iso).format('HH:mm')
}
</script>

<template>
    <div v-if="groupedByDay.length === 0" class="text-center py-10 text-sm text-muted-foreground">
        暂无记忆条目
    </div>

    <div v-else class="relative pl-1">
        <!-- 主竖线（贯穿整个时间轴） -->
        <div class="absolute left-[11px] top-2 bottom-2 w-px bg-border" />

        <div v-for="group in groupedByDay" :key="group.date" class="space-y-3 pb-6 last:pb-0">
            <!-- 日期标记（大圆点 + 日期 + 周几 + 数量） -->
            <div class="relative flex items-center gap-3 mb-1 pl-8">
                <div class="absolute left-0 top-1/2 -translate-y-1/2 size-[22px] rounded-full bg-primary/10 border-2 border-primary flex items-center justify-center">
                    <div class="size-2 rounded-full bg-primary" />
                </div>
                <div class="flex items-baseline gap-2">
                    <span class="text-sm font-semibold text-foreground">{{ group.label }}</span>
                    <span class="text-xs text-muted-foreground">{{ group.weekday }}</span>
                    <span class="text-[10px] text-muted-foreground/50">· {{ group.items.length }} 条</span>
                </div>
            </div>

            <!-- 当日记忆卡片列表 -->
            <div class="space-y-2 pl-8">
                <div v-for="item in group.items" :key="item.id"
                    class="relative">
                    <!-- 小圆点 marker（贴在主竖线上） -->
                    <div class="absolute -left-[22px] top-3 flex items-center justify-center">
                        <div class="size-2 rounded-full ring-2 ring-background"
                            :class="item.invalidatedAt
                                ? 'bg-muted-foreground/40'
                                : 'bg-primary/70'" />
                    </div>

                    <!-- 卡片 -->
                    <div class="rounded-md border bg-card p-3 hover:shadow-sm transition-shadow"
                        :class="item.invalidatedAt ? 'opacity-60 bg-muted' : ''">
                        <div class="flex items-start justify-between gap-2">
                            <div class="flex flex-wrap items-center gap-1.5">
                                <span class="text-[10px] text-muted-foreground/60 font-mono">
                                    {{ formatTime(item.createdAt) }}
                                </span>
                                <Badge variant="secondary" class="font-normal px-1.5 py-0 h-4 text-[10px]"
                                    :class="KIND_COLORS[item.kind]">
                                    {{ KIND_LABELS[item.kind] ?? item.kind }}
                                </Badge>
                                <Badge variant="secondary" class="font-normal px-1.5 py-0 h-4 text-[10px]"
                                    :class="SOURCE_COLORS[item.source]">
                                    {{ SOURCE_LABELS[item.source] ?? item.source }}
                                </Badge>
                                <span v-if="item.invalidatedAt"
                                    class="text-[10px] px-1.5 py-0 rounded bg-muted-foreground/10 text-muted-foreground">
                                    已被覆盖
                                </span>
                            </div>
                            <button v-if="item.source === 'manual_user' && !item.invalidatedAt"
                                class="text-muted-foreground hover:text-destructive transition-colors p-1 -m-1 flex-shrink-0"
                                title="删除"
                                @click="emit('delete', item.id)">
                                <Trash2Icon class="size-3.5" />
                            </button>
                        </div>
                        <p class="mt-1.5 text-sm leading-relaxed text-foreground"
                            :class="item.invalidatedAt ? 'line-through' : ''">
                            {{ item.text }}
                        </p>
                        <p v-if="item.subjectKey"
                            class="mt-1 text-[10px] font-mono text-muted-foreground/60">
                            {{ item.subjectKey }}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
