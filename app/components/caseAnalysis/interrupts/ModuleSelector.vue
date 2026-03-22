<script setup lang="ts">
interface AnalysisModule {
    key: string
    name: string
    description?: string
    points: number
    requiresMembership?: boolean
}

const props = defineProps<{
    modules: AnalysisModule[]
}>()

const emit = defineEmits<{
    confirm: [selectedModules: string[]]
    reject: []
}>()

const selectedModules = ref<string[]>(
    props.modules.map(m => m.key)
)

function toggleModule(key: string) {
    const idx = selectedModules.value.indexOf(key)
    if (idx >= 0) {
        selectedModules.value.splice(idx, 1)
    } else {
        selectedModules.value.push(key)
    }
}

const totalPoints = computed(() =>
    props.modules
        .filter(m => selectedModules.value.includes(m.key))
        .reduce((sum, m) => sum + m.points, 0)
)
</script>

<template>
    <AiElementsConfirmationConfirmation>
        <AiElementsConfirmationConfirmationRequest>
            <div class="space-y-3">
                <h3 class="font-medium">选择分析模块</h3>
                <div class="space-y-2">
                    <div
                        v-for="m in modules"
                        :key="m.key"
                        class="flex items-center justify-between p-2 border rounded cursor-pointer hover:bg-accent"
                        :class="{ 'border-primary bg-accent/50': selectedModules.includes(m.key) }"
                        @click="toggleModule(m.key)"
                    >
                        <div class="flex items-center gap-2">
                            <Checkbox :checked="selectedModules.includes(m.key)" />
                            <span>{{ m.name }}</span>
                            <Badge v-if="m.requiresMembership" variant="outline" class="text-xs">会员</Badge>
                        </div>
                        <Badge variant="secondary">{{ m.points }} 积分</Badge>
                    </div>
                </div>
                <div class="text-sm text-muted-foreground">
                    已选 {{ selectedModules.length }} 个模块，共需 {{ totalPoints }} 积分
                </div>
            </div>
        </AiElementsConfirmationConfirmationRequest>
        <AiElementsConfirmationConfirmationActions>
            <Button variant="outline" @click="emit('reject')">取消</Button>
            <Button :disabled="selectedModules.length === 0" @click="emit('confirm', selectedModules)">
                开始分析
            </Button>
        </AiElementsConfirmationConfirmationActions>
    </AiElementsConfirmationConfirmation>
</template>
