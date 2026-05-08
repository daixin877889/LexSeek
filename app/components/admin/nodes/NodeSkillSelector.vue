<template>
    <!-- 节点 Skills 多选 chip 组件 -->
    <div class="space-y-2">
        <div v-if="loading" class="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 class="h-4 w-4 animate-spin" />
            加载 skills...
        </div>

        <div v-else-if="availableSkills.length === 0" class="text-sm text-muted-foreground">
            暂无可用 Skill（请先在 Skills 管理页扫描）
        </div>

        <template v-else>
            <!-- 已选 Skills chip 展示 -->
            <div v-if="modelValue.length" class="flex flex-wrap gap-2">
                <Badge
                    v-for="name in modelValue"
                    :key="name"
                    variant="secondary"
                    class="cursor-pointer"
                    @click="toggleSkill(name)"
                >
                    {{ name }}
                    <X class="h-3 w-3 ml-1" />
                </Badge>
            </div>

            <!-- Skills 列表 -->
            <div class="border rounded-md max-h-48 overflow-y-auto">
                <div
                    v-for="skill in availableSkills"
                    :key="skill.name"
                    class="flex items-start gap-3 p-3 hover:bg-muted/50 cursor-pointer border-b last:border-b-0"
                    :class="skill.status === 0 ? 'opacity-50' : ''"
                    @click="toggleSkill(skill.name)"
                >
                    <!-- 勾选框 -->
                    <div
                        class="size-4 shrink-0 mt-0.5 flex items-center justify-center rounded border"
                        :class="modelValue.includes(skill.name) ? 'bg-primary border-primary text-primary-foreground' : 'border-input'"
                    >
                        <Check v-if="modelValue.includes(skill.name)" class="size-3" />
                    </div>
                    <!-- Skill 信息 -->
                    <div class="flex-1 min-w-0">
                        <div class="font-medium text-sm font-mono">{{ skill.name }}</div>
                        <div v-if="skill.title" class="text-xs text-muted-foreground">{{ skill.title }}</div>
                        <div v-if="skill.status === 0" class="text-xs text-destructive">已停用</div>
                    </div>
                </div>
            </div>
        </template>
        <p class="text-xs text-muted-foreground">选择节点启用的 Skills（已停用的 skill 关联后不会生效）</p>
    </div>
</template>

<script setup lang="ts">
import { Check, Loader2, X } from 'lucide-vue-next'
import { useApiFetch } from '~/composables/useApiFetch'

const props = defineProps<{
    /** 当前已选的 skill 名称列表 */
    modelValue: string[]
}>()

const emit = defineEmits<{
    'update:modelValue': [value: string[]]
}>()

interface SkillOption {
    name: string
    title: string | null
    status: number
}

const availableSkills = ref<SkillOption[]>([])
const loading = ref(false)

async function loadSkills() {
    loading.value = true
    try {
        const data = await useApiFetch<SkillOption[]>('/api/v1/admin/skills')
        if (data) availableSkills.value = data
    } finally {
        loading.value = false
    }
}

function toggleSkill(name: string) {
    const current = [...props.modelValue]
    const idx = current.indexOf(name)
    if (idx === -1) {
        current.push(name)
    } else {
        current.splice(idx, 1)
    }
    emit('update:modelValue', current)
}

onMounted(loadSkills)
</script>
