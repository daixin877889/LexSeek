<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'

const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: ExtendedToolState
}>()

const parsedOutput = computed(() => {
    try {
        return typeof props.output === 'string' ? JSON.parse(props.output) : props.output
    } catch { return null }
})

const reservations = computed(() => parsedOutput.value?.reservations || [])
const totalAmount = computed(() => parsedOutput.value?.totalAmount || 0)
const balance = computed(() => parsedOutput.value?.balance ?? null)
</script>

<template>
    <AiElementsTool>
        <AiElementsToolHeader title="积分预扣" type="tool-reserve_points" :state="state" />
        <AiElementsToolContent v-if="output != null">
            <div class="p-4 space-y-2">
                <div v-for="r in reservations" :key="r.batchId" class="flex items-center justify-between text-sm">
                    <span>{{ r.itemName || r.module }}</span>
                    <Badge variant="destructive">-{{ r.amount }} 积分</Badge>
                </div>
                <Separator />
                <div class="flex justify-between text-sm font-medium">
                    <span>总计</span>
                    <span>{{ totalAmount }} 积分</span>
                </div>
                <div v-if="balance !== null" class="flex justify-between text-sm text-muted-foreground">
                    <span>余额</span>
                    <span>{{ balance }} 积分</span>
                </div>
            </div>
        </AiElementsToolContent>
    </AiElementsTool>
</template>
