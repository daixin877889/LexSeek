<template>
    <div>
        <div v-if="!editing" class="space-y-2">
            <p class="text-sm whitespace-pre-wrap text-muted-foreground">
                {{ modelValue || '（暂无管理员备注）' }}
            </p>
            <p v-if="updaterName || updatedAt" class="text-xs text-muted-foreground">
                — {{ updaterName ?? '系统' }} {{ updatedAt ? formatDate(updatedAt) : '' }}
            </p>
            <Button size="sm" variant="outline" @click="startEdit">
                <Pencil class="w-3 h-3 mr-1" /> 编辑
            </Button>
        </div>
        <div v-else class="space-y-2">
            <Textarea v-model="draft" rows="3" placeholder="管理员内部备注（仅后台可见）" :maxlength="500"
                :class="brandFocusClass" />
            <div class="flex gap-2">
                <Button size="sm" :class="primaryButtonClass" :disabled="saving" @click="save">
                    <Loader2 v-if="saving" class="w-3 h-3 mr-1 animate-spin" /> 保存
                </Button>
                <Button size="sm" variant="ghost" @click="editing = false">取消</Button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Pencil, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { useApiFetch } from '~/composables/useApiFetch'
import { useFormatters } from '~/composables/useFormatters'

const { formatDate: formatDateRaw } = useFormatters()

const props = defineProps<{
    apiUrl: string
    modelValue: string | null
    updaterName?: string | null
    updatedAt?: Date | string | null
}>()
const emit = defineEmits<{ saved: [newRemark: string | null] }>()

const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const brandFocusClass = 'brand-control-focus'
const primaryButtonClass = 'bg-gradient-brand-button text-white brand-control-focus hover:brightness-105'

function startEdit() {
    draft.value = props.modelValue ?? ''
    editing.value = true
}

async function save() {
    saving.value = true
    try {
        const body = { remark: draft.value.trim() || null }
        const result = await useApiFetch(props.apiUrl, { method: 'PATCH', body })
        if (result) {
            toast.success('备注已更新')
            emit('saved', body.remark)
            editing.value = false
        }
    } finally {
        saving.value = false
    }
}

function formatDate(d: Date | string) { return formatDateRaw(String(d)) }
</script>
