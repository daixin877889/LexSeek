<script setup lang="ts">
import type { DocumentDraftSnapshot } from '#shared/types/document'

const props = defineProps<{
    snapshot: DocumentDraftSnapshot
    currentValues: Record<string, string | null>
}>()

const emit = defineEmits<{
    applyField: [fieldName: string]
    applyAll: []
}>()

interface DiffRow {
    name: string
    current: string
    snapshot: string
    changed: boolean
}

const diffs = computed<DiffRow[]>(() => {
    const snapValues = (props.snapshot.values ?? {}) as Record<string, string | null>
    const names = Array.from(new Set([
        ...Object.keys(props.currentValues),
        ...Object.keys(snapValues),
    ]))
    return names.map((name) => {
        const current = props.currentValues[name] ?? ''
        const snapshot = snapValues[name] ?? ''
        return { name, current, snapshot, changed: current !== snapshot }
    })
})

const changedCount = computed(() => diffs.value.filter(r => r.changed).length)
</script>

<template>
    <div class="space-y-3">
        <div class="flex items-center justify-between gap-2">
            <div class="text-xs text-muted-foreground">
                共 {{ diffs.length }} 项 · <span class="text-foreground font-medium">{{ changedCount }}</span> 项有差异
            </div>
            <Button data-testid="apply-all" size="sm" @click="emit('applyAll')">
                全部采用此快照
            </Button>
        </div>
        <ul class="space-y-4">
            <li v-for="row in diffs" :key="row.name"
                class="rounded-md border overflow-hidden transition-colors"
                :class="row.changed
                    ? 'border-l-4 border-l-primary bg-primary/5'
                    : 'bg-muted/20'">
                <div class="flex items-center justify-between gap-2 px-3 py-2 border-b bg-background/40">
                    <span class="text-sm font-medium truncate" :title="row.name">{{ row.name }}</span>
                    <Button v-if="row.changed" :data-testid="`apply-field-${row.name}`" size="sm" variant="ghost"
                        class="h-7 px-2 shrink-0"
                        @click="emit('applyField', row.name)">
                        用这个值
                    </Button>
                </div>
                <div v-if="row.changed" class="divide-y">
                    <div class="px-3 py-2">
                        <div class="text-xs text-muted-foreground mb-1">当前值</div>
                        <div class="text-sm break-words whitespace-pre-wrap" :class="!row.current && 'text-muted-foreground'">
                            {{ row.current || '—' }}
                        </div>
                    </div>
                    <div class="px-3 py-2">
                        <div class="text-xs text-muted-foreground mb-1">快照值</div>
                        <div class="text-sm break-words whitespace-pre-wrap font-medium"
                            :class="!row.snapshot && 'text-muted-foreground font-normal'">
                            {{ row.snapshot || '—' }}
                        </div>
                    </div>
                </div>
                <div v-else class="px-3 py-2">
                    <div class="text-xs text-muted-foreground mb-1">和当前版本一致</div>
                    <div class="text-sm break-words whitespace-pre-wrap" :class="!row.current && 'text-muted-foreground'">
                        {{ row.current || '—' }}
                    </div>
                </div>
            </li>
        </ul>
    </div>
</template>
