<script setup lang="ts">
defineProps<{
    clauseText: string
    suggestedClauseText?: string
}>()
</script>

<template>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div class="space-y-1">
            <div class="text-xs text-muted-foreground">原文条款</div>
            <div class="p-3 rounded-md bg-muted/40 whitespace-pre-wrap">{{ clauseText }}</div>
        </div>
        <div class="space-y-1">
            <div class="text-xs text-muted-foreground">建议改写</div>
            <div
                v-if="suggestedClauseText"
                class="p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/30 whitespace-pre-wrap"
            >
                {{ suggestedClauseText }}
            </div>
            <div v-else class="p-3 rounded-md bg-muted/20 text-muted-foreground italic">无建议改写</div>
        </div>
    </div>
</template>
