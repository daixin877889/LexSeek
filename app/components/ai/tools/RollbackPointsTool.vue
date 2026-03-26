<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'
import { Undo2Icon, XCircleIcon } from 'lucide-vue-next'

const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: ExtendedToolState
}>()

const parsedOutput = computed(() => {
    if (props.output == null) return null
    try {
        return typeof props.output === 'string' ? JSON.parse(props.output) : props.output
    } catch { return null }
})

const isSuccess = computed(() => parsedOutput.value?.success === true)
const isError = computed(() => parsedOutput.value != null && !isSuccess.value)
</script>

<template>
    <AiElementsTool>
        <AiElementsToolHeader title="积分回滚" type="tool-rollback_points" :state="state" />
        <AiElementsToolContent v-if="parsedOutput">
            <div class="p-4">
                <div v-if="isSuccess" class="flex items-center gap-2 text-sm">
                    <Undo2Icon class="size-4 text-blue-600 shrink-0" />
                    <span>积分已退还</span>
                    <Badge variant="secondary" class="ml-auto">+{{ parsedOutput.releasedAmount }} 积分</Badge>
                </div>
                <div v-else-if="isError" class="flex items-center gap-2 text-sm text-destructive">
                    <XCircleIcon class="size-4 shrink-0" />
                    <span>{{ parsedOutput.error || parsedOutput.message || '积分回滚失败' }}</span>
                </div>
            </div>
        </AiElementsToolContent>
    </AiElementsTool>
</template>
