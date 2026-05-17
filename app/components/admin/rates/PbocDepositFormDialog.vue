<template>
    <Dialog :open="open" @update:open="(v) => $emit('update:open', v)">
        <DialogContent class="theme-brand">
            <DialogHeader>
                <DialogTitle>{{ isEdit ? '编辑' : '新增' }} PBOC 存款利率</DialogTitle>
                <DialogDescription>人民银行公布的存款基准利率，% 单位（如 0.35 表示 0.35%）</DialogDescription>
            </DialogHeader>

            <div class="space-y-4">
                <div class="space-y-1.5">
                    <Label><span class="text-destructive">*</span> 生效日</Label>
                    <DatePicker v-model="form.effectDate" placeholder="选择生效日" :class="adminBrandFocusClass" />
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div class="space-y-1.5">
                        <Label><span class="text-destructive">*</span> 活期 (%)</Label>
                        <Input v-model.number="form.demand" type="number" step="0.01" :class="adminBrandFocusClass" />
                    </div>
                    <div class="space-y-1.5">
                        <Label><span class="text-destructive">*</span> 三月 (%)</Label>
                        <Input v-model.number="form.threeMonths" type="number" step="0.01" :class="adminBrandFocusClass" />
                    </div>
                    <div class="space-y-1.5">
                        <Label><span class="text-destructive">*</span> 六月 (%)</Label>
                        <Input v-model.number="form.sixMonths" type="number" step="0.01" :class="adminBrandFocusClass" />
                    </div>
                    <div class="space-y-1.5">
                        <Label><span class="text-destructive">*</span> 一年 (%)</Label>
                        <Input v-model.number="form.oneYear" type="number" step="0.01" :class="adminBrandFocusClass" />
                    </div>
                    <div class="space-y-1.5">
                        <Label><span class="text-destructive">*</span> 二年 (%)</Label>
                        <Input v-model.number="form.twoYear" type="number" step="0.01" :class="adminBrandFocusClass" />
                    </div>
                    <div class="space-y-1.5">
                        <Label><span class="text-destructive">*</span> 三年 (%)</Label>
                        <Input v-model.number="form.threeYear" type="number" step="0.01" :class="adminBrandFocusClass" />
                    </div>
                    <div class="space-y-1.5">
                        <Label><span class="text-destructive">*</span> 五年 (%)</Label>
                        <Input v-model.number="form.fiveYear" type="number" step="0.01" :class="adminBrandFocusClass" />
                    </div>
                </div>
                <div class="space-y-1.5">
                    <Label>备注（可选）</Label>
                    <Input v-model="form.remark" placeholder="" :class="adminBrandFocusClass" />
                </div>
            </div>

            <DialogFooter>
                <Button variant="outline" :class="adminBrandFocusClass" @click="$emit('update:open', false)">取消</Button>
                <Button :class="adminBrandPrimaryButtonClass" :disabled="saving" @click="onSave">保存</Button>
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
import type { DepositRate } from '#shared/types/tools'
import { adminBrandFocusClass, adminBrandPrimaryButtonClass } from '~/utils/adminBrandStyles'

interface Row extends DepositRate { id: number; remark?: string }

const props = defineProps<{ open: boolean; model: Row | null }>()
const emit = defineEmits<{ 'update:open': [boolean]; 'saved': [] }>()

const alertDialog = useAlertDialogStore()
const isEdit = computed(() => props.model !== null)
const saving = ref(false)

const form = reactive({
    effectDate: '',
    demand: 0,
    threeMonths: 0,
    sixMonths: 0,
    oneYear: 0,
    twoYear: 0,
    threeYear: 0,
    fiveYear: 0,
    remark: '',
})

watchEffect(() => {
    if (props.open && props.model) {
        form.effectDate = props.model.date
        form.demand = props.model.demand
        form.threeMonths = props.model.threeMonths
        form.sixMonths = props.model.sixMonths
        form.oneYear = props.model.oneYear
        form.twoYear = props.model.twoYear
        form.threeYear = props.model.threeYear
        form.fiveYear = props.model.fiveYear
        form.remark = props.model.remark ?? ''
    } else if (props.open) {
        form.effectDate = ''
        form.demand = 0
        form.threeMonths = 0
        form.sixMonths = 0
        form.oneYear = 0
        form.twoYear = 0
        form.threeYear = 0
        form.fiveYear = 0
        form.remark = ''
    }
})

async function onSave() {
    if (!form.effectDate || form.demand <= 0 || form.oneYear <= 0) {
        alertDialog.showErrorDialog({ title: '输入错误', message: '请完整填写生效日和各期利率', showCancel: false })
        return
    }
    saving.value = true
    try {
        const body = {
            effectDate: form.effectDate,
            demand: form.demand,
            threeMonths: form.threeMonths,
            sixMonths: form.sixMonths,
            oneYear: form.oneYear,
            twoYear: form.twoYear,
            threeYear: form.threeYear,
            fiveYear: form.fiveYear,
            remark: form.remark || undefined,
        }
        if (isEdit.value && props.model) {
            await useApiFetch(`/api/v1/admin/rates/pboc-deposit/${props.model.id}`, {
                method: 'PATCH',
                body,
            })
        } else {
            await useApiFetch('/api/v1/admin/rates/pboc-deposit', {
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
