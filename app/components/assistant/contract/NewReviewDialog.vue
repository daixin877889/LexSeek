<script setup lang="ts">
/**
 * 合同审查新建对话框
 *
 * 两 Tab 居中：
 * - 上传文件（默认）：dropzone 直接选/拖 .docx → 上传 OSS → 创建审查
 * - 粘贴文本：textarea + 开始审查按钮
 *
 * 成功后 emit('created', reviewId)，列表页接收后跳详情。
 */
import { ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Loader2Icon, FileTextIcon, UploadIcon, XIcon } from 'lucide-vue-next'
import { DOCX_MIME } from '#shared/utils/mime'
import { FileSource } from '#shared/types/file'
import { useBatchUpload } from '~/composables/useBatchUpload'
import type { CreateReviewRequest, CreateReviewResponse } from '#shared/types/contract'

const props = defineProps<{
    open: boolean
    /** 可选：归属案件；案件详情 Tab 入口会把 caseId 带进来 */
    caseId?: number | null
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
    'created': [reviewId: number]
}>()

const MAX_SIZE_BYTES = 20 * 1024 * 1024

const activeTab = ref<'upload' | 'paste'>('upload')

// 上传 Tab 状态
const fileInputRef = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const uploading = ref(false)
const uploadProgress = ref(0)
const isDragOver = ref(false)

// 粘贴 Tab 状态
const pasteText = ref('')
const pasteSubmitting = ref(false)

const fileStore = useFileStore()
const { uploadToOSS } = useBatchUpload()

watch(() => props.open, (v) => {
    if (!v) {
        // 关闭时重置
        selectedFile.value = null
        pasteText.value = ''
        activeTab.value = 'upload'
        uploading.value = false
        uploadProgress.value = 0
        pasteSubmitting.value = false
    }
})

function formatSize(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function triggerFileInput() {
    if (uploading.value) return
    fileInputRef.value?.click()
}

function applyFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.docx')) {
        toast.warning('仅支持 .docx 文件')
        return
    }
    if (file.size > MAX_SIZE_BYTES) {
        toast.warning('文件不得超过 20 MB')
        return
    }
    selectedFile.value = file
}

function handleFileSelect(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) applyFile(file)
    // 清空 input，允许再次选同名文件
    if (fileInputRef.value) fileInputRef.value.value = ''
}

function handleDrop(e: DragEvent) {
    isDragOver.value = false
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
            onConfirm: () => applyFile(file),
        })
        return
    }
    applyFile(file)
}

function clearFile() {
    selectedFile.value = null
    uploadProgress.value = 0
}

async function createReview(payload: CreateReviewRequest): Promise<number | null> {
    const body: CreateReviewRequest = props.caseId ? { ...payload, caseId: props.caseId } : payload
    const resp = await useApiFetch<CreateReviewResponse>(
        '/api/v1/assistant/contract/reviews',
        { method: 'POST', body },
    )
    return resp?.reviewId ?? null
}

async function handleUploadSubmit() {
    const file = selectedFile.value
    if (!file) return
    uploading.value = true
    uploadProgress.value = 0
    try {
        // 1. 获取 OSS 预签名
        const signatures = await fileStore.getBatchPresignedUrls({
            source: FileSource.CASE_ANALYSIS,
            files: [{
                originalFileName: file.name,
                fileSize: file.size,
                mimeType: DOCX_MIME,
            }],
            encrypted: false,
        })
        const sig = signatures?.[0]
        if (!sig) {
            toast.error('获取上传签名失败，请稍后重试')
            return
        }
        // 2. 上传到 OSS
        const result = await uploadToOSS(file, sig, (p) => {
            uploadProgress.value = p
        })
        const ossFileId = (result?.fileId ?? result?.id) as number | undefined
        if (!ossFileId) {
            toast.error('上传成功但缺少文件标识')
            return
        }
        // 3. 创建审查
        const reviewId = await createReview({ sourceType: 'upload', ossFileId })
        if (reviewId) {
            emit('created', reviewId)
            emit('update:open', false)
        }
    } catch (err) {
        toast.error(err instanceof Error ? err.message : '上传失败')
    } finally {
        uploading.value = false
    }
}

async function handlePasteSubmit() {
    const text = pasteText.value.trim()
    if (!text) {
        toast.warning('请粘贴合同全文')
        return
    }
    if (text.length > 50000) {
        toast.warning('合同内容不得超过 5 万字，请拆分或改用上传 .docx')
        return
    }
    pasteSubmitting.value = true
    try {
        const reviewId = await createReview({ sourceType: 'paste', text })
        if (reviewId) {
            emit('created', reviewId)
            emit('update:open', false)
        }
    } finally {
        pasteSubmitting.value = false
    }
}
</script>

<template>
    <Dialog :open="open" @update:open="emit('update:open', $event)">
        <DialogContent class="sm:max-w-[560px]">
            <DialogHeader>
                <DialogTitle>新建合同审查</DialogTitle>
                <!-- <DialogDescription>
                    选择上传 .docx 合同文件，或粘贴合同全文，AI 会自动识别风险条款并生成审查报告。
                </DialogDescription> -->
            </DialogHeader>

            <Tabs v-model="activeTab" class="w-full">
                <TabsList class="mx-auto grid grid-cols-2 w-[260px]">
                    <TabsTrigger value="upload">上传文件</TabsTrigger>
                    <TabsTrigger value="paste">粘贴文本</TabsTrigger>
                </TabsList>

                <!-- 上传 Tab -->
                <TabsContent value="upload" class="pt-4">
                    <div class="space-y-3">
                        <!-- 未选文件：dropzone，input 用 absolute inset-0 铺满父容器，opacity:0 保持不可见但可点击 -->
                        <div v-if="!selectedFile"
                            class="relative border-2 border-dashed rounded-lg p-8 text-center transition-colors"
                            :class="isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'"
                            @dragover.prevent="isDragOver = true"
                            @dragleave.prevent="isDragOver = false" @drop.prevent="handleDrop">
                            <input ref="fileInputRef" type="file" accept=".docx"
                                class="absolute inset-0 size-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                                :disabled="uploading" @change="handleFileSelect" />
                            <UploadIcon class="size-8 mx-auto mb-3 text-muted-foreground pointer-events-none" />
                            <p class="text-sm font-medium pointer-events-none">点击选择文件 或 拖拽到此处</p>
                            <p class="text-xs text-muted-foreground mt-1 pointer-events-none">仅支持 .docx 格式，≤ 20 MB</p>
                        </div>

                        <!-- 已选文件：展示 + 移除 + 进度 -->
                        <div v-else class="border rounded-lg p-4 space-y-3">
                            <div class="flex items-center gap-3">
                                <div
                                    class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                    <FileTextIcon class="size-5" />
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="text-sm font-medium truncate">{{ selectedFile.name }}</div>
                                    <div class="text-xs text-muted-foreground">{{ formatSize(selectedFile.size) }}</div>
                                </div>
                                <Button v-if="!uploading" variant="ghost" size="icon" class="size-8 shrink-0"
                                    aria-label="移除文件" @click="clearFile">
                                    <XIcon class="size-4" />
                                </Button>
                            </div>
                            <div v-if="uploading" class="space-y-1">
                                <div class="h-1.5 rounded-full bg-muted overflow-hidden">
                                    <div class="h-full bg-primary transition-all"
                                        :style="{ width: `${uploadProgress}%` }" />
                                </div>
                                <div class="text-xs text-muted-foreground text-right">
                                    {{ uploadProgress }}%
                                </div>
                            </div>
                        </div>

                        <div class="flex justify-end">
                            <Button :disabled="!selectedFile || uploading" @click="handleUploadSubmit">
                                <Loader2Icon v-if="uploading" class="size-4 mr-1 animate-spin" />
                                {{ uploading ? '上传中...' : '开始审查' }}
                            </Button>
                        </div>
                    </div>
                </TabsContent>

                <!-- 粘贴 Tab -->
                <TabsContent value="paste" class="pt-4">
                    <div class="space-y-3">
                        <Textarea v-model="pasteText" placeholder="粘贴合同全文..." :rows="10" :disabled="pasteSubmitting"
                            class="font-mono text-sm" />
                        <div class="flex items-center justify-between">
                            <span class="text-xs text-muted-foreground">{{ pasteText.length }} / 50,000 字</span>
                            <Button :disabled="pasteSubmitting || !pasteText.trim()" @click="handlePasteSubmit">
                                <Loader2Icon v-if="pasteSubmitting" class="size-4 mr-1 animate-spin" />
                                开始审查
                            </Button>
                        </div>
                    </div>
                </TabsContent>
            </Tabs>
        </DialogContent>
    </Dialog>
</template>
