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

const diffs = computed(() => {
    const snapValues = (props.snapshot.values ?? {}) as Record<string, string | null>
    const names = Array.from(new Set([
        ...Object.keys(props.currentValues),
        ...Object.keys(snapValues),
    ]))
    return names.map(name => ({
        name,
        current: props.currentValues[name] ?? '',
        snapshot: snapValues[name] ?? '',
    }))
})
</script>

<template>
    <div class="space-y-3">
        <div class="flex justify-end">
            <Button data-testid="apply-all" size="sm" @click="emit('applyAll')">
                全部采用此快照
            </Button>
        </div>
        <div class="rounded-md border overflow-hidden">
            <div class="grid grid-cols-[1fr_1fr_1fr_auto] text-xs bg-muted/50 px-3 py-2 font-medium">
                <span>字段</span>
                <span>当前值</span>
                <span>快照值</span>
                <span class="w-24 text-right">操作</span>
            </div>
            <ul class="divide-y">
                <li v-for="row in diffs" :key="row.name"
                    class="grid grid-cols-[1fr_1fr_1fr_auto] items-start px-3 py-2 gap-2 text-sm">
                    <span class="font-medium truncate">{{ row.name }}</span>
                    <span class="text-muted-foreground break-words">{{ row.current || '—' }}</span>
                    <span class="break-words">{{ row.snapshot || '—' }}</span>
                    <div class="text-right">
                        <Button :data-testid="`apply-field-${row.name}`" size="sm" variant="ghost"
                            :disabled="row.current === row.snapshot" @click="emit('applyField', row.name)">
                            用这个值
                        </Button>
                    </div>
                </li>
            </ul>
        </div>
    </div>
</template>
