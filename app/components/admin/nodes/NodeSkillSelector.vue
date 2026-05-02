<template>
    <!-- 节点 Skills 多选 chip 组件 -->
    <div class="flex flex-col gap-2">
        <div v-if="loading" class="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
            <Loader2 class="h-4 w-4 animate-spin" />
            加载 skills...
        </div>

        <div v-else-if="availableSkills.length === 0" class="text-sm text-muted-foreground shrink-0">
            暂无可用 Skill（请先在 Skills 管理页扫描）
        </div>

        <template v-else>
            <!-- 搜索框 -->
            <div class="relative shrink-0">
                <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input v-model="search" placeholder="搜索 Skill 名称或显示名" class="pl-8" />
            </div>

            <!-- 已选 Skills chip 展示 -->
            <div v-if="modelValue.length" class="flex flex-wrap gap-2 shrink-0">
                <Badge
                    v-for="name in modelValue"
                    :key="name"
                    variant="secondary"
                    :class="isStopped(name) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'"
                    @click="toggleSkill(name)"
                >
                    {{ displayLabel(name) }}
                    <X v-if="!isStopped(name)" class="h-3 w-3 ml-1" />
                </Badge>
            </div>

            <!-- Skills 列表（撑满剩余高度） -->
            <div class="flex-1 min-h-0 border rounded-md overflow-y-auto">
                <div v-if="filteredSkills.length === 0" class="p-6 text-center text-sm text-muted-foreground">
                    没有匹配的 Skill
                </div>
                <div
                    v-for="skill in filteredSkills"
                    :key="skill.name"
                    class="flex items-start gap-3 p-3 border-b last:border-b-0"
                    :class="skill.status === 0
                        ? 'cursor-not-allowed opacity-60'
                        : 'cursor-pointer hover:bg-muted/50'"
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
                        <div class="font-medium text-sm">
                            {{ skill.customTitle ?? skill.title ?? skill.name }}
                        </div>
                        <div class="text-xs text-muted-foreground font-mono">{{ skill.name }}</div>
                    </div>
                    <!-- 已停用 标签（右侧同行） -->
                    <Badge
                        v-if="skill.status === 0"
                        variant="outline"
                        class="shrink-0 text-destructive border-destructive/40 mt-0.5"
                    >
                        已停用
                    </Badge>
                </div>
            </div>
        </template>
        <p class="text-xs text-muted-foreground shrink-0">选择节点启用的 Skills（已停用的 skill 不能再改动）</p>
    </div>
</template>

<script setup lang="ts">
import { Check, Loader2, Search, X } from 'lucide-vue-next'
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
    customTitle: string | null
    status: number
}

const availableSkills = ref<SkillOption[]>([])
const loading = ref(false)
const search = ref('')

const filteredSkills = computed(() => {
    const q = search.value.trim().toLowerCase()
    if (!q) return availableSkills.value
    return availableSkills.value.filter((s) => {
        const haystack = [
            s.name,
            s.title ?? '',
            s.customTitle ?? '',
        ].join(' ').toLowerCase()
        return haystack.includes(q)
    })
})

async function loadSkills() {
    loading.value = true
    try {
        const data = await useApiFetch<SkillOption[]>('/api/v1/admin/skills')
        if (data) availableSkills.value = data
    } finally {
        loading.value = false
    }
}

function isStopped(name: string) {
    return availableSkills.value.find(s => s.name === name)?.status === 0
}

function displayLabel(name: string) {
    const skill = availableSkills.value.find(s => s.name === name)
    if (!skill) return name
    return skill.customTitle ?? skill.title ?? skill.name
}

function toggleSkill(name: string) {
    if (isStopped(name)) return
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
