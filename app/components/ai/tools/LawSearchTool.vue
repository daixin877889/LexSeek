<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'
import { HoverCardTrigger } from '@/components/ui/hover-card'

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

function formatChapter(hierarchy: unknown): string {
    if (Array.isArray(hierarchy)) return hierarchy.join(' > ')
    if (typeof hierarchy === 'string') return hierarchy
    return ''
}
</script>

<template>
    <AiElementsTool>
        <AiElementsToolHeader title="法律检索" type="tool-search_law" :state="state">
            <template v-if="state === 'output-available' && results.length" #extra>
                <span class="text-xs text-muted-foreground">找到 {{ results.length }} 条结果</span>
            </template>
        </AiElementsToolHeader>
        <AiElementsToolContent v-if="input || output != null">
            <div class="p-4 space-y-3">
                <div v-if="input" class="flex items-center gap-2">
                    <Badge v-if="input.legalType" variant="outline">{{ input.legalType }}</Badge>
                    <Badge variant="secondary">{{ input.query || input.keyword }}</Badge>
                </div>
                <div v-if="results.length" class="space-y-3">
                    <div v-for="(item, index) in results" :key="index" class="space-y-1.5">
                        <AiElementsInlineCitation>
                            <AiElementsInlineCitationCard :open-delay="200" :close-delay="100">
                                <HoverCardTrigger as-child>
                                    <Badge variant="secondary" class="cursor-pointer">
                                        {{ item.metadata?.legal_name || '未知法律' }}
                                    </Badge>
                                </HoverCardTrigger>
                                <AiElementsInlineCitationCardBody>
                                    <div class="space-y-2 p-3">
                                        <AiElementsInlineCitationSource
                                            :title="item.metadata?.legal_name"
                                            :description="formatChapter(item.metadata?.chapter_hierarchy) || item.metadata?.document_number"
                                        />
                                        <AiElementsInlineCitationQuote v-if="item.content">
                                            {{ item.content.slice(0, 200) }}{{ item.content.length > 200 ? '...' : '' }}
                                        </AiElementsInlineCitationQuote>
                                    </div>
                                </AiElementsInlineCitationCardBody>
                            </AiElementsInlineCitationCard>
                            <AiElementsInlineCitationText v-if="formatChapter(item.metadata?.chapter_hierarchy)">
                                {{ formatChapter(item.metadata?.chapter_hierarchy) }}
                            </AiElementsInlineCitationText>
                        </AiElementsInlineCitation>
                        <AiElementsCodeBlock :code="item.content || ''" language="json">
                            <AiElementsCodeBlockCopyButton />
                        </AiElementsCodeBlock>
                    </div>
                </div>
                <div v-else-if="state === 'output-available'" class="text-sm text-muted-foreground">
                    未检索到结果
                </div>
            </div>
        </AiElementsToolContent>
    </AiElementsTool>
</template>
