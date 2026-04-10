<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'

const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: ExtendedToolState
}>()

const results = computed(() => {
    try {
        const data = typeof props.output === 'string' ? JSON.parse(props.output) : props.output
        return Array.isArray(data) ? data : []
    } catch { return [] }
})
</script>

<template>
    <AiElementsTool>
        <AiElementsToolHeader title="材料检索" type="tool-search_case_materials" :state="state" />
        <AiElementsToolContent v-if="input || output != null">
            <div class="p-4 space-y-3">
                <div v-if="input">
                    <Badge variant="secondary">{{ input.query }}</Badge>
                </div>
                <AiElementsSources v-if="results.length">
                    <AiElementsSourcesTrigger :count="results.length" />
                    <AiElementsSourcesContent>
                        <AiElementsSourcesSource
                            v-for="r in results"
                            :key="r.index"
                            :href="`#material-${r.index}`"
                            :title="r.source?.materialName || '未知材料'"
                        >
                            <div class="flex flex-col gap-1">
                                <span class="font-medium text-sm">{{ r.source?.materialName }}</span>
                                <span class="text-xs text-muted-foreground line-clamp-2">{{ r.content?.substring(0, 200) }}</span>
                            </div>
                        </AiElementsSourcesSource>
                    </AiElementsSourcesContent>
                </AiElementsSources>
                <div v-else-if="state === 'output-available'" class="text-sm text-muted-foreground">
                    未检索到结果
                </div>
            </div>
        </AiElementsToolContent>
    </AiElementsTool>
</template>
