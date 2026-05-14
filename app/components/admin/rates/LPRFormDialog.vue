<template>
    <Dialog :open="open" @update:open="(v) => $emit('update:open', v)">
        <DialogContent>
            <DialogHeader>
                <DialogTitle>{{ isEdit ? '编辑' : '新增' }} LPR 记录</DialogTitle>
                <DialogDescription>央行公布日 1Y / 5Y 利率，% 单位（如 3.50 表示 3.5%）</DialogDescription>
            </DialogHeader>

            <div class="space-y-4">
                <div class="space-y-1.5">
                    <Label>生效日 <span class="text-destructive">*</span></Label>
                    <DatePicker v-model="form.effectDate" placeholder="选择生效日" />
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div class="space-y-1.5">
                        <Label>1 年期 (%) <span class="text-destructive">*</span></Label>
                        <Input v-model.number="form.oneYear" type="number" step="0.01" />
                    </div>
                    <div class="space-y-1.5">
                        <Label>5 年期以上 (%) <span class="text-destructive">*</span></Label>
                        <Input v-model.number="form.fiveYear" type="number" step="0.01" />
                    </div>
                </div>
                <div class="space-y-1.5">
                    <Label>备注（可选）</Label>
                    <Input v-model="form.remark" placeholder="" />
                </div>
            </div>

            <DialogFooter>
                <Button variant="outline" @click="$emit('update:open', false)">取消</Button>
                <Button :disabled="saving" @click="onSave">保存</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import DatePicker from '~/components/general/DatePicker.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useAlertDialogStore } from '~/store/alertDialog'

interface Row { id: number; date: string; oneYear: number; fiveYear: number; remark?: string }

const props = defineProps<{ open: boolean; model: Row | null }>()
const emit = defineEmits<{ 'update:open': [boolean]; 'saved': [] }>()

const alertDialog = useAlertDialogStore()
const isEdit = computed(() => props.model !== null)
const saving = ref(false)

const form = reactive({ effectDate: '', oneYear: 0, fiveYear: 0, remark: '' })

watchEffect(() => {
    if (props.open && props.model) {
        form.effectDate = props.model.date
        form.oneYear = props.model.oneYear
        form.fiveYear = props.model.fiveYear
        form.remark = props.model.remark ?? ''
    } else if (props.open) {
        form.effectDate = ''
        form.oneYear = 0
        form.fiveYear = 0
        form.remark = ''
    }
})

async function onSave() {
    if (!form.effectDate || form.oneYear <= 0 || form.fiveYear <= 0) {
        alertDialog.showErrorDialog({ title: '输入错误', message: '请完整填写生效日和利率', showCancel: false })
        return
    }
    saving.value = true
    try {
        if (isEdit.value && props.model) {
            await useApiFetch(`/api/v1/admin/rates/lpr/${props.model.id}`, {
                method: 'PATCH',
                body: { effectDate: form.effectDate, oneYear: form.oneYear, fiveYear: form.fiveYear, remark: form.remark || null },
            })
        } else {
            await useApiFetch('/api/v1/admin/rates/lpr', {
                method: 'POST',
                body: { effectDate: form.effectDate, oneYear: form.oneYear, fiveYear: form.fiveYear, remark: form.remark || undefined },
            })
        }
        emit('saved')
        emit('update:open', false)
    } finally {
        saving.value = false
    }
}
</script>
