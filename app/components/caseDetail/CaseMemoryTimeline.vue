<script setup lang="ts">
/**
 * 案件记忆时间轴
 *
 * 按日分组显示记忆条目（最新在上）。每条卡片包含：
 * - 类型徽章（fact 蓝 / event 绿 / decision 黄 / note 灰）
 * - 来源徽章（manual 蓝 / auto_extract 绿 / manual_user 橙 / consolidator 紫）
 * - 文本 + subject_key（monospace 灰小标）
 * - 删除按钮（仅 source=manual_user）
 *
 * 失效记录（invalidatedAt 非空）灰底 + 删除线，仅 showInvalidated=true 渲染。
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

    return Array.from(map.entries())
        .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
        .map(([date, items]) => ({
            date,
            label: dayjs(date).format('YYYY 年 M 月 D 日'),
            items,
        }))
})
</script>

<template>
    <div class="space-y-6">
        <div v-for="group in groupedByDay" :key="group.date" class="relative">
            <!-- 左侧时间轴 + 日期标签 -->
            <div class="flex items-baseline gap-3 mb-3">
                <div class="text-xs font-semibold text-muted-foreground/70 tracking-wider">
                    {{ group.label }}
                </div>
                <div class="flex-1 h-px bg-border" />
                <span class="text-[10px] text-muted-foreground/50">{{ group.items.length }} 条</span>
            </div>

            <!-- 卡片列表 -->
            <div class="space-y-2 pl-3 border-l border-border/60">
                <div v-for="item in group.items" :key="item.id"
                    class="rounded-md border bg-card p-3 hover:shadow-sm transition-shadow"
                    :class="item.invalidatedAt ? 'opacity-60 bg-muted' : ''">
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex flex-wrap items-center gap-1.5 mb-1.5">
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
                            class="text-muted-foreground hover:text-destructive transition-colors p-1 -m-1"
                            title="删除"
                            @click="emit('delete', item.id)">
                            <Trash2Icon class="size-3.5" />
                        </button>
                    </div>
                    <p class="text-sm leading-relaxed text-foreground"
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

        <div v-if="groupedByDay.length === 0" class="text-center py-10 text-sm text-muted-foreground">
            暂无记忆条目
        </div>
    </div>
</template>
