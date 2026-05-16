<script setup lang="ts">
/**
 * 合同审查 · 新建审查表单
 *
 * 内嵌于列表页 /dashboard/contract 顶部的新建卡片。
 * 三种来源：本机上传 .docx（拖拽 / 点击）、文件库选择、粘贴文本。
 * 成功后 emit('created', reviewId)，由调用方决定后续（跳详情）。
 */
import { ref, computed } from 'vue'
import { toast } from 'vue-sonner'
import {
    Loader2Icon, FileTextIcon, UploadIcon, XIcon, FolderIcon, ClipboardIcon, SparklesIcon,
} from 'lucide-vue-next'
import type { CreateReviewRequest, CreateReviewResponse } from '#shared/types/contract'
import type { OssFileItem } from '~/store/file'
import { DOCX_MIME } from '#shared/utils/mime'
import { FileSource } from '#shared/types/file'
import { useBatchUpload } from '~/composables/useBatchUpload'
import CaseAnalysisMaterialSelector from '~/components/caseAnalysis/materialSelector.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useFileStore } from '~/store/file'

const props = withDefaults(defineProps<{ caseId?: number | null }>(), { caseId: null })
const emit = defineEmits<{ created: [reviewId: number] }>()

const CONTRACT_MAX_MB = 20
const PASTE_MAX = 50000

const activeTab = ref<'upload' | 'paste'>('upload')

// ── 选择文件状态 ──
interface PickedFile { id: number; fileName: string; fileSize: number; origin: 'local' | 'library' }
const materialSelectorRef = ref<{ openDialog: () => void; closeDialog: () => void } | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const selectedFile = ref<PickedFile | null>(null)
const uploadError = ref('')
const submitting = ref(false)

// 拖拽 / 本机上传
const isDragging = ref(false)
const localUploading = ref(false)
const localUploadProgress = ref(0)
const fileStore = useFileStore()
const { uploadToOSS } = useBatchUpload()

// ── 粘贴文本状态 ──
const pasteText = ref('')
const pasteSubmitting = ref(false)
const canSubmitPaste = computed(
    () => pasteText.value.trim().length > 0 && pasteText.value.length <= PASTE_MAX,
)

function formatSize(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function reset() {
    selectedFile.value = null
    uploadError.value = ''
    localUploadProgress.value = 0
}

// ── 本机上传 ──
function triggerFilePicker() {
    if (localUploading.value) return
    fileInputRef.value?.click()
}

function onFileInputChange(e: Event) {
    const input = e.target as HTMLInputElement
    acceptLocal(input.files?.[0])
    input.value = ''
}

function handleDrop(e: DragEvent) {
    isDragging.value = false
    if (localUploading.value) return
    acceptLocal(e.dataTransfer?.files?.[0])
}

function acceptLocal(file: File | undefined | null) {
    uploadError.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.docx')) {
        uploadError.value = '仅支持 .docx 文件，请重新选择'
        return
    }
    if (file.size > CONTRACT_MAX_MB * 1024 * 1024) {
        uploadError.value = `文件不得超过 ${CONTRACT_MAX_MB} MB`
        return
    }
    void uploadLocalFile(file)
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
            uploadError.value = '获取上传签名失败，请稍后重试'
            return
        }
        const ossResult = await uploadToOSS(file, sig, (p: number) => { localUploadProgress.value = p })
        const ossFileId = (ossResult?.fileId ?? ossResult?.id) as number | undefined
        if (!ossFileId) {
            uploadError.value = '上传成功但缺少文件标识'
            return
        }
        selectedFile.value = { id: ossFileId, fileName: file.name, fileSize: file.size, origin: 'local' }
    } catch (err) {
        uploadError.value = err instanceof Error ? err.message : '上传失败'
    } finally {
        localUploading.value = false
    }
}

// ── 文件库 ──
function openLibrary() {
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
    uploadError.value = ''
    selectedFile.value = { id: file.id, fileName: file.fileName, fileSize: file.fileSize, origin: 'library' }
}

// ── 提交 ──
async function createReview(payload: CreateReviewRequest): Promise<number | null> {
    const body: CreateReviewRequest = props.caseId ? { ...payload, caseId: props.caseId } : payload
    const resp = await useApiFetch<CreateReviewResponse>(
        '/api/v1/assistant/contract/reviews',
        { method: 'POST', body },
    )
    return resp?.reviewId ?? null
}

async function submitUpload() {
    const file = selectedFile.value
    if (!file || submitting.value || localUploading.value) return
    submitting.value = true
    try {
        const reviewId = await createReview({ sourceType: 'upload', ossFileId: file.id })
        if (reviewId) {
            emit('created', reviewId)
            reset()
        }
    } catch (err) {
        toast.error(err instanceof Error ? err.message : '创建审查失败')
    } finally {
        submitting.value = false
    }
}

async function submitPaste() {
    const text = pasteText.value.trim()
    if (!text) {
        toast.warning('请粘贴合同全文')
        return
    }
    if (text.length > PASTE_MAX) {
        toast.warning('合同内容不得超过 5 万字，请拆分或改用上传 .docx')
        return
    }
    if (pasteSubmitting.value) return
    pasteSubmitting.value = true
    try {
        const reviewId = await createReview({ sourceType: 'paste', text })
        if (reviewId) {
            emit('created', reviewId)
            pasteText.value = ''
        }
    } catch (err) {
        toast.error(err instanceof Error ? err.message : '创建审查失败')
    } finally {
        pasteSubmitting.value = false
    }
}
</script>

<template>
    <div>
        <Tabs v-model="activeTab" class="w-full gap-0">
            <!-- 头部：标题 + 分段 Tab -->
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 class="text-base font-semibold">发起新的合同审查</h2>
                    <p class="mt-1 text-xs text-muted-foreground">
                        上传 .docx、从文件库选择，或直接粘贴合同全文 —— AI 逐条扫描风险条款
                    </p>
                </div>
                <TabsList class="h-auto shrink-0 gap-[3px] rounded-[9px] border border-border">
                    <TabsTrigger value="upload"
                        class="h-auto px-[13px] py-[7px] text-[13px] leading-none text-muted-foreground data-[state=active]:bg-card dark:data-[state=active]:bg-card data-[state=active]:text-foreground dark:data-[state=active]:border-transparent data-[state=active]:shadow-[0_1px_2px_rgb(0_0_0/0.12)]">
                        <UploadIcon class="size-3.5" />选择文件
                    </TabsTrigger>
                    <TabsTrigger value="paste"
                        class="h-auto px-[13px] py-[7px] text-[13px] leading-none text-muted-foreground data-[state=active]:bg-card dark:data-[state=active]:bg-card data-[state=active]:text-foreground dark:data-[state=active]:border-transparent data-[state=active]:shadow-[0_1px_2px_rgb(0_0_0/0.12)]">
                        <ClipboardIcon class="size-3.5" />粘贴文本
                    </TabsTrigger>
                </TabsList>
            </div>

            <!-- 选择文件 -->
            <TabsContent value="upload" class="mt-4 space-y-3">
                <!-- 已选文件 -->
                <div v-if="selectedFile" class="flex items-center gap-3.5 rounded-xl border bg-background p-4">
                    <div
                        class="flex size-11 shrink-0 items-center justify-center rounded-[11px] [background-image:var(--tint-navy-bg)] text-[var(--tint-navy-fg)]">
                        <FileTextIcon class="size-5" />
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <span class="truncate text-sm font-medium">{{ selectedFile.fileName }}</span>
                            <span
                                class="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                                已就绪
                            </span>
                        </div>
                        <div class="mt-1 text-xs text-muted-foreground">
                            {{ formatSize(selectedFile.fileSize) }} ·
                            {{ selectedFile.origin === 'library' ? '来自文件库' : '本机上传' }}
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" class="size-8 shrink-0" aria-label="移除文件" @click="reset">
                        <XIcon class="size-4" />
                    </Button>
                </div>

                <!-- 未选文件 -->
                <template v-else>
                    <div class="rounded-xl border-2 border-dashed p-7 text-center transition-colors" :class="[
                        isDragging ? 'border-primary bg-primary/5' : 'border-primary/25 hover:border-primary/45',
                        localUploading ? 'cursor-default' : 'cursor-pointer',
                    ]" @click="triggerFilePicker" @dragover.prevent="!localUploading && (isDragging = true)"
                        @dragleave="isDragging = false" @drop.prevent="handleDrop">
                        <div
                            class="mx-auto flex size-12 items-center justify-center rounded-xl [background-image:var(--tint-sky-bg)] text-[var(--tint-sky-fg)]">
                            <UploadIcon class="size-6" />
                        </div>
                        <template v-if="localUploading">
                            <p class="mt-3 text-sm font-semibold">正在上传…</p>
                            <div class="mx-auto mt-3 h-1.5 w-64 max-w-full overflow-hidden rounded-full bg-muted">
                                <div class="h-full rounded-full bg-gradient-brand-button transition-all"
                                    :style="{ width: `${localUploadProgress}%` }" />
                            </div>
                            <p class="mt-1.5 font-mono text-xs text-muted-foreground">{{ localUploadProgress }}%</p>
                        </template>
                        <template v-else>
                            <h3 class="mt-3 text-sm font-semibold">
                                {{ isDragging ? '释放以上传文件' : '把合同 .docx 拖到这里' }}
                            </h3>
                            <p class="mt-1 text-xs text-muted-foreground">
                                或<span class="font-semibold text-primary"> 点击选择本地文件</span>
                            </p>
                        </template>
                    </div>

                    <div class="flex items-center gap-3 text-muted-foreground">
                        <span class="h-px flex-1 bg-border" />
                        <span class="text-[11px]">或</span>
                        <span class="h-px flex-1 bg-border" />
                    </div>

                    <Button variant="outline" class="w-full" :disabled="localUploading" @click="openLibrary">
                        <FolderIcon class="size-4" />从文件库选择已上传的合同
                    </Button>
                </template>

                <p v-if="uploadError" class="text-xs text-destructive">{{ uploadError }}</p>

                <div class="flex flex-wrap items-center justify-between gap-3">
                    <span class="text-[11px] text-muted-foreground">
                        支持 .docx · 单文件 ≤ {{ CONTRACT_MAX_MB }} MB
                    </span>
                    <Button class="bg-gradient-brand-button text-white"
                        :disabled="!selectedFile || submitting || localUploading" @click="submitUpload">
                        <Loader2Icon v-if="submitting" class="size-4 animate-spin" />
                        <SparklesIcon v-else class="size-4" />
                        {{ submitting ? '创建中...' : '开始审查' }}
                    </Button>
                </div>
            </TabsContent>

            <!-- 粘贴文本 -->
            <TabsContent value="paste" class="mt-4 space-y-3">
                <Textarea v-model="pasteText" :rows="9" :disabled="pasteSubmitting"
                    placeholder="将合同全文粘贴到这里，AI 会自动识别合同类型与风险条款…" class="resize-y font-mono text-sm" />
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <span
                        :class="['text-[11px]', pasteText.length > PASTE_MAX ? 'text-destructive' : 'text-muted-foreground']">
                        {{ pasteText.length.toLocaleString() }} / {{ PASTE_MAX.toLocaleString() }} 字
                    </span>
                    <Button class="bg-gradient-brand-button text-white" :disabled="pasteSubmitting || !canSubmitPaste"
                        @click="submitPaste">
                        <Loader2Icon v-if="pasteSubmitting" class="size-4 animate-spin" />
                        <SparklesIcon v-else class="size-4" />
                        开始审查
                    </Button>
                </div>
            </TabsContent>
        </Tabs>

        <!-- 文件库弹窗：复用案件分析的素材选择器 -->
        <CaseAnalysisMaterialSelector ref="materialSelectorRef" @files-selected="handleFilesSelected" />
        <!-- 隐藏的原生文件选择器：拖拽区点击时触发 -->
        <input ref="fileInputRef" type="file" accept=".docx" class="hidden" @change="onFileInputChange" />
    </div>
</template>
