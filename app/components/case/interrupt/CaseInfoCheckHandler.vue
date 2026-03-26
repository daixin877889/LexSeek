<template>
    <AiElementsConfirmationConfirmation :approval="approval" :state="confirmationState" class="w-full">
        <!-- 请求状态：等待用户输入 -->
        <AiElementsConfirmationConfirmationRequest>
            <div class="space-y-4">
                <!-- 标题和说明 -->
                <div class="space-y-2">
                    <AiElementsConfirmationConfirmationTitle class="flex items-center gap-2 text-base font-medium">
                        <AlertCircleIcon class="h-5 w-5 text-amber-500" />
                        {{ interrupt.message || '请补充案情信息' }}
                    </AiElementsConfirmationConfirmationTitle>

                    <!-- 检查结果说明 -->
                    <p v-if="checkResult?.message" class="text-sm text-muted-foreground">
                        {{ checkResult.message }}
                    </p>
                </div>

                <!-- 缺失信息提示 -->
                <div v-if="missingInfo.length > 0" class="space-y-2">
                    <p class="text-sm font-medium">缺失的信息：</p>
                    <ul class="list-disc list-inside text-sm text-muted-foreground space-y-1">
                        <li v-for="info in missingInfo" :key="info">{{ info }}</li>
                    </ul>
                </div>

                <!-- 建议补充内容 -->
                <div v-if="suggestions.length > 0" class="space-y-2">
                    <p class="text-sm font-medium">建议补充：</p>
                    <ul class="list-disc list-inside text-sm text-muted-foreground space-y-1">
                        <li v-for="suggestion in suggestions" :key="suggestion">{{ suggestion }}</li>
                    </ul>
                </div>

                <!-- 当前材料摘要 -->
                <Collapsible v-if="materialSummary" v-model:open="showMaterialSummary">
                    <CollapsibleTrigger
                        class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                        <ChevronRightIcon class="h-4 w-4 transition-transform"
                            :class="{ 'rotate-90': showMaterialSummary }" />
                        查看当前材料摘要
                    </CollapsibleTrigger>
                    <CollapsibleContent class="mt-2">
                        <div class="p-3 bg-muted/50 rounded-md text-sm text-muted-foreground whitespace-pre-wrap">
                            {{ materialSummary }}
                        </div>
                    </CollapsibleContent>
                </Collapsible>

                <!-- 补充方式选择 -->
                <div class="space-y-3">
                    <div class="flex items-center gap-4">
                        <Button variant="outline" size="sm" :class="{ 'border-primary': inputMode === 'text' }"
                            @click="inputMode = 'text'">
                            <FileTextIcon class="h-4 w-4 mr-2" />
                            文字输入
                        </Button>
                        <Button variant="outline" size="sm" :class="{ 'border-primary': inputMode === 'file' }"
                            @click="inputMode = 'file'">
                            <UploadIcon class="h-4 w-4 mr-2" />
                            上传文件
                        </Button>
                    </div>

                    <!-- 文字输入模式 -->
                    <div v-if="inputMode === 'text'" class="space-y-2">
                        <Label for="supplement-input">请输入补充的案情信息</Label>
                        <Textarea id="supplement-input" v-model="supplementText"
                            placeholder="请详细描述案件的相关情况，包括时间、地点、人物、事件经过等..." class="min-h-[120px] resize-none"
                            :disabled="isSubmitting" />
                        <p class="text-xs text-muted-foreground">
                            已输入 {{ supplementText.length }} 字
                        </p>
                    </div>

                    <!-- 文件上传模式 -->
                    <div v-else class="space-y-2">
                        <Label>上传案情相关文件</Label>
                        <div class="border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer"
                            :class="[
                                isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50',
                            ]" @dragover.prevent="isDragOver = true" @dragleave.prevent="isDragOver = false"
                            @drop.prevent="handleFileDrop" @click="triggerFileInput">
                            <UploadIcon class="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                            <p class="text-sm text-muted-foreground">
                                拖拽文件到此处或点击上传
                            </p>
                            <p class="text-xs text-muted-foreground mt-1">
                                支持 PDF、Word、图片、文本等格式
                            </p>
                            <input ref="fileInputRef" type="file" multiple
                                accept=".pdf,.doc,.docx,.md,.txt,.jpg,.jpeg,.png,.gif,.webp" class="hidden"
                                @change="handleFileChange" />
                        </div>

                        <!-- 已选文件列表 -->
                        <div v-if="selectedFiles.length > 0" class="space-y-2">
                            <div v-for="(file, index) in selectedFiles" :key="index"
                                class="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                                <FileIcon class="h-4 w-4 text-muted-foreground shrink-0" />
                                <span class="text-sm truncate flex-1">{{ file.name }}</span>
                                <span class="text-xs text-muted-foreground shrink-0">
                                    {{ formatByteSize(file.size, 1) }}
                                </span>
                                <Button variant="ghost" size="icon" class="h-6 w-6 shrink-0" @click="removeFile(index)">
                                    <XIcon class="h-3 w-3" />
                                </Button>
                            </div>
                        </div>

                        <!-- 文件说明输入 -->
                        <div v-if="selectedFiles.length > 0" class="space-y-2">
                            <Label for="file-description">文件说明（可选）</Label>
                            <Textarea id="file-description" v-model="fileDescription" placeholder="简要说明上传文件的内容..."
                                class="min-h-[60px] resize-none" :disabled="isSubmitting" />
                        </div>
                    </div>
                </div>

                <!-- 操作按钮 -->
                <AiElementsConfirmationConfirmationActions class="pt-2">
                    <AiElementsConfirmationConfirmationAction variant="outline" @click="handleCancel"
                        :disabled="isSubmitting">
                        取消
                    </AiElementsConfirmationConfirmationAction>
                    <AiElementsConfirmationConfirmationAction @click="handleSubmit"
                        :disabled="!canSubmit || isSubmitting">
                        <LoaderIcon v-if="isSubmitting" class="h-4 w-4 mr-2 animate-spin" />
                        {{ isSubmitting ? '提交中...' : '提交补充信息' }}
                    </AiElementsConfirmationConfirmationAction>
                </AiElementsConfirmationConfirmationActions>
            </div>
        </AiElementsConfirmationConfirmationRequest>

        <!-- 已接受状态 -->
        <AiElementsConfirmationConfirmationAccepted>
            <div class="flex items-center gap-2 text-green-600">
                <CheckCircleIcon class="h-5 w-5" />
                <span>案情信息已补充</span>
            </div>
        </AiElementsConfirmationConfirmationAccepted>

        <!-- 已拒绝状态 -->
        <AiElementsConfirmationConfirmationRejected>
            <div class="flex items-center gap-2 text-muted-foreground">
                <XCircleIcon class="h-5 w-5" />
                <span>已取消补充</span>
            </div>
        </AiElementsConfirmationConfirmationRejected>
    </AiElementsConfirmationConfirmation>
</template>

<script setup lang="ts">
/**
 * 案情信息检查处理器（中断点1）
 *
 * 当系统检测到案情信息不足时，显示此组件让用户补充案情信息
 * 支持文字输入和文件上传两种方式
 *
 * @see Requirements 4.4, 4.5, 4.6
 */
import type { CaseInfoCheckInterruptData } from '#shared/types/case'
import type { ExtendedToolState } from '@/components/ai-elements/types'
import type { ToolUIPartApproval } from '@/components/ai-elements/confirmation/context'
import {
    AlertCircleIcon,
    ChevronRightIcon,
    FileTextIcon,
    UploadIcon,
    FileIcon,
    XIcon,
    LoaderIcon,
    CheckCircleIcon,
    XCircleIcon,
} from 'lucide-vue-next'

/**
 * 组件 Props
 */
interface Props {
    /** 中断数据 */
    interrupt: CaseInfoCheckInterruptData
    /** 是否正在提交 */
    isSubmitting?: boolean
}

/**
 * 组件事件
 */
const emit = defineEmits<{
    /** 提交补充信息 */
    (e: 'submit', supplementInfo: string): void
    /** 取消操作 */
    (e: 'cancel'): void
}>()

const props = withDefaults(defineProps<Props>(), {
    isSubmitting: false,
})

// Composables
const { readFile } = useFileReader()

// 状态
const inputMode = ref<'text' | 'file'>('text')
const supplementText = ref('')
const selectedFiles = ref<File[]>([])
const fileDescription = ref('')
const isDragOver = ref(false)
const showMaterialSummary = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const isProcessingFiles = ref(false)

// Confirmation 组件状态
const approval = ref<ToolUIPartApproval>({ id: 'case-info-check' })
const confirmationState = ref<ExtendedToolState>('approval-requested')

// 计算属性
const checkResult = computed(() => props.interrupt.data.checkResult)
const materialSummary = computed(() => props.interrupt.data.materialSummary)
const missingInfo = computed(() => checkResult.value?.missingInfo || [])
const suggestions = computed(() => checkResult.value?.suggestions || [])

const canSubmit = computed(() => {
    if (inputMode.value === 'text') {
        return supplementText.value.trim().length > 0
    }
    return selectedFiles.value.length > 0
})

/**
 * 触发文件选择
 */
const triggerFileInput = () => {
    fileInputRef.value?.click()
}

/**
 * 处理文件选择
 */
const handleFileChange = (event: Event) => {
    const target = event.target as HTMLInputElement
    const files = target.files
    if (files) {
        addFiles(Array.from(files))
    }
    if (target) {
        target.value = ''
    }
}

/**
 * 处理文件拖放
 */
const handleFileDrop = (event: DragEvent) => {
    isDragOver.value = false
    const files = event.dataTransfer?.files
    if (files) {
        addFiles(Array.from(files))
    }
}

/**
 * 添加文件
 */
const addFiles = (files: File[]) => {
    for (const file of files) {
        // 检查是否已存在
        const exists = selectedFiles.value.some(
            f => f.name === file.name && f.size === file.size
        )
        if (!exists) {
            selectedFiles.value.push(file)
        }
    }
}

/**
 * 移除文件
 */
const removeFile = (index: number) => {
    selectedFiles.value.splice(index, 1)
}

/**
 * 处理提交
 */
const handleSubmit = async () => {
    if (!canSubmit.value) return

    let submitContent = ''

    if (inputMode.value === 'text') {
        submitContent = supplementText.value.trim()
    } else {
        // 处理文件内容
        isProcessingFiles.value = true
        try {
            const fileContents: string[] = []

            for (const file of selectedFiles.value) {
                try {
                    const result = await readFile(file)
                    fileContents.push(`【${file.name}】\n${result.content}`)
                } catch {
                    // 如果文件无法读取，添加文件名作为占位
                    fileContents.push(`【${file.name}】（文件内容待服务端处理）`)
                }
            }

            submitContent = fileContents.join('\n\n')

            // 如果有文件说明，添加到开头
            if (fileDescription.value.trim()) {
                submitContent = `补充说明：${fileDescription.value.trim()}\n\n${submitContent}`
            }
        } finally {
            isProcessingFiles.value = false
        }
    }

    // 更新状态
    approval.value = { id: 'case-info-check', approved: true }
    confirmationState.value = 'approval-responded'

    emit('submit', submitContent)
}

/**
 * 处理取消
 */
const handleCancel = () => {
    approval.value = { id: 'case-info-check', approved: false, reason: '用户取消' }
    confirmationState.value = 'approval-responded'
    emit('cancel')
}
</script>
