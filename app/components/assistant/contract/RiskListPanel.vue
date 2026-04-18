<script setup lang="ts">
import { DownloadIcon, ChevronDownIcon } from 'lucide-vue-next'
import type { Risk, ContractReviewStatus } from '#shared/types/contract'

const props = defineProps<{
    risks: Risk[]
    status: ContractReviewStatus
    reviewedFileId: number | null
    summary: string | null
}>()

const emit = defineEmits<{
    download: []
}>()

const sorted = computed(() => [...props.risks].sort((a, b) => a.clauseIndex - b.clauseIndex))
const expandedId = ref<string | null>(null)

function toggle(id: string) {
    expandedId.value = expandedId.value === id ? null : id
}

const canDownload = computed(() => props.status === 'completed' && props.reviewedFileId !== null)

const LEVEL_LABEL: Record<Risk['level'], string> = {
    high: '高',
    medium: '中',
    low: '低',
}

const LEVEL_CLASS: Record<Risk['level'], string> = {
    high: 'bg-red-500 text-white',
    medium: 'bg-orange-500 text-white',
    low: 'bg-gray-400 text-white',
}
</script>

<template>
    <div class="flex flex-col h-full">
        <div v-if="summary" class="p-3 border-b text-sm text-muted-foreground whitespace-pre-wrap">{{ summary }}</div>
        <ScrollArea class="flex-1">
            <div v-if="!sorted.length" class="p-6 text-sm text-muted-foreground text-center">暂无风险条目</div>
            <div v-else class="p-3 space-y-2">
                <Card v-for="r in sorted" :key="r.id" class="cursor-pointer" @click="toggle(r.id)">
                    <CardHeader class="py-2 px-3">
                        <div class="flex items-center gap-2">
                            <span class="inline-block px-2 py-0.5 rounded text-xs" :class="LEVEL_CLASS[r.level]">
                                {{ LEVEL_LABEL[r.level] }}
                            </span>
                            <span class="text-sm font-medium">{{ r.category }}</span>
                            <ChevronDownIcon
                                class="ml-auto size-4 transition-transform"
                                :class="{ 'rotate-180': expandedId === r.id }"
                            />
                        </div>
                        <div class="mt-1 text-xs text-muted-foreground line-clamp-2">{{ r.problem }}</div>
                    </CardHeader>
                    <CardContent v-if="expandedId === r.id" class="py-2 px-3 text-sm space-y-3">
                        <AssistantContractRiskClauseDiff
                            :clause-text="r.clauseText"
                            :suggested-clause-text="r.suggestedClauseText"
                        />
                        <div v-if="r.legalBasis">
                            <div class="text-xs text-muted-foreground">法律依据</div>
                            <div>{{ r.legalBasis }}</div>
                        </div>
                        <div>
                            <div class="text-xs text-muted-foreground">条款分析</div>
                            <div class="whitespace-pre-wrap">{{ r.analysis }}</div>
                        </div>
                        <div>
                            <div class="text-xs text-muted-foreground">法律风险</div>
                            <div class="whitespace-pre-wrap">{{ r.risk }}</div>
                        </div>
                        <div>
                            <div class="text-xs text-muted-foreground">修改建议</div>
                            <div class="whitespace-pre-wrap">{{ r.suggestion }}</div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </ScrollArea>
        <div class="p-3 border-t">
            <Button class="w-full" :disabled="!canDownload" @click="emit('download')">
                <DownloadIcon class="size-4 mr-1" />下载批注 Word
            </Button>
        </div>
    </div>
</template>
