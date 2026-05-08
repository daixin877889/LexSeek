<script setup lang="ts">
/**
 * 合同审查新建对话框
 *
 * 两 Tab 居中：
 * - 选择文件（默认）：拖拽本地 .docx 上传，或点击打开 MaterialSelector 从云盘选择
 * - 粘贴文本：textarea + 开始审查按钮
 *
 * 成功后 emit('created', reviewId)，列表页接收后跳详情。
 */
import { ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Loader2Icon, FileTextIcon, UploadIcon, XIcon } from 'lucide-vue-next'
import type { CreateReviewRequest, CreateReviewResponse } from '#shared/types/contract'
import type { OssFileItem } from '~/store/file'
import { DOCX_MIME } from '#shared/utils/mime'
import { FileSource } from '#shared/types/file'
import { useBatchUpload } from '~/composables/useBatchUpload'
import CaseAnalysisMaterialSelector from '~/components/caseAnalysis/materialSelector.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useFileStore } from '~/store/file'

const props = defineProps<{
    open: boolean
    /** 可选：归属案件；案件详情 Tab 入口会把 caseId 带进来 */
    caseId?: number | null
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
    'created': [reviewId: number]
}>()

const activeTab = ref<'upload' | 'paste'>('upload')

// 选择文件 Tab 状态
const materialSelectorRef = ref<{ openDialog: () => void; closeDialog: () => void } | null>(null)
const selectedFile = ref<OssFileItem | null>(null)
const submitting = ref(false)

// 拖拽上传状态
const isDragging = ref(false)
const localUploading = ref(false)
const localUploadProgress = ref(0)
const fileStore = useFileStore()
const { uploadToOSS } = useBatchUpload()

// 粘贴 Tab 状态
const pasteText = ref('')
const pasteSubmitting = ref(false)

watch(() => props.open, (v) => {
    if (!v) {
        selectedFile.value = null
        pasteText.value = ''
        activeTab.value = 'upload'
        submitting.value = false
        pasteSubmitting.value = false
        isDragging.value = false
        localUploading.value = false
        localUploadProgress.value = 0
    }
})

function formatSize(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function openFileSelector() {
    if (localUploading.value) return
    materialSelectorRef.value?.openDialog()
}

function handleFilesSelected(files: OssFileItem[]) {
    if (files.length === 0) return
    const file = files[0]!
    if (file.fileType !== DOCX_MIME && !file.fileName.toLowerCase().endsWith('.docx')) {
        toast.warning('仅支持 .docx 文件，请重新选择')
        return
    }
    selectedFile.value = file
}

async function handleDrop(e: DragEvent) {
    isDragging.value = false
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.docx')) {
        toast.warning('仅支持 .docx 文件')
        return
    }
    if (file.size > 20 * 1024 * 1024) {
        toast.warning('文件不得超过 20 MB')
        return
    }
    await uploadLocalFile(file)
}

async function uploadLocalFile(file: File) {
    localUploading.value = true
    localUploadProgress.value = 0
    try {
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
        const ossResult = await uploadToOSS(file, sig, (p: number) => { localUploadProgress.value = p })
        const ossFileId = (ossResult?.fileId ?? ossResult?.id) as number | undefined
        if (!ossFileId) {
            toast.error('上传成功但缺少文件标识')
            return
        }
        selectedFile.value = {
            id: ossFileId,
            fileName: file.name,
            fileSize: file.size,
            fileType: DOCX_MIME,
            source: FileSource.CASE_ANALYSIS,
            sourceName: '',
            status: 1,
            statusName: '',
            encrypted: false,
            createdAt: new Date().toISOString(),
        }
    } catch (err) {
        toast.error(err instanceof Error ? err.message : '上传失败')
    } finally {
        localUploading.value = false
    }
}

function clearFile() {
    selectedFile.value = null
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
    submitting.value = true
    try {
        // 已从 MaterialSelector 选择的文件，直接用 ossFileId，无需重新上传
        const reviewId = await createReview({ sourceType: 'upload', ossFileId: file.id })
        if (reviewId) {
            emit('created', reviewId)
            emit('update:open', false)
        }
    } catch (err) {
        toast.error(err instanceof Error ? err.message : '创建审查失败')
    } finally {
        submitting.value = false
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
                <DialogDescription class="sr-only">
                    选择上传 .docx 合同文件，或粘贴合同全文，AI 会自动识别风险条款并生成审查报告。
                </DialogDescription>
            </DialogHeader>

            <Tabs v-model="activeTab" class="w-full">
                <TabsList class="mx-auto grid grid-cols-2 w-[260px]">
                    <TabsTrigger value="upload">选择文件</TabsTrigger>
                    <TabsTrigger value="paste">粘贴文本</TabsTrigger>
                </TabsList>

                <!-- 选择文件 Tab -->
                <TabsContent value="upload" class="pt-4">
                    <div class="space-y-3">
                        <!-- 未选文件 / 上传中：拖拽区域 -->
                        <div v-if="!selectedFile"
                            class="border-2 border-dashed rounded-lg p-8 text-center transition-colors"
                            :class="[
                                isDragging
                                    ? 'border-primary bg-primary/5 dark:bg-primary/15'
                                    : 'border-muted-foreground/25 hover:border-primary/50',
                                localUploading ? 'cursor-default' : 'cursor-pointer'
                            ]"
                            @dragover.prevent="isDragging = true"
                            @dragleave="isDragging = false"
                            @drop.prevent="handleDrop"
                            @click="openFileSelector">
                            <template v-if="localUploading">
                                <Loader2Icon class="size-8 mx-auto mb-3 text-primary animate-spin" />
                                <p class="text-sm font-medium">正在上传...</p>
                                <div class="mt-3 w-full bg-muted rounded-full h-1.5">
                                    <div class="bg-primary h-1.5 rounded-full transition-all"
                                        :style="{ width: `${localUploadProgress}%` }" />
                                </div>
                                <p class="text-xs text-muted-foreground mt-1">{{ localUploadProgress }}%</p>
                            </template>
                            <template v-else>
                                <UploadIcon class="size-8 mx-auto mb-3 text-muted-foreground" />
                                <p class="text-sm font-medium">
                                    {{ isDragging ? '释放以上传文件' : '拖拽 .docx 到此处' }}
                                </p>
                                <p class="text-xs text-muted-foreground mt-1">或点击从文件库选择</p>
                            </template>
                        </div>

                        <!-- 已选文件：展示 + 移除 -->
                        <div v-else class="border rounded-lg p-4 space-y-3">
                            <div class="flex items-center gap-3">
                                <div
                                    class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                    <FileTextIcon class="size-5" />
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="text-sm font-medium truncate">{{ selectedFile.fileName }}</div>
                                    <div class="text-xs text-muted-foreground">{{ formatSize(selectedFile.fileSize) }}</div>
                                </div>
                                <Button v-if="!submitting" variant="ghost" size="icon" class="size-8 shrink-0"
                                    aria-label="移除文件" @click="clearFile">
                                    <XIcon class="size-4" />
                                </Button>
                            </div>
                        </div>

                        <div class="flex justify-end">
                            <Button :disabled="!selectedFile || submitting || localUploading" @click="handleUploadSubmit">
                                <Loader2Icon v-if="submitting" class="size-4 mr-1 animate-spin" />
                                {{ submitting ? '创建中...' : '开始审查' }}
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

            <!-- 文件选择弹框：复用案件分析的 MaterialSelector -->
            <CaseAnalysisMaterialSelector ref="materialSelectorRef" @files-selected="handleFilesSelected" />
        </DialogContent>
    </Dialog>
</template>
