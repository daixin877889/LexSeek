<template>
    <Dialog v-model:open="open">
        <DialogContent class="max-w-md" @interactOutside="(e) => e.preventDefault()">
            <DialogHeader>
                <DialogTitle>编辑中文名</DialogTitle>
                <DialogDescription class="sr-only">编辑 skill 中文展示名</DialogDescription>
            </DialogHeader>
            <div class="space-y-4 py-2">
                <div class="space-y-2">
                    <Label>英文标识</Label>
                    <Input :model-value="skillName" disabled class="font-mono" />
                </div>
                <div class="space-y-2">
                    <Label>中文名</Label>
                    <Input
                        v-model="form.customTitle"
                        placeholder="留空使用代码预设"
                        :maxlength="200"
                    />
                    <p class="text-xs text-muted-foreground">
                        留空 / 全空白会清除自定义，回退到 SKILL.md 里的代码默认值。
                    </p>
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" @click="open = false">取消</Button>
                <Button @click="handleSubmit" :disabled="submitting">
                    <Loader2 v-if="submitting" class="h-4 w-4 mr-2 animate-spin" />
                    保存
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useApiFetch } from '~/composables/useApiFetch'

const emit = defineEmits<{ success: [] }>()
const open = defineModel<boolean>('open', { default: false })
const submitting = ref(false)
const skillName = ref('')
const form = ref({ customTitle: '' })

function openEdit(skill: { name: string; customTitle: string | null; title: string | null }) {
    skillName.value = skill.name
    // 编辑框初值优先 customTitle；为 null 时留空（让用户看到的是"覆盖层"内容）
    form.value.customTitle = skill.customTitle ?? ''
    open.value = true
}

async function handleSubmit() {
    submitting.value = true
    try {
        const trimmed = form.value.customTitle.trim()
        const result = await useApiFetch(`/api/v1/admin/skills/${encodeURIComponent(skillName.value)}`, {
            method: 'PATCH',
            body: { customTitle: trimmed === '' ? null : trimmed },
        })
        if (result !== null) {
            toast.success('中文名已更新')
            open.value = false
            emit('success')
        }
    } finally {
        submitting.value = false
    }
}

defineExpose({ openEdit })
</script>
