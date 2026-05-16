<template>
  <div ref="dropZoneRef" class="relative">
    <!-- 拖拽覆盖层 -->
    <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0"
      enter-to-class="opacity-100" leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100" leave-to-class="opacity-0">
      <div v-if="isOverDropZone"
        class="absolute inset-0 z-10 flex items-center justify-center rounded-[14px] border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm">
        <div class="flex animate-pulse flex-col items-center gap-2 text-primary">
          <UploadIcon class="size-8" />
          <p class="text-sm font-semibold">释放以上传文件</p>
        </div>
      </div>
    </Transition>

    <!-- 上传区域 -->
    <div
      class="dropzone-wash flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed border-primary/35 px-6 py-9 text-center transition-colors hover:border-primary/55"
      @click="triggerFileInput">
      <div
        class="flex size-13 items-center justify-center rounded-full bg-gradient-brand text-white shadow-[0_14px_28px_-10px_rgba(30,158,237,0.4)]">
        <UploadCloudIcon class="size-6" />
      </div>
      <div>
        <p class="text-sm font-semibold">点击上传或拖拽文件到此区域</p>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ acceptHint || '支持常见文档、图片、音频格式' }}
        </p>
      </div>
    </div>

    <!-- 隐藏的文件输入 -->
    <input ref="fileInputRef" type="file" class="hidden" :accept="accept" multiple
      @change="handleFileInputChange" />

    <!-- 文件列表 -->
    <div v-if="allFiles.length > 0" class="mt-3 space-y-2">
      <div v-for="item in allFiles" :key="item.key"
        class="group flex items-center gap-3 rounded-[10px] border border-border bg-card px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-muted/40"
        :class="{ 'cursor-pointer': item.ossFileId && getRecognitionStatus(item.ossFileId) === 'success' }"
        @click="item.ossFileId && openPreview(item.ossFileId)">
        <!-- 文件图标/状态 -->
        <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Loader2Icon v-if="item.uploading" class="size-4 animate-spin text-primary" />
          <AlertCircleIcon v-else-if="item.error" class="size-4 text-destructive" />
          <FileIcon v-else class="size-4 text-muted-foreground" />
        </div>

        <!-- 文件名 + 大小/错误 -->
        <div class="min-w-0 flex-1">
          <p class="truncate text-[13px] font-medium" :class="{ 'text-destructive': item.error }">
            {{ item.name }}
          </p>
          <p class="mt-0.5 truncate text-[11.5px]" :class="item.error ? 'text-destructive' : 'text-muted-foreground'">
            {{ item.error || formatSize(item.size) }}
          </p>
        </div>

        <!-- 识别状态徽章 -->
        <Badge v-if="getRecognitionStatus(item.ossFileId) === 'recognizing'" variant="outline"
          class="text-xs px-1.5 h-5 text-blue-500 border-blue-500/40 animate-pulse bg-blue-50/50 dark:bg-blue-500/10 shrink-0">
          <Loader2Icon class="size-3 animate-spin mr-0.5" />
          识别中
        </Badge>
        <Badge v-else-if="getRecognitionStatus(item.ossFileId) === 'success'" variant="outline"
          class="text-xs px-1.5 h-5 text-green-600 border-green-500/40 bg-green-50/50 dark:bg-green-500/10 shrink-0">
          <CheckIcon class="size-3 mr-0.5" />
          已识别
        </Badge>
        <Badge v-else-if="getRecognitionStatus(item.ossFileId) === 'error'" variant="outline"
          class="text-xs px-1.5 h-5 text-red-500 border-red-500/40 cursor-pointer bg-red-50/50 dark:bg-red-500/10 shrink-0"
          @click.stop="retryRecognition(item.ossFileId!, props.modelValue)">
          <AlertCircleIcon class="size-3 mr-0.5" />
          重试
        </Badge>

        <!-- 进度条 -->
        <div v-if="item.uploading && !item.error" class="w-16 shrink-0">
          <div class="h-1.5 overflow-hidden rounded-full bg-muted-foreground/15">
            <div class="h-full rounded-full bg-primary transition-all duration-300"
              :style="{ width: `${item.progress}%` }" />
          </div>
        </div>

        <!-- 删除按钮 -->
        <Button type="button" variant="ghost" size="icon"
          class="size-7 shrink-0 text-muted-foreground transition-opacity hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
          @click.stop="removeItem(item)">
          <XIcon class="size-3.5" />
          <span class="sr-only">删除</span>
        </Button>
      </div>
    </div>

    <!-- 文档预览弹框 -->
    <CaseAnalysisDocPreviewDialog v-if="previewFile && !isAudioFile(previewFile.fileName)"
      v-model:open="previewDialogOpen" :oss-file-id="previewFile.id" :file-name="previewFile.fileName"
      :file-type="previewFile.fileType" :encrypted="previewFile.encrypted" />

    <!-- 音频预览弹框 -->
    <CaseAnalysisAudioPreviewDialog v-if="previewFile && isAudioFile(previewFile.fileName)"
      v-model:open="audioPreviewDialogOpen" :oss-file-id="previewFile.id" :file-name="previewFile.fileName"
      :encrypted="previewFile.encrypted" />
  </div>
</template>

<script lang="ts" setup>
import { useDropZone } from '@vueuse/core'
import { UploadIcon, UploadCloudIcon, FileIcon, Loader2Icon, AlertCircleIcon, XIcon, CheckIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { OssFileItem } from '~/store/file'
import { FileSource } from '#shared/types/file'
import { useBatchUpload, type FileUploadState } from '~/composables/useBatchUpload'
import { formatByteSize } from '#shared/utils/unitConverision'
import { useFileRecognition } from '~/composables/useFileRecognition'
import { isRecognizableDocFile, isImageFile, isAudioFile } from '~~/shared/utils/fileType'
import CaseAnalysisAudioPreviewDialog from '~/components/caseAnalysis/AudioPreviewDialog.vue'
import CaseAnalysisDocPreviewDialog from '~/components/caseAnalysis/DocPreviewDialog.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useFileStore } from '~/store/file'

interface Props {
  modelValue: OssFileItem[]
  accept?: string
  maxFiles?: number
  maxFileSize?: number
  acceptHint?: string
}

const props = withDefaults(defineProps<Props>(), {
  maxFiles: 20,
  maxFileSize: 0,
})

const emit = defineEmits<{
  'update:modelValue': [files: OssFileItem[]]
}>()

const fileStore = useFileStore()
const { detectMimeType, validateFile, uploadToOSS } = useBatchUpload()
const { fileRecognitionStatus, getRecognitionStatus, startRecognition, retryRecognition, clearStatus } = useFileRecognition()

const dropZoneRef = ref<HTMLDivElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const uploadingFiles = ref<FileUploadState[]>([])
const pendingTimers = new Set<ReturnType<typeof setTimeout>>()

interface DisplayItem {
  key: string
  name: string
  size: number
  uploading: boolean
  progress: number
  error?: string
  ossFileId?: number
}

const allFiles = computed<DisplayItem[]>(() => {
  const completed: DisplayItem[] = props.modelValue.map(f => ({
    key: `oss_${f.id}`,
    name: f.fileName,
    size: f.fileSize,
    uploading: false,
    progress: 100,
    ossFileId: f.id,
  }))

  const uploading: DisplayItem[] = uploadingFiles.value.map(f => ({
    key: f.id,
    name: f.file.name,
    size: f.file.size,
    uploading: f.status === 'pending' || f.status === 'uploading',
    progress: f.progress,
    error: f.status === 'error' ? (f.error || '上传失败') : undefined,
  }))

  return [...completed, ...uploading]
})

function formatSize(bytes: number): string {
  return formatByteSize(bytes, 1)
}

// 预览状态
const previewDialogOpen = ref(false)
const audioPreviewDialogOpen = ref(false)
const previewFile = ref<OssFileItem | null>(null)

function openPreview(ossFileId: number) {
  const file = props.modelValue.find(f => f.id === ossFileId)
  if (!file) return

  const isPreviewable = isRecognizableDocFile(file.fileName) || isImageFile(file.fileName) || isAudioFile(file.fileName)
  if (!isPreviewable) return

  const status = getRecognitionStatus(file.id)
  if (status !== 'success') {
    toast.info(status === 'recognizing' ? '文件正在识别中' : '文件识别未就绪')
    return
  }

  previewFile.value = file
  if (isAudioFile(file.fileName)) {
    audioPreviewDialogOpen.value = true
  } else {
    previewDialogOpen.value = true
  }
}

function triggerFileInput() {
  fileInputRef.value?.click()
}

function handleFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) {
    processFiles(Array.from(input.files))
  }
  input.value = ''
}

function removeItem(item: DisplayItem) {
  if (item.ossFileId) {
    clearStatus(item.ossFileId)
    emit('update:modelValue', props.modelValue.filter(f => f.id !== item.ossFileId))
  } else {
    uploadingFiles.value = uploadingFiles.value.filter(f => f.id !== item.key)
  }
}

// 监听 modelValue 变化，对新增的可识别文件查询识别状态
watch(() => props.modelValue, (files, oldFiles) => {
  const oldIds = new Set((oldFiles ?? []).map(f => f.id))
  const newFiles = files.filter(f => !oldIds.has(f.id))
  if (newFiles.length === 0) return

  // 对新增文件逐个查询识别状态
  for (const file of newFiles) {
    if (!isRecognizableDocFile(file.fileName) && !isImageFile(file.fileName) && !isAudioFile(file.fileName)) continue
    if (getRecognitionStatus(file.id)) continue

    // 查询当前识别状态
    checkFileRecognitionStatus(file.id)
  }
}, { immediate: true })

async function checkFileRecognitionStatus(ossFileId: number) {
  try {
    const response = await useApiFetch<{
      recognized: boolean
      status: number
    }>(`/api/v1/recognition/status/${ossFileId}`, {
      method: 'GET',
      showError: false,
    })
    if (!response) return

    const recognized = response.recognized === true || response.status === 2
    if (recognized) {
      fileRecognitionStatus.value.set(ossFileId, 'success')
    } else if (response.status === 3) {
      fileRecognitionStatus.value.set(ossFileId, 'error')
    } else {
      // 仍在识别中，启动轮询
      startRecognition([ossFileId], props.modelValue)
    }
  } catch {
    // 查询失败，尝试启动识别
    startRecognition([ossFileId], props.modelValue)
  }
}

async function processFiles(files: File[]) {
  const totalCount = props.modelValue.length + uploadingFiles.value.length
  if (totalCount + files.length > props.maxFiles) {
    toast.warning(`最多上传 ${props.maxFiles} 个文件`)
    return
  }

  const scenes = await fileStore.getUploadConfig(FileSource.CASE_ANALYSIS)
  const currentScene = scenes?.[0] ?? null

  const validFiles: FileUploadState[] = []

  for (const file of files) {
    if (props.maxFileSize && file.size > props.maxFileSize) {
      toast.error(`文件 "${file.name}" 超出大小限制`)
      continue
    }

    const validation = validateFile(file, currentScene)
    if (!validation.valid) {
      toast.error(`文件 "${file.name}" ${validation.message}`)
      continue
    }

    const isDuplicate =
      props.modelValue.some(f => f.fileName === file.name && f.fileSize === file.size)
      || uploadingFiles.value.some(f => f.file.name === file.name && f.file.size === file.size)

    if (isDuplicate) {
      toast.warning(`文件 "${file.name}" 已在列表中`)
      continue
    }

    validFiles.push({
      id: `upload_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      file,
      mimeType: detectMimeType(file),
      status: 'pending',
      progress: 0,
    })
  }

  if (validFiles.length === 0) return

  uploadingFiles.value.push(...validFiles)

  const filesInfo = validFiles.map(s => ({
    originalFileName: s.file.name,
    fileSize: s.file.size,
    mimeType: s.mimeType,
  }))

  try {
    const signatures = await fileStore.getBatchPresignedUrls({
      source: FileSource.CASE_ANALYSIS,
      files: filesInfo,
      encrypted: false,
    })

    if (!signatures || signatures.length !== validFiles.length) {
      throw new Error(fileStore.error || '获取签名失败')
    }

    const uploadPromises = validFiles.map(async (state, index) => {
      const signature = signatures[index]
      if (!signature) {
        state.status = 'error'
        state.error = '无签名'
        return
      }

      state.signature = signature
      state.status = 'uploading'

      try {
        const data = await uploadToOSS(state.file, signature, (progress) => {
          state.progress = progress
        })

        state.status = 'success'
        state.progress = 100

        const newFile: OssFileItem = {
          id: (data.fileId || data.id) as number,
          fileName: state.file.name,
          fileSize: state.file.size,
          fileType: state.mimeType,
          source: FileSource.CASE_ANALYSIS,
          sourceName: '案件分析',
          status: 1,
          statusName: '正常',
          encrypted: false,
          createdAt: new Date().toISOString(),
        }

        const TRANSITION_DELAY_MS = 500
        const timer = setTimeout(() => {
          pendingTimers.delete(timer)
          uploadingFiles.value = uploadingFiles.value.filter(f => f.id !== state.id)
          const current = [...props.modelValue]
          if (!current.some(f => f.id === newFile.id)) {
            emit('update:modelValue', [...current, newFile])
            nextTick(() => startRecognition([newFile.id], [...current, newFile]))
          }
        }, TRANSITION_DELAY_MS)
        pendingTimers.add(timer)
      } catch (err) {
        state.status = 'error'
        state.error = err instanceof Error ? err.message : '上传失败'
      }
    })

    await Promise.all(uploadPromises)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '上传失败')
    for (const state of validFiles) {
      if (state.status === 'pending') {
        state.status = 'error'
        state.error = '获取签名失败'
      }
    }
  }
}

const { isOverDropZone } = useDropZone(dropZoneRef, {
  onDrop: (files) => {
    if (files && files.length > 0) {
      processFiles(Array.from(files))
    }
  },
})

onUnmounted(() => {
  for (const timer of pendingTimers) {
    clearTimeout(timer)
  }
  pendingTimers.clear()
})
</script>
