<script setup lang="ts">
const props = defineProps<{
    caseInfo: {
        title?: string
        plaintiff?: string[]
        defendant?: string[]
        caseType?: string
        summary?: string
        caseNumber?: string
        court?: string
        causeOfAction?: string
        amount?: string
    }
}>()

const emit = defineEmits<{
    confirm: [data: typeof props.caseInfo]
    reject: []
}>()

const editForm = reactive({ ...props.caseInfo })

function handleConfirm() {
    emit('confirm', { ...editForm })
}
</script>

<template>
    <AiElementsConfirmation>
        <AiElementsConfirmationRequest>
            <div class="space-y-3">
                <h3 class="font-medium">案件基础信息确认</h3>
                <div class="grid grid-cols-2 gap-3 text-sm">
                    <div>
                        <label class="text-muted-foreground">案件名称</label>
                        <Input v-model="editForm.title" />
                    </div>
                    <div>
                        <label class="text-muted-foreground">案件类型</label>
                        <Input v-model="editForm.caseType" />
                    </div>
                    <div>
                        <label class="text-muted-foreground">原告</label>
                        <Input :model-value="editForm.plaintiff?.join('、')" @update:model-value="v => editForm.plaintiff = v.split('、')" />
                    </div>
                    <div>
                        <label class="text-muted-foreground">被告</label>
                        <Input :model-value="editForm.defendant?.join('、')" @update:model-value="v => editForm.defendant = v.split('、')" />
                    </div>
                    <div class="col-span-2">
                        <label class="text-muted-foreground">案件概述</label>
                        <Textarea v-model="editForm.summary" :rows="2" />
                    </div>
                </div>
            </div>
        </AiElementsConfirmationRequest>
        <AiElementsConfirmationActions>
            <Button variant="outline" @click="emit('reject')">取消</Button>
            <Button @click="handleConfirm">确认信息</Button>
        </AiElementsConfirmationActions>
    </AiElementsConfirmation>
</template>
