<script setup lang="ts">
/**
 * 立场选择对话框
 *
 * 合同提交后后端识别出 partyA / partyB / contractType，用户在此
 * 确认甲乙方（可编辑）并选择自己代表的立场（甲方/乙方/中立）。
 * 确认后 emit `confirm(StanceRequest)`，父组件据此继续流程。
 */
import type { Stance, StanceRequest } from '#shared/types/contract'

const props = defineProps<{
    open: boolean
    partyA: string | null
    partyB: string | null
    contractType: string | null
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
    confirm: [payload: StanceRequest]
    cancel: []
}>()

// 表单本地状态：初始值从 props 读入，open 由 false→true 时重置
const partyAInput = ref(props.partyA ?? '')
const partyBInput = ref(props.partyB ?? '')
const stance = ref<Stance | null>(null)

// 仅在对话框"打开"时重置表单，避免关闭态下 props 抖动覆盖用户输入
watch(
    () => props.open,
    (isOpen, wasOpen) => {
        if (isOpen && !wasOpen) {
            partyAInput.value = props.partyA ?? ''
            partyBInput.value = props.partyB ?? ''
            stance.value = null
        }
    },
)

const canSubmit = computed(() => stance.value !== null)

function handleConfirm() {
    if (!canSubmit.value) return
    const trimmedA = partyAInput.value.trim()
    const trimmedB = partyBInput.value.trim()
    emit('confirm', {
        stance: stance.value!,
        partyA: trimmedA || undefined,
        partyB: trimmedB || undefined,
    })
    emit('update:open', false)
}

function handleCancel() {
    emit('cancel')
    emit('update:open', false)
}
</script>

<template>
    <Dialog :open="open" @update:open="(v: boolean) => emit('update:open', v)">
        <DialogContent class="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>选择审查立场</DialogTitle>
                <DialogDescription>
                    <template v-if="contractType">
                        已识别合同类型：<span class="font-medium text-foreground">{{ contractType }}</span>
                    </template>
                    <template v-else>未识别到明确的合同类型，可继续审查</template>
                </DialogDescription>
            </DialogHeader>

            <div class="space-y-4">
                <div class="space-y-2">
                    <Label for="stance-party-a">甲方名称</Label>
                    <Input id="stance-party-a" v-model="partyAInput" placeholder="请填写甲方名称（可留空）" />
                </div>
                <div class="space-y-2">
                    <Label for="stance-party-b">乙方名称</Label>
                    <Input id="stance-party-b" v-model="partyBInput" placeholder="请填写乙方名称（可留空）" />
                </div>
                <div class="space-y-2">
                    <Label>您代表哪一方进行审查？</Label>
                    <RadioGroup v-model="stance" class="flex gap-6">
                        <div class="flex items-center gap-2">
                            <RadioGroupItem id="stance-a" value="partyA" />
                            <Label for="stance-a">甲方</Label>
                        </div>
                        <div class="flex items-center gap-2">
                            <RadioGroupItem id="stance-b" value="partyB" />
                            <Label for="stance-b">乙方</Label>
                        </div>
                        <div class="flex items-center gap-2">
                            <RadioGroupItem id="stance-n" value="neutral" />
                            <Label for="stance-n">中立</Label>
                        </div>
                    </RadioGroup>
                </div>
            </div>

            <DialogFooter>
                <Button variant="outline" @click="handleCancel">取消</Button>
                <Button :disabled="!canSubmit" class="bg-gradient-brand-button text-white" @click="handleConfirm">确认</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
