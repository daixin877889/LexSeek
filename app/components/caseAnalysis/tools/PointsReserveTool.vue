<script setup lang="ts">
const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: string
}>()

const reservations = computed(() => {
    try {
        const data = typeof props.output === 'string' ? JSON.parse(props.output) : props.output
        return data?.reservations || []
    } catch { return [] }
})

const totalAmount = computed(() => {
    try {
        const data = typeof props.output === 'string' ? JSON.parse(props.output) : props.output
        return data?.totalAmount || 0
    } catch { return 0 }
})
</script>

<template>
    <AiElementsTool>
        <AiElementsToolHeader name="积分预扣" :state="state" />
        <AiElementsToolContent v-if="output">
            <AiElementsToolOutput>
                <div class="space-y-2">
                    <div v-for="r in reservations" :key="r.batchId" class="flex items-center justify-between text-sm">
                        <span>{{ r.itemName || r.module }}</span>
                        <Badge variant="destructive">-{{ r.amount }} 积分</Badge>
                    </div>
                    <Separator />
                    <div class="flex justify-between text-sm font-medium">
                        <span>总计</span>
                        <span>{{ totalAmount }} 积分</span>
                    </div>
                </div>
            </AiElementsToolOutput>
        </AiElementsToolContent>
    </AiElementsTool>
</template>
