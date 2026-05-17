<script setup lang="ts">
/**
 * 上传新版本对话框
 *
 * 流程：选择 .docx 文件 → OSS 上传 → SSE 五步骤进度 → 完成/错误
 * 完成后 emit complete(payload)，由父组件刷新时间线。
 */
import { UploadIcon, CheckCircleIcon, AlertCircleIcon, Loader2Icon, FileIcon, XIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { FileSource } from '#shared/types/file'
import { DOCX_MIME } from '#shared/utils/mime'
import { useBatchUpload } from '~/composables/useBatchUpload'
import type { StepState, StepStatus } from '~/composables/useContractReviewVersion'
import type { Ref } from 'vue'
import { useAlertDialogStore } from '~/store/alertDialog'
import { useFileStore } from '~/store/file'

/**
 * UI-C1：通过 props 接收 uploadNewVersion，避免在 Dialog 内重复
 * `useContractReviewVersion`，与父级形成 SSE 状态分裂。
 */
const props = defineProps<{
    open: boolean
    reviewId: number
    /** 父级 versioning.uploadNewVersion，由 ContractReviewPanel 透传 */
    uploadNewVersion: (ossFileId: number) => Promise<{
        steps: Ref<StepState[]>
        done: Ref<boolean>
        result: Ref<{ newVersionId: number; summary: string } | null>
        error: Ref<{ step: string; message: string } | null>
        abort: () => void
    }>
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
    'complete': [payload: { newVersionId: number; summary: string }]
}>()

// OSS 上传状态
const fileInputRef = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const ossUploading = ref(false)
const ossProgress = ref(0)

// SSE 状态容器（uploadNewVersion 返回的 refs）
type SseState = {
    steps: Ref<StepState[]>
    done: Ref<boolean>
    result: Ref<{ newVersionId: number; summary: string } | null>
    error: Ref<{ step: string; message: string } | null>
    /** DOCX-H8：父组件关闭 / 组件卸载时主动中断 SSE 消费 */
    abort: () => void
}
const sseState = shallowRef<SseState | null>(null)

// 从 sseState 派生的计算属性
const steps = computed(() => sseState.value?.steps.value ?? [])
const uploadDone = computed(() => sseState.value?.done.value ?? false)
const uploadResult = computed(() => sseState.value?.result.value ?? null)
const uploadError = computed(() => sseState.value?.error.value ?? null)

// 拖拽状态
const isDragging = ref(false)

// 关闭时重置。DOCX-H8：如流式处理未终态（done/error 都没有）则主动 abort，
// 避免用户关了 Dialog 后后台流仍在消耗流量 / 占用服务端资源。
watch(() => props.open, (v) => {
    if (!v) {
        const s = sseState.value
        if (s && !s.done.value && !s.error.value) {
            s.abort()
        }
        resetState()
    }
})

// 组件卸载（路由跳转等）时同样中断
onBeforeUnmount(() => {
    sseState.value?.abort()
})

/**
 * bug #16：SSE 异常 / 完成仅显示在对话框内，用户若未点「完成」就关闭就完全丢失。
 * 这里在状态 ref 变为有值时**立即**弹 toast，让关闭对话框后通知仍能留在全局。
 * 用 tostedFor 记录已 toast 的终态标识，避免 watcher 重触发时重复弹。
 */
let toastedFor: string | null = null
watch(uploadResult, (v) => {
    if (!v) return
    const key = `result:${v.newVersionId}`
    if (toastedFor === key) return
    toastedFor = key
    toast.success(`增量重审完成：${v.summary || '新版本已生成'}`)
})
watch(uploadError, (v) => {
    if (!v) return
    const key = `error:${v.step}:${v.message}`
    if (toastedFor === key) return
    toastedFor = key
    toast.error(`新版本处理失败：${v.message}`)
})

function resetState() {
    selectedFile.value = null
    ossUploading.value = false
    ossProgress.value = 0
    sseState.value = null
    isDragging.value = false
    toastedFor = null
}

function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.docx')) {
        toast.warning('仅支持 .docx 文件')
        return
    }
    if (file.size > 20 * 1024 * 1024) {
        toast.warning('文件不得超过 20 MB')
        return
    }
    selectedFile.value = file
}

function handleFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (fileInputRef.value) fileInputRef.value.value = ''
    if (!file) return
    processFile(file)
}

function handleDrop(e: DragEvent) {
    isDragging.value = false
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    // bug #19：已选文件时再次拖入须二次确认，避免误操作替换后丢失当前选择
    if (selectedFile.value) {
        const alertDialogStore = useAlertDialogStore()
        const oldName = selectedFile.value.name
        const newName = file.name
        alertDialogStore.showDialog({
            title: '替换文件',
            message: `已选「${oldName}」，确认替换为「${newName}」？`,
            confirmText: '替换',
            cancelText: '保留原文件',
            onConfirm: () => processFile(file),
        })
        return
    }
    processFile(file)
}

const fileStore = useFileStore()
const { uploadToOSS } = useBatchUpload()

async function handleUpload() {
    const file = selectedFile.value
    if (!file || ossUploading.value) return
    ossUploading.value = true
    ossProgress.value = 0
    try {
        // 1. 获取 OSS 预签名 URL
        const signatures = await fileStore.getBatchPresignedUrls({
            source: FileSource.CASE_ANALYSIS,
            files: [{ originalFileName: file.name, fileSize: file.size, mimeType: DOCX_MIME }],
            encrypted: false,
        })
        const sig = signatures?.[0]
        if (!sig) {
            toast.error('获取上传签名失败，请稍后重试')
            return
        }
        // 2. 上传至 OSS
        const ossResult = await uploadToOSS(file, sig, (p: number) => { ossProgress.value = p })
        const ossFileId = (ossResult?.fileId ?? ossResult?.id) as number | undefined
        if (!ossFileId) {
            toast.error('上传成功但缺少文件标识')
            return
        }
        ossUploading.value = false
        // 3. 触发 SSE 处理流程（uploadNewVersion 由父级 versioning 注入，避免 SSE 状态分裂）
        sseState.value = await props.uploadNewVersion(ossFileId)
    } catch (err) {
        toast.error(err instanceof Error ? err.message : '上传失败')
    } finally {
        ossUploading.value = false
    }
}

function handleClose() {
    if (uploadDone.value && uploadResult.value) {
        emit('complete', uploadResult.value)
    }
    emit('update:open', false)
}

/** 根据步骤状态返回图标和样式 */
function stepIcon(status: StepStatus) {
    if (status === 'done') return CheckCircleIcon
    if (status === 'error') return AlertCircleIcon
    if (status === 'progress') return Loader2Icon
    return null
}

function stepColorClass(status: StepStatus) {
    // bug #17：深色模式下 text-green-600 对比度不足，补 dark:text-green-400；
    // destructive / primary / muted-foreground 已是语义色，可随主题自动翻转。
    if (status === 'done') return 'text-green-600 dark:text-green-400'
    if (status === 'error') return 'text-destructive'
    if (status === 'progress') return 'text-primary'
    return 'text-muted-foreground'
}
</script>

<template>
    <Dialog :open="open" @update:open="emit('update:open', $event)">
        <DialogContent class="sm:max-w-[480px]">
            <DialogHeader>
                <DialogTitle>上传新版本</DialogTitle>
                <DialogDescription>
                    上传客户回传的 .docx 文件，系统会自动对比差异、重新分析条款并生成新版本快照。
                </DialogDescription>
            </DialogHeader>

            <!-- 文件选择阶段 -->
            <template v-if="!sseState && !ossUploading">
                <div class="space-y-4 py-2">
                    <!-- 文件选择区：input absolute inset-0 铺满父容器 + opacity:0，自身即点击目标，最可靠 -->
                    <div
                        data-testid="dropzone"
                        class="relative border-2 border-dashed rounded-lg p-6 text-center transition-colors"
                        :class="[
                            isDragging
                                ? 'border-primary bg-primary/5 dark:bg-primary/15'
                                : 'border-primary/30 hover:border-primary/60'
                        ]"
                        @dragover.prevent="isDragging = true"
                        @dragleave="isDragging = false"
                        @drop.prevent="handleDrop"
                    >
                        <input
                            ref="fileInputRef"
                            type="file"
                            accept=".docx"
                            class="absolute inset-0 size-full opacity-0 cursor-pointer"
                            @change="handleFileChange"
                        />
                        <template v-if="selectedFile">
                            <FileIcon class="size-8 mx-auto mb-2 text-primary pointer-events-none" />
                            <p class="text-sm font-medium pointer-events-none">{{ selectedFile.name }}</p>
                            <p class="text-xs text-muted-foreground mt-1 pointer-events-none">
                                {{ (selectedFile.size / 1024 / 1024).toFixed(2) }} MB
                            </p>
                        </template>
                        <template v-else>
                            <UploadIcon class="size-8 mx-auto mb-2 text-muted-foreground pointer-events-none" />
                            <p class="text-sm text-muted-foreground pointer-events-none">
                                {{ isDragging ? '释放以上传' : '点击或拖拽 .docx 文件到此处' }}
                            </p>
                        </template>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" @click="emit('update:open', false)">取消</Button>
                    <Button :disabled="!selectedFile" class="bg-gradient-brand-button text-white" @click="handleUpload">
                        <UploadIcon class="size-4 mr-1" />
                        上传
                    </Button>
                </DialogFooter>
            </template>

            <!-- OSS 上传中 -->
            <template v-else-if="ossUploading">
                <div class="py-4 space-y-3">
                    <p class="text-sm text-center text-muted-foreground">正在上传文件...</p>
                    <div class="w-full bg-muted rounded-full h-2">
                        <div
                            class="bg-gradient-brand-button h-2 rounded-full transition-all"
                            :style="{ width: `${ossProgress}%` }"
                        />
                    </div>
                    <p class="text-xs text-center text-muted-foreground">{{ ossProgress }}%</p>
                </div>
            </template>

            <!-- SSE 步骤进度 -->
            <template v-else-if="sseState">
                <div class="py-2 space-y-1">
                    <div
                        v-for="step in steps"
                        :key="step.key"
                        :data-step="step.key"
                        :data-status="step.status"
                        class="flex items-center gap-3 py-2 px-1 rounded"
                    >
                        <!-- 状态图标 -->
                        <div class="size-5 flex-shrink-0 flex items-center justify-center">
                            <Loader2Icon
                                v-if="step.status === 'progress'"
                                :class="['size-4 animate-spin', stepColorClass(step.status)]"
                            />
                            <CheckCircleIcon
                                v-else-if="step.status === 'done'"
                                :class="['size-4', stepColorClass(step.status)]"
                            />
                            <AlertCircleIcon
                                v-else-if="step.status === 'error'"
                                :class="['size-4', stepColorClass(step.status)]"
                            />
                            <div v-else class="size-3 rounded-full bg-muted-foreground/30" />
                        </div>

                        <!-- 步骤名称 -->
                        <span :class="['text-sm flex-1', stepColorClass(step.status)]">
                            {{ step.label }}
                        </span>
                    </div>

                    <!-- 错误信息 -->
                    <div v-if="uploadError" class="mt-3 p-3 rounded bg-destructive/10 text-destructive text-sm">
                        {{ uploadError.message }}
                    </div>

                    <!-- 完成摘要 -->
                    <div v-if="uploadResult" class="mt-3 p-3 rounded bg-primary/10 text-sm">
                        {{ uploadResult.summary }}
                    </div>
                </div>

                <DialogFooter>
                    <Button v-if="uploadDone || uploadError" class="bg-gradient-brand-button text-white" @click="handleClose">
                        完成
                    </Button>
                    <span v-else class="text-xs text-muted-foreground">处理中，请稍候...</span>
                </DialogFooter>
            </template>
        </DialogContent>
    </Dialog>
</template>
