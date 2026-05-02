<template>
    <!-- Skill 启停开关 -->
    <Switch
        :model-value="modelValue === 1"
        :disabled="loading"
        @update:model-value="handleChange"
    />
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import { useApiFetch } from '~/composables/useApiFetch'

const props = defineProps<{
    /** 当前状态：1=启用，0=停用 */
    modelValue: number
    /** Skill 名称（API 路径参数） */
    skillName: string
}>()

const emit = defineEmits<{
    'update:modelValue': [value: number]
}>()

const loading = ref(false)

async function handleChange(checked: boolean) {
    const newStatus = checked ? 1 : 0
    loading.value = true
    try {
        const result = await useApiFetch(
            `/api/v1/admin/skills/status/${encodeURIComponent(props.skillName)}`,
            { method: 'PATCH', body: { status: newStatus } }
        )
        if (result !== null) {
            emit('update:modelValue', newStatus)
            toast.success(checked ? `已启用 ${props.skillName}` : `已停用 ${props.skillName}`)
        }
    } finally {
        loading.value = false
    }
}
</script>
