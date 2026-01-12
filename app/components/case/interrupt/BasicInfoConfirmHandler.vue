<template>
    <AiElementsConfirmationConfirmation :approval="approval" :state="confirmationState" class="w-full">
        <!-- 请求状态：等待用户确认 -->
        <AiElementsConfirmationConfirmationRequest>
            <div class="space-y-4">
                <!-- 标题和说明 -->
                <div class="space-y-2">
                    <AiElementsConfirmationConfirmationTitle class="flex items-center gap-2 text-base font-medium">
                        <ClipboardCheckIcon class="h-5 w-5 text-primary" />
                        {{ interrupt.message || '请确认案件基本信息' }}
                    </AiElementsConfirmationConfirmationTitle>
                    <p class="text-sm text-muted-foreground">
                        系统已从材料中提取以下信息，请核对并修改（如有需要）
                    </p>
                </div>

                <!-- 基本信息表单 -->
                <div class="space-y-4">
                    <!-- 案件标题 -->
                    <div class="space-y-2">
                        <Label for="case-title">案件标题</Label>
                        <Input id="case-title" v-model="formData.title" placeholder="请输入案件标题"
                            :disabled="isSubmitting" />
                    </div>

                    <!-- 案件类型 -->
                    <div class="space-y-2">
                        <Label>案件类型</Label>
                        <div class="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                            <Badge variant="secondary">{{ caseTypeName }}</Badge>
                        </div>
                    </div>

                    <!-- 原告 -->
                    <div class="space-y-2">
                        <Label>原告</Label>
                        <div class="space-y-2">
                            <div v-for="(plaintiff, index) in formData.plaintiff" :key="`plaintiff-${index}`"
                                class="flex items-center gap-2">
                                <Input v-model="formData.plaintiff[index]" placeholder="原告名称" :disabled="isSubmitting"
                                    class="flex-1" />
                                <Button v-if="formData.plaintiff.length > 1" variant="ghost" size="icon"
                                    class="h-9 w-9 shrink-0" @click="removePlaintiff(index)" :disabled="isSubmitting">
                                    <XIcon class="h-4 w-4" />
                                </Button>
                            </div>
                            <Button variant="outline" size="sm" @click="addPlaintiff" :disabled="isSubmitting">
                                <PlusIcon class="h-4 w-4 mr-1" />
                                添加原告
                            </Button>
                        </div>
                    </div>

                    <!-- 被告 -->
                    <div class="space-y-2">
                        <Label>被告</Label>
                        <div class="space-y-2">
                            <div v-for="(defendant, index) in formData.defendant" :key="`defendant-${index}`"
                                class="flex items-center gap-2">
                                <Input v-model="formData.defendant[index]" placeholder="被告名称" :disabled="isSubmitting"
                                    class="flex-1" />
                                <Button v-if="formData.defendant.length > 1" variant="ghost" size="icon"
                                    class="h-9 w-9 shrink-0" @click="removeDefendant(index)" :disabled="isSubmitting">
                                    <XIcon class="h-4 w-4" />
                                </Button>
                            </div>
                            <Button variant="outline" size="sm" @click="addDefendant" :disabled="isSubmitting">
                                <PlusIcon class="h-4 w-4 mr-1" />
                                添加被告
                            </Button>
                        </div>
                    </div>

                    <!-- 案件摘要 -->
                    <div class="space-y-2">
                        <Label for="case-summary">案件摘要</Label>
                        <Textarea id="case-summary" v-model="formData.summary" placeholder="请输入案件摘要"
                            class="min-h-[80px] resize-none" :disabled="isSubmitting" />
                    </div>

                    <!-- 可选字段折叠区域 -->
                    <Collapsible v-model:open="showOptionalFields">
                        <CollapsibleTrigger
                            class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                            <ChevronRightIcon class="h-4 w-4 transition-transform"
                                :class="{ 'rotate-90': showOptionalFields }" />
                            更多信息（可选）
                        </CollapsibleTrigger>
                        <CollapsibleContent class="mt-3 space-y-4">
                            <!-- 案由 -->
                            <div class="space-y-2">
                                <Label for="cause-of-action">案由</Label>
                                <Input id="cause-of-action" v-model="formData.causeOfAction" placeholder="请输入案由"
                                    :disabled="isSubmitting" />
                            </div>

                            <!-- 诉讼标的金额 -->
                            <div class="space-y-2">
                                <Label for="amount">诉讼标的金额</Label>
                                <Input id="amount" v-model="formData.amount" placeholder="请输入金额"
                                    :disabled="isSubmitting" />
                            </div>

                            <!-- 案件发生时间 -->
                            <div class="space-y-2">
                                <Label for="case-date">案件发生时间</Label>
                                <Input id="case-date" v-model="formData.caseDate" placeholder="请输入时间"
                                    :disabled="isSubmitting" />
                            </div>

                            <!-- 案件发生地点 -->
                            <div class="space-y-2">
                                <Label for="case-location">案件发生地点</Label>
                                <Input id="case-location" v-model="formData.caseLocation" placeholder="请输入地点"
                                    :disabled="isSubmitting" />
                            </div>
                        </CollapsibleContent>
                    </Collapsible>
                </div>

                <!-- 操作按钮 -->
                <AiElementsConfirmationConfirmationActions class="pt-2">
                    <AiElementsConfirmationConfirmationAction variant="outline" @click="handleReset"
                        :disabled="isSubmitting">
                        <RotateCcwIcon class="h-4 w-4 mr-1" />
                        重置
                    </AiElementsConfirmationConfirmationAction>
                    <AiElementsConfirmationConfirmationAction @click="handleSubmit"
                        :disabled="!canSubmit || isSubmitting">
                        <LoaderIcon v-if="isSubmitting" class="h-4 w-4 mr-2 animate-spin" />
                        {{ isSubmitting ? '提交中...' : '确认信息' }}
                    </AiElementsConfirmationConfirmationAction>
                </AiElementsConfirmationConfirmationActions>
            </div>
        </AiElementsConfirmationConfirmationRequest>

        <!-- 已接受状态 -->
        <AiElementsConfirmationConfirmationAccepted>
            <div class="flex items-center gap-2 text-green-600">
                <CheckCircleIcon class="h-5 w-5" />
                <span>基本信息已确认</span>
            </div>
        </AiElementsConfirmationConfirmationAccepted>

        <!-- 已拒绝状态 -->
        <AiElementsConfirmationConfirmationRejected>
            <div class="flex items-center gap-2 text-muted-foreground">
                <XCircleIcon class="h-5 w-5" />
                <span>已取消确认</span>
            </div>
        </AiElementsConfirmationConfirmationRejected>
    </AiElementsConfirmationConfirmation>
</template>

<script setup lang="ts">
/**
 * 基本信息确认处理器（中断点2）
 *
 * 展示系统从材料中提取的案件基本信息，供用户确认或修改
 *
 * @see Requirements 5.4, 5.5
 */
import type { BasicInfoConfirmInterruptData } from '@/composables/useCaseAnalysis'
import type { ExtendedToolState } from '@/components/ai-elements/types'
import type { ToolUIPartApproval } from '@/components/ai-elements/confirmation/context'
import {
    ClipboardCheckIcon,
    ChevronRightIcon,
    XIcon,
    PlusIcon,
    RotateCcwIcon,
    LoaderIcon,
    CheckCircleIcon,
    XCircleIcon,
} from 'lucide-vue-next'

/**
 * 表单数据接口
 */
interface FormData {
    title: string
    plaintiff: string[]
    defendant: string[]
    summary: string
    causeOfAction?: string
    amount?: string
    caseDate?: string
    caseLocation?: string
}

/**
 * 组件 Props
 */
interface Props {
    /** 中断数据 */
    interrupt: BasicInfoConfirmInterruptData
    /** 是否正在提交 */
    isSubmitting?: boolean
}

/**
 * 组件事件
 */
const emit = defineEmits<{
    /** 提交确认信息 */
    (e: 'submit', confirmedInfo: FormData): void
    /** 取消操作 */
    (e: 'cancel'): void
}>()

const props = withDefaults(defineProps<Props>(), {
    isSubmitting: false,
})

// 状态
const showOptionalFields = ref(false)

// Confirmation 组件状态
const approval = ref<ToolUIPartApproval>({ id: 'basic-info-confirm' })
const confirmationState = ref<ExtendedToolState>('approval-requested')

// 计算属性
const extractedInfo = computed(() => props.interrupt.data.extractedInfo)
const caseTypeName = computed(() => props.interrupt.data.caseTypeName || '未知类型')

// 表单数据（从提取的信息初始化）
const formData = ref<FormData>(createInitialFormData())

/**
 * 创建初始表单数据
 */
function createInitialFormData(): FormData {
    const info = props.interrupt.data.extractedInfo
    return {
        title: info.title || '',
        plaintiff: info.plaintiff?.length ? [...info.plaintiff] : [''],
        defendant: info.defendant?.length ? [...info.defendant] : [''],
        summary: info.summary || '',
        causeOfAction: info.causeOfAction || '',
        amount: info.amount || '',
        caseDate: info.caseDate || '',
        caseLocation: info.caseLocation || '',
    }
}

// 监听 interrupt 变化，重新初始化表单
watch(
    () => props.interrupt,
    () => {
        formData.value = createInitialFormData()
    },
    { deep: true }
)

// 计算属性
const canSubmit = computed(() => {
    return (
        formData.value.title.trim().length > 0 &&
        formData.value.plaintiff.some(p => p.trim().length > 0) &&
        formData.value.defendant.some(d => d.trim().length > 0)
    )
})

/**
 * 添加原告
 */
const addPlaintiff = () => {
    formData.value.plaintiff.push('')
}

/**
 * 移除原告
 */
const removePlaintiff = (index: number) => {
    if (formData.value.plaintiff.length > 1) {
        formData.value.plaintiff.splice(index, 1)
    }
}

/**
 * 添加被告
 */
const addDefendant = () => {
    formData.value.defendant.push('')
}

/**
 * 移除被告
 */
const removeDefendant = (index: number) => {
    if (formData.value.defendant.length > 1) {
        formData.value.defendant.splice(index, 1)
    }
}

/**
 * 重置表单
 */
const handleReset = () => {
    formData.value = createInitialFormData()
}

/**
 * 处理提交
 */
const handleSubmit = () => {
    if (!canSubmit.value) return

    // 清理空值
    const cleanedData: FormData = {
        title: formData.value.title.trim(),
        plaintiff: formData.value.plaintiff.filter(p => p.trim().length > 0),
        defendant: formData.value.defendant.filter(d => d.trim().length > 0),
        summary: formData.value.summary.trim(),
    }

    // 添加可选字段（如果有值）
    if (formData.value.causeOfAction?.trim()) {
        cleanedData.causeOfAction = formData.value.causeOfAction.trim()
    }
    if (formData.value.amount?.trim()) {
        cleanedData.amount = formData.value.amount.trim()
    }
    if (formData.value.caseDate?.trim()) {
        cleanedData.caseDate = formData.value.caseDate.trim()
    }
    if (formData.value.caseLocation?.trim()) {
        cleanedData.caseLocation = formData.value.caseLocation.trim()
    }

    // 更新状态
    approval.value = { id: 'basic-info-confirm', approved: true }
    confirmationState.value = 'approval-responded'

    emit('submit', cleanedData)
}

/**
 * 处理取消
 */
const handleCancel = () => {
    approval.value = { id: 'basic-info-confirm', approved: false, reason: '用户取消' }
    confirmationState.value = 'approval-responded'
    emit('cancel')
}
</script>
