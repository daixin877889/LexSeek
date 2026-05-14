<template>
    <Dialog :open="open" @update:open="(v) => $emit('update:open', v)">
        <DialogContent>
            <DialogHeader>
                <DialogTitle>{{ isEdit ? '编辑' : '新增' }} PBOC 贷款利率</DialogTitle>
                <DialogDescription>人民银行公布的贷款基准利率，% 单位（如 5.60 表示 5.6%）</DialogDescription>
            </DialogHeader>

            <div class="space-y-3">
                <div>
                    <Label>生效日</Label>
                    <Input v-model="form.effectDate" type="date" />
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <Label>六月 (%)</Label>
                        <Input v-model.number="form.sixMonths" type="number" step="0.01" />
                    </div>
                    <div>
                        <Label>一年 (%)</Label>
                        <Input v-model.number="form.oneYear" type="number" step="0.01" />
                    </div>
                    <div>
                        <Label>一至五年 (%)</Label>
                        <Input v-model.number="form.oneToFiveYear" type="number" step="0.01" />
                    </div>
                    <div>
                        <Label>五年以上 (%)</Label>
                        <Input v-model.number="form.fiveYear" type="number" step="0.01" />
                    </div>
                </div>
                <div>
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
import { useApiFetch } from '~/composables/useApiFetch'
import { useAlertDialogStore } from '~/store/alertDialog'
import type { LoanRate } from '#shared/types/tools'

interface Row extends LoanRate { id: number; remark?: string }

const props = defineProps<{ open: boolean; model: Row | null }>()
const emit = defineEmits<{ 'update:open': [boolean]; 'saved': [] }>()

const alertDialog = useAlertDialogStore()
const isEdit = computed(() => props.model !== null)
const saving = ref(false)

const form = reactive({
    effectDate: '',
    sixMonths: 0,
    oneYear: 0,
    oneToFiveYear: 0,
    fiveYear: 0,
    remark: '',
})

watchEffect(() => {
    if (props.open && props.model) {
        form.effectDate = props.model.date
        form.sixMonths = props.model.sixMonths
        form.oneYear = props.model.oneYear
        form.oneToFiveYear = props.model.oneToFiveYear
        form.fiveYear = props.model.fiveYear
        form.remark = props.model.remark ?? ''
    } else if (props.open) {
        form.effectDate = ''
        form.sixMonths = 0
        form.oneYear = 0
        form.oneToFiveYear = 0
        form.fiveYear = 0
        form.remark = ''
    }
})

async function onSave() {
    if (!form.effectDate || form.oneYear <= 0) {
        alertDialog.showErrorDialog({ title: '输入错误', message: '请完整填写生效日和各期利率', showCancel: false })
        return
    }
    saving.value = true
    try {
        const body = {
            effectDate: form.effectDate,
            sixMonths: form.sixMonths,
            oneYear: form.oneYear,
            oneToFiveYear: form.oneToFiveYear,
            fiveYear: form.fiveYear,
            remark: form.remark || undefined,
        }
        if (isEdit.value && props.model) {
            await useApiFetch(`/api/v1/admin/rates/pboc-loan/${props.model.id}`, {
                method: 'PATCH',
                body,
            })
        } else {
            await useApiFetch('/api/v1/admin/rates/pboc-loan', {
                method: 'POST',
                body,
            })
        }
        emit('saved')
        emit('update:open', false)
    } finally {
        saving.value = false
    }
}
</script>
