<template>
    <AiElementsConfirmation :approval="approval" :state="confirmationState" class="w-full min-w-0">
        <!-- 请求状态：可编辑表单 -->
        <AiElementsConfirmationRequest>
            <div class="w-full space-y-4">
                <div class="space-y-1">
                    <AiElementsConfirmationTitle class="flex items-center gap-2 text-base font-medium">
                        <ClipboardCheckIcon class="h-5 w-5 text-primary" />
                        案件信息确认
                    </AiElementsConfirmationTitle>
                    <p class="text-sm text-muted-foreground">
                        以下信息从材料中自动提取，请核对并修改
                    </p>
                </div>

                <div class="space-y-4">
                    <!-- 案件标题 -->
                    <div class="space-y-2">
                        <Label for="extract-title">案件标题</Label>
                        <Input id="extract-title" v-model="formData.title" placeholder="请输入案件标题" />
                    </div>

                    <!-- 案件类型 -->
                    <div class="space-y-2">
                        <Label for="extract-case-type">案件类型</Label>
                        <Input id="extract-case-type" v-model="formData.caseType" placeholder="请输入案件类型" />
                    </div>

                    <!-- 原告 -->
                    <div class="space-y-2">
                        <Label>原告</Label>
                        <div class="space-y-2">
                            <div v-for="(_, index) in formData.plaintiff" :key="`plaintiff-${index}`"
                                class="flex items-center gap-2">
                                <Input v-model="formData.plaintiff[index]" placeholder="原告名称" class="flex-1" />
                                <Button v-if="formData.plaintiff.length > 1" variant="ghost" size="icon"
                                    class="h-9 w-9 shrink-0" @click="removePlaintiff(index)">
                                    <XIcon class="h-4 w-4" />
                                </Button>
                            </div>
                            <Button variant="outline" size="sm" @click="addPlaintiff">
                                <PlusIcon class="h-4 w-4 mr-1" />
                                添加原告
                            </Button>
                        </div>
                    </div>

                    <!-- 被告 -->
                    <div class="space-y-2">
                        <Label>被告</Label>
                        <div class="space-y-2">
                            <div v-for="(_, index) in formData.defendant" :key="`defendant-${index}`"
                                class="flex items-center gap-2">
                                <Input v-model="formData.defendant[index]" placeholder="被告名称" class="flex-1" />
                                <Button v-if="formData.defendant.length > 1" variant="ghost" size="icon"
                                    class="h-9 w-9 shrink-0" @click="removeDefendant(index)">
                                    <XIcon class="h-4 w-4" />
                                </Button>
                            </div>
                            <Button variant="outline" size="sm" @click="addDefendant">
                                <PlusIcon class="h-4 w-4 mr-1" />
                                添加被告
                            </Button>
                        </div>
                    </div>

                    <!-- 案件摘要 -->
                    <div class="space-y-2">
                        <Label for="extract-summary">案件摘要</Label>
                        <Textarea id="extract-summary" v-model="formData.summary" placeholder="请输入案件摘要"
                            class="min-h-[80px] resize-none" />
                    </div>

                    <!-- 扩展字段 -->
                    <div v-if="formData.extraFields.length > 0" class="space-y-3">
                        <Label class="text-muted-foreground">扩展信息</Label>
                        <div v-for="(field, index) in formData.extraFields" :key="`extra-${index}`"
                            class="flex items-start gap-2">
                            <div class="flex-1 space-y-1">
                                <Input v-model="field.title" placeholder="字段名称"
                                    class="text-sm" />
                                <Input v-model="field.value" placeholder="字段值"
                                    class="text-sm" />
                            </div>
                            <Button variant="ghost" size="icon" class="h-9 w-9 shrink-0 mt-0.5"
                                @click="removeExtraField(index)">
                                <XIcon class="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                    <Button variant="outline" size="sm" @click="addExtraField">
                        <PlusIcon class="h-4 w-4 mr-1" />
                        添加字段
                    </Button>
                </div>

                <!-- 操作按钮 -->
                <AiElementsConfirmationActions class="pt-2">
                    <AiElementsConfirmationAction variant="outline" @click="handleReject">
                        取消
                    </AiElementsConfirmationAction>
                    <AiElementsConfirmationAction @click="handleConfirm" :disabled="!canSubmit">
                        确认信息
                    </AiElementsConfirmationAction>
                </AiElementsConfirmationActions>
            </div>
        </AiElementsConfirmationRequest>

        <!-- 已确认：只读信息展示 -->
        <AiElementsConfirmationAccepted>
            <div class="space-y-3">
                <div class="flex items-center gap-2 text-green-600">
                    <CheckCircleIcon class="h-5 w-5" />
                    <span class="font-medium">案件信息已确认</span>
                </div>
                <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div v-if="confirmedData?.title">
                        <span class="text-muted-foreground">案件标题</span>
                        <p>{{ confirmedData.title }}</p>
                    </div>
                    <div v-if="confirmedData?.caseType">
                        <span class="text-muted-foreground">案件类型</span>
                        <p>{{ confirmedData.caseType }}</p>
                    </div>
                    <div v-if="confirmedData?.plaintiff?.length">
                        <span class="text-muted-foreground">原告</span>
                        <p>{{ confirmedData.plaintiff.join('、') }}</p>
                    </div>
                    <div v-if="confirmedData?.defendant?.length">
                        <span class="text-muted-foreground">被告</span>
                        <p>{{ confirmedData.defendant.join('、') }}</p>
                    </div>
                    <div v-if="confirmedData?.summary" class="col-span-2">
                        <span class="text-muted-foreground">案件摘要</span>
                        <p class="line-clamp-3">{{ confirmedData.summary }}</p>
                    </div>
                    <template v-if="confirmedData?.extraFields?.length">
                        <div v-for="field in confirmedData.extraFields" :key="field.name" class="col-span-2">
                            <span class="text-muted-foreground">{{ field.title }}</span>
                            <p>{{ field.value }}</p>
                        </div>
                    </template>
                </div>
            </div>
        </AiElementsConfirmationAccepted>

        <!-- 已拒绝 -->
        <AiElementsConfirmationRejected>
            <div class="flex items-center gap-2 text-muted-foreground">
                <XCircleIcon class="h-5 w-5" />
                <span>已取消信息确认</span>
            </div>
        </AiElementsConfirmationRejected>
    </AiElementsConfirmation>
</template>

<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'
import type { ToolUIPartApproval } from '@/components/ai-elements/confirmation/context'
import type { ExtractedCaseInfo, ExtraField } from '#shared/types/case'
import {
    ClipboardCheckIcon,
    XIcon,
    PlusIcon,
    CheckCircleIcon,
    XCircleIcon,
} from 'lucide-vue-next'

const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: ExtendedToolState
}>()

const emit = defineEmits<{
    confirm: [caseInfo: ExtractedCaseInfo]
    reject: []
}>()

// Confirmation 组件状态
const approval = ref<ToolUIPartApproval>({ id: 'extract-info' })
const confirmationState = ref<ExtendedToolState>('approval-requested')
const confirmedData = ref<ExtractedCaseInfo | null>(null)

// 从 output 解析案件信息
// 兼容两种格式：
// 1. 直接数据: {title, plaintiff, defendant, ...}
// 2. 嵌套数据: {data: {title, ...}} 或 {result: {title, ...}}
const parsedOutput = computed(() => {
    if (!props.output) return null
    try {
        const raw = typeof props.output === 'string' ? JSON.parse(props.output) : props.output
        // 如果是 extractionGuide（有 instruction 字段），说明是提取指南不是数据
        if (raw?.instruction) return null
        // 尝试常见嵌套路径
        return raw?.data ?? raw?.result ?? raw
    } catch { return null }
})

// 表单数据
const formData = ref<ExtractedCaseInfo>(createFormData())

function createFormData(): ExtractedCaseInfo {
    const data = parsedOutput.value
    return {
        title: data?.title || '',
        plaintiff: data?.plaintiff?.length ? [...data.plaintiff] : [''],
        defendant: data?.defendant?.length ? [...data.defendant] : [''],
        caseType: data?.caseType || '',
        summary: data?.summary || '',
        extraFields: data?.extraFields?.length
            ? data.extraFields.map((f: ExtraField) => ({ ...f }))
            : [],
    }
}

// 监听 output 变化，重新初始化表单
watch(
    () => props.output,
    () => {
        if (confirmationState.value === 'approval-requested') {
            formData.value = createFormData()
        }
    },
)

const canSubmit = computed(() => {
    return formData.value.title.trim().length > 0
        && formData.value.plaintiff.some(p => p.trim().length > 0)
        && formData.value.defendant.some(d => d.trim().length > 0)
})

const addPlaintiff = () => {
    formData.value.plaintiff.push('')
}

const removePlaintiff = (index: number) => {
    if (formData.value.plaintiff.length > 1) {
        formData.value.plaintiff.splice(index, 1)
    }
}

const addDefendant = () => {
    formData.value.defendant.push('')
}

const removeDefendant = (index: number) => {
    if (formData.value.defendant.length > 1) {
        formData.value.defendant.splice(index, 1)
    }
}

const addExtraField = () => {
    formData.value.extraFields.push({ name: '', title: '', value: '' })
}

const removeExtraField = (index: number) => {
    formData.value.extraFields.splice(index, 1)
}

function handleConfirm() {
    if (!canSubmit.value) return

    const cleaned: ExtractedCaseInfo = {
        title: formData.value.title.trim(),
        plaintiff: formData.value.plaintiff.filter(p => p.trim().length > 0),
        defendant: formData.value.defendant.filter(d => d.trim().length > 0),
        caseType: formData.value.caseType.trim(),
        summary: formData.value.summary.trim(),
        extraFields: formData.value.extraFields
            .filter(f => f.title.trim() && f.value.trim())
            .map(f => ({
                name: f.name.trim() || f.title.trim().replace(/\s+/g, ''),
                title: f.title.trim(),
                value: f.value.trim(),
            })),
    }

    confirmedData.value = cleaned
    approval.value = { id: 'extract-info', approved: true }
    confirmationState.value = 'approval-responded'

    emit('confirm', cleaned)
}

function handleReject() {
    approval.value = { id: 'extract-info', approved: false, reason: '用户取消' }
    confirmationState.value = 'approval-responded'
    emit('reject')
}
</script>
