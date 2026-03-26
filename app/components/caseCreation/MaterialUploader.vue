<template>
  <div ref="dropZoneRef" class="relative">
    <!-- 拖拽覆盖层 -->
    <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0"
      enter-to-class="opacity-100" leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100" leave-to-class="opacity-0">
      <div v-if="isOverDropZone"
        class="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg">
        <div class="flex flex-col items-center gap-2 text-primary animate-pulse">
          <UploadIcon class="size-8" />
          <p class="text-sm font-bold">释放以上传文件</p>
        </div>
      </div>
    </Transition>

    <!-- 上传区域 -->
    <div
      class="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/30 cursor-pointer"
      @click="triggerFileInput">
      <div class="rounded-full bg-muted p-3">
        <UploadCloudIcon class="size-6 text-muted-foreground" />
      </div>
      <div>
        <p class="text-sm font-medium">点击上传或拖拽文件到此区域</p>
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
        class="group flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted/50">
        <!-- 文件图标/状态 -->
        <div class="shrink-0">
          <Loader2Icon v-if="item.uploading" class="size-4 animate-spin text-primary" />
          <AlertCircleIcon v-else-if="item.error" class="size-4 text-destructive" />
          <FileIcon v-else class="size-4 text-muted-foreground" />
        </div>

        <!-- 文件名 -->
        <span class="flex-1 truncate" :class="{ 'text-destructive': item.error }">
          {{ item.name }}
        </span>

        <!-- 文件大小 -->
        <span class="shrink-0 text-xs text-muted-foreground">
          {{ formatSize(item.size) }}
        </span>

        <!-- 进度条 -->
        <div v-if="item.uploading && !item.error" class="w-16 shrink-0">
          <div class="h-1.5 rounded-full bg-muted-foreground/20 overflow-hidden">
            <div class="h-full bg-primary transition-all duration-300 rounded-full"
              :style="{ width: `${item.progress}%` }" />
          </div>
        </div>

        <!-- 错误提示 -->
        <span v-if="item.error" class="shrink-0 text-xs text-destructive">{{ item.error }}</span>

        <!-- 删除按钮 -->
        <Button type="button" variant="ghost" size="icon"
          class="size-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          @click.stop="removeItem(item)">
          <XIcon class="size-3.5" />
          <span class="sr-only">删除</span>
        </Button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useDropZone } from '@vueuse/core'
import { UploadIcon, UploadCloudIcon, FileIcon, Loader2Icon, AlertCircleIcon, XIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { OssFileItem } from '~/store/file'
import { FileSource } from '#shared/types/file'
import { useBatchUpload, type FileUploadState } from '~/composables/useBatchUpload'
import { formatByteSize } from '#shared/utils/unitConverision'

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
    emit('update:modelValue', props.modelValue.filter(f => f.id !== item.ossFileId))
  } else {
    uploadingFiles.value = uploadingFiles.value.filter(f => f.id !== item.key)
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
          // 用函数式更新避免并发 emit 竞态：基于最新 props.modelValue 追加
          const current = [...props.modelValue]
          if (!current.some(f => f.id === newFile.id)) {
            emit('update:modelValue', [...current, newFile])
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
