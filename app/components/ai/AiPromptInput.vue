<template>
  <div class="@container/prompt flex size-full flex-col justify-end relative p-4 @max-[400px]/prompt:p-2" ref="dropZoneRef">
    <div class="px-0 relative">
      <!-- 全屏拖拽覆盖层 -->
      <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100" leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 scale-100" leave-to-class="opacity-0 scale-95">
        <div v-if="enableFileUpload && isOverDropZone"
          class="absolute inset-0 z-50 flex items-center justify-center p-2 bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary rounded-md overflow-hidden">
          <div class="flex flex-col items-center gap-2 text-primary animate-pulse">
            <div class="p-2 bg-primary/20 rounded-full shrink-0">
              <UploadIcon class="size-8" />
            </div>
            <p class="text-sm font-bold whitespace-nowrap">释放以添加文件</p>
          </div>
        </div>
      </Transition>

      <PromptInputProvider @submit="handleSubmit">
        <InternalStateSync />
        <PromptInput global-drop multiple
          class="**:data-[slot=input-group]:shadow-none **:data-[slot=input-group]:border-primary **:data-[slot=input-group]:rounded-md transition-all">
          <!-- 头部：自定义文件列表 -->
          <PromptInputHeader v-if="enableFileUpload && (selectedFiles.length > 0 || uploadingFiles.length > 0)">
            <div class="flex flex-wrap items-center gap-2 pt-3 pb-1 px-1 w-full">
              <!-- 已选文件 -->
              <div v-for="file in selectedFiles" :key="file.id"
                class="group relative flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-md border border-border px-1.5 font-medium text-sm transition-all hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50"
                @click="openPreview(file)">
                <!-- 文件图标 -->
                <div class="relative size-5 shrink-0 flex items-center justify-center">
                  <component :is="getFileIcon(file.fileType)" :class="['size-4', getFileIconColor(file.fileType)]" />
                </div>

                <!-- 文件名 -->
                <span class="flex-1 truncate max-w-[120px]">{{ file.fileName }}</span>

                <!-- 识别状态徽章 -->
                <Badge v-if="getRecognitionStatus(file.id) === 'recognizing'" variant="outline"
                  class="text-xs px-1 h-5 text-blue-500 border-blue-500 animate-pulse bg-blue-50/50 dark:bg-blue-500/10">
                  <Loader2Icon class="size-3 animate-spin mr-0.5" />
                  识别中
                </Badge>
                <Badge v-else-if="getRecognitionStatus(file.id) === 'success'" variant="outline"
                  class="text-xs px-1 h-5 text-green-500 border-green-500 bg-green-50/50 dark:bg-green-500/10 transition-colors">
                  <CheckIcon class="size-3 mr-0.5" />
                  已识别
                </Badge>
                <Badge v-else-if="getRecognitionStatus(file.id) === 'error'" variant="outline"
                  class="text-xs px-1 h-5 text-red-500 border-red-500 cursor-pointer bg-red-50/50 dark:bg-red-500/10"
                  @click.stop="retryRecognition(file)">
                  <AlertCircleIcon class="size-3 mr-0.5" />
                  重试
                </Badge>

                <!-- 加密徽章 -->
                <Badge v-if="file.encrypted" variant="secondary" class="text-xs px-1 h-5">
                  <LockIcon class="size-3" />
                </Badge>

                <!-- 移除按钮 -->
                <Button type="button" variant="ghost" size="icon"
                  class="size-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  @click.stop="removeFile(file.id)">
                  <XIcon class="size-3" />
                  <span class="sr-only">移除</span>
                </Button>
              </div>

              <!-- 正在上传的文件 -->
              <div v-for="fileState in uploadingFiles" :key="fileState.id"
                class="group relative flex h-8 cursor-default select-none items-center gap-1.5 rounded-md border border-border px-1.5 font-medium text-sm transition-all bg-muted/30">
                <div class="relative size-5 shrink-0 flex items-center justify-center">
                  <Loader2Icon class="size-3.5 animate-spin text-primary"
                    v-if="fileState.status === 'uploading' || fileState.status === 'pending'" />
                  <AlertCircleIcon class="size-3.5 text-destructive" v-else-if="fileState.status === 'error'" />
                  <CheckIcon class="size-3.5 text-green-500" v-else />
                </div>
                <span class="flex-1 truncate max-w-[120px]"
                  :class="{ 'text-destructive': fileState.status === 'error' }">{{ fileState.file.name }}</span>
                <!-- 进度条 -->
                <div class="w-12 h-1 bg-muted-foreground/20 rounded-full overflow-hidden ml-1"
                  v-if="fileState.status === 'uploading'">
                  <div class="h-full bg-primary transition-all duration-300"
                    :style="{ width: fileState.progress + '%' }">
                  </div>
                </div>
                <span class="text-[10px] text-destructive ml-1" v-if="fileState.status === 'error'"
                  :title="fileState.error">失败</span>

                <!-- 移除出错的任务 -->
                <Button v-if="fileState.status === 'error'" type="button" variant="ghost" size="icon"
                  class="size-5 p-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  @click.stop="removeUploadingFile(fileState.id)">
                  <XIcon class="size-3" />
                </Button>
              </div>
            </div>
          </PromptInputHeader>
          <!-- 中间部分 -->
          <PromptInputBody>
            <PromptInputTextarea :placeholder="placeholder" :min-rows="minRows" :max-rows="maxRows"
              :class="['px-4 @max-[400px]/prompt:px-3', selectedFiles.length > 0 ? 'pt-0' : 'pt-6 @max-[400px]/prompt:pt-4']" />
          </PromptInputBody>
          <!-- 底部 -->
          <PromptInputFooter class="border-t border-muted-foreground/20 border-dashed px-4 @max-[400px]/prompt:px-2">
            <!-- 工具栏 -->
            <PromptInputTools class="px-0">
              <PromptInputButton v-if="enableFileUpload" variant="ghost" @click="handleFileButtonClick"
                class="ml-[-8px] hover:bg-primary/5 transition-colors">
                <Paperclip class="text-muted-foreground" :size="16" />
                {{ uploadButtonLabel }}
                <span v-if="selectedFiles.length > 0" class="ml-1 text-xs text-primary font-bold">({{
                  selectedFiles.length
                }})</span>
              </PromptInputButton>
              <TooltipProvider v-if="showThinkingToggle">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <PromptInputButton variant="ghost"
                      :class="['transition-colors', thinking ? 'text-primary hover:bg-primary/5' : 'text-muted-foreground hover:bg-muted/50']"
                      @click="thinking = !thinking">
                      <BrainIcon :size="16" />
                      深度思考
                    </PromptInputButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{{ thinking ? '深度思考已开启，AI 将展示推理过程' : '深度思考已关闭' }}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </PromptInputTools>
            <!-- 提交按钮 -->
            <div class="flex items-center gap-2 mr-[-8px] @max-[400px]/prompt:gap-1">
              <!-- 非 loading 态：使用原有 PromptInputSubmit（承担 type=submit 原生提交） -->
              <PromptInputSubmit
                v-if="!loading"
                class="h-9 px-4! rounded-md shadow-lg shadow-primary/20 active:scale-95 transition-all @max-[400px]/prompt:h-8 @max-[400px]/prompt:px-3!"
                :status="submitStatus"
                :disabled="isSendDisabled"
                size="xs"
                data-testid="send-button"
                @submit="handleSubmitFromButton"
              >
                <SendHorizontal class="size-4" />
                <span v-if="submitLabel" class="ml-1">{{ submitLabel }}</span>
              </PromptInputSubmit>

              <!-- loading 态：独立的停止 + 加入队列双按钮 -->
              <!-- 原 @stop="emit('stop')" 是死代码（PromptInputSubmit 未声明 stop emit），此处用独立 Button 替代 -->
              <div v-else class="flex items-center gap-1.5">
                <!-- 停止按钮：destructive 变体（红色突出）+ icon-sm 方形图标按钮
                     让用户一眼识别危险/中止操作；isStopping=true 时禁用防止重复点击 -->
                <Button
                  type="button"
                  size="icon-sm"
                  variant="destructive"
                  :disabled="props.isStopping"
                  aria-label="停止当前对话"
                  data-testid="stop-button"
                  @click="onStopClick"
                >
                  <SquareIcon class="size-4 fill-current" />
                </Button>

                <!-- 加入队列按钮：有内容且队列未满时可用，右上角显示 +N 角标 -->
                <div class="relative">
                  <Button
                    type="button"
                    size="sm"
                    :disabled="isEnqueueDisabled"
                    :aria-disabled="isEnqueueDisabled"
                    :aria-label="`加入发送队列（当前已有 ${props.queueLength ?? 0} 条）`"
                    :title="props.queueFull ? '队列已满（最多 5 条）' : undefined"
                    data-testid="enqueue-button"
                    @click="handleSubmitFromButton"
                  >
                    <SendHorizontal class="size-4" />
                  </Button>
                  <Badge
                    v-if="(props.queueLength ?? 0) > 0"
                    class="absolute -top-1 -right-1 px-1 h-4 min-w-4 text-[10px]"
                    variant="secondary"
                  >
                    +{{ props.queueLength }}
                  </Badge>
                </div>
              </div>
            </div>
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>

    <!-- 隐藏的文件输入 -->
    <input ref="fileInputRef" type="file" multiple class="hidden" @change="handleFileInputChange" />

    <!-- 文档预览弹框 -->
    <CaseAnalysisDocPreviewDialog v-if="enableFileUpload && previewFile && !isAudioFile(previewFile.fileName)"
      v-model:open="previewDialogOpen" :oss-file-id="previewFile.id" :file-name="previewFile.fileName"
      :file-type="previewFile.fileType" :encrypted="previewFile.encrypted" />

    <!-- 音频预览弹框 -->
    <CaseAnalysisAudioPreviewDialog v-if="enableFileUpload && previewFile && isAudioFile(previewFile.fileName)"
      v-model:open="audioPreviewDialogOpen" :oss-file-id="previewFile.id" :file-name="previewFile.fileName"
      :encrypted="previewFile.encrypted" />
  </div>
</template>

<script lang="ts" setup>
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { PromptInput, PromptInputBody, PromptInputButton, PromptInputFooter, PromptInputHeader, PromptInputProvider, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "@/components/ai-elements/prompt-input";
import { usePromptInput } from "@/components/ai-elements/prompt-input/context";
import { Paperclip, SendHorizontal, XIcon, LockIcon, Loader2Icon, CheckIcon, AlertCircleIcon, UploadIcon, BrainIcon, SquareIcon } from "lucide-vue-next";
import { toast } from "vue-sonner";
import { useDocumentVisibility, useDropZone } from '@vueuse/core';
import type { OssFileItem } from "~/store/file";
import { getFileIcon, getFileIconColor } from "~/utils/file";
import { isImageFile, isAudioFile, isRecognizableDocFile } from "~~/shared/utils/fileType";
import { FileSource } from "#shared/types/file";
import { useBatchUpload, type FileUploadState } from '~/composables/useBatchUpload';
import CaseAnalysisAudioPreviewDialog from '~/components/caseAnalysis/AudioPreviewDialog.vue'
import CaseAnalysisDocPreviewDialog from '~/components/caseAnalysis/DocPreviewDialog.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useFileStore } from '~/store/file'

/**
 * 通用 AI 输入框提交数据
 */
export interface AiPromptSubmitData {
  text: string
  files?: OssFileItem[]
}

const props = withDefaults(defineProps<{
  placeholder?: string
  loading?: boolean
  disabled?: boolean
  enableFileUpload?: boolean
  showThinkingToggle?: boolean
  minRows?: number
  maxRows?: number
  submitLabel?: string
  uploadButtonLabel?: string
  onFileButtonClick?: () => void
  /** 当前队列条目数，loading 态下用于显示 +N 角标 */
  queueLength?: number
  /** 队列是否已满，满时加入队列按钮禁用 */
  queueFull?: boolean
  /** 停止中状态，true 时停止按钮置灰禁用（防止重复点击） */
  isStopping?: boolean
}>(), {
  placeholder: '输入消息...',
  loading: false,
  disabled: false,
  enableFileUpload: true,
  showThinkingToggle: true,
  minRows: 1,
  maxRows: 4,
  uploadButtonLabel: '上传材料',
})

const emit = defineEmits<{
  submit: [data: AiPromptSubmitData]
  stop: []
}>()

// 显式 method 而非 inline `@click="emit('stop')"`，避免 shadcn Button + reka-ui
// Primitive 的 fallthrough attrs 链路在某些情况下丢失 inline emit 表达式的问题
function onStopClick() {
  emit('stop')
}

const thinking = defineModel<boolean>('thinking', { default: true })
const fileStore = useFileStore();
const { detectMimeType, validateFile, uploadToOSS } = useBatchUpload();

// 本地正在上传的文件列表
const uploadingFiles = ref<FileUploadState[]>([]);

function removeUploadingFile(id: string) {
  uploadingFiles.value = uploadingFiles.value.filter(f => f.id !== id);
}

// 选择的文件
const selectedFiles = ref<OssFileItem[]>([]);

// 文件识别状态映射：ossFileId -> 状态
const fileRecognitionStatus = ref<Map<number, 'idle' | 'recognizing' | 'success' | 'error'>>(new Map());

// 轮询定时器引用
const pollingTimers = ref<Map<number, NodeJS.Timeout>>(new Map());

// 轮询间隔（毫秒）
const POLLING_INTERVAL = 2000;
// 最大轮询次数（避免无限轮询）
const MAX_POLLING_ATTEMPTS = 60; // 60 * 2s = 120s

// 预览弹框状态
const previewDialogOpen = ref(false);
const audioPreviewDialogOpen = ref(false);
const previewFile = ref<OssFileItem | null>(null);

// 计算已选文件 ID 列表
const selectedFileIds = computed(() => selectedFiles.value.map(f => f.id))

// 检查是否有文件在识别中
const isAllRecognizing = computed(() => {
  return selectedFiles.value.some(f => getRecognitionStatus(f.id) === 'recognizing');
})

// 局部状态，用于追踪输入框内容
const internalPromptText = ref('')

/**
 * 内部状态同步组件
 * 必须放在 PromptInputProvider 内部才能使用 usePromptInput
 */
const InternalStateSync = defineComponent({
  setup() {
    const ctx = usePromptInput()
    watch(ctx.textInput, (val) => {
      internalPromptText.value = val || ''
    }, { immediate: true })
    // 缓存 Provider 方法到外部 ref
    clearInput.value = ctx.clearInput
    clearFiles.value = ctx.clearFiles
    setTextInput.value = ctx.setTextInput
    return () => null
  }
})

// 计算是否有内容（文本或附件）
const hasContent = computed(() => {
  const hasText = !!internalPromptText.value?.trim()
  const hasAttachments = props.enableFileUpload && selectedFiles.value.length > 0
  return hasText || hasAttachments
})

// 计算是否繁忙（上传中、识别中或组件被禁用）
const isBusy = computed(() =>
  uploadingFiles.value.length > 0 || isAllRecognizing.value || props.disabled
)

/** 普通发送按钮：无内容或忙时禁用 */
const isSendDisabled = computed(() => !hasContent.value || isBusy.value)

/** 加入队列按钮：无内容、忙、或队列满时禁用 */
const isEnqueueDisabled = computed(() =>
  !hasContent.value || isBusy.value || !!props.queueFull
)

// 提交状态：由外部 loading prop 派生
const submitStatus = computed<"submitted" | "streaming" | "ready" | "error">(() => {
  if (props.loading) return 'streaming'
  return 'ready'
})

// 文件输入引用
const fileInputRef = ref<HTMLInputElement | null>(null);

function triggerFileInput() {
  fileInputRef.value?.click();
}

function handleFileButtonClick() {
  if (props.onFileButtonClick) {
    props.onFileButtonClick()
  } else {
    triggerFileInput()
  }
}

function handleFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (files && files.length > 0) {
    handleFileDrop(Array.from(files));
  }
  // 重置 input 以允许再次选择相同文件
  input.value = '';
}

// 拖拽上传支持
const dropZoneRef = ref<HTMLDivElement | null>(null);
const { isOverDropZone } = useDropZone(dropZoneRef, {
  onDrop: async (files) => {
    if (!props.enableFileUpload) return;
    if (!files || files.length === 0) return;
    handleFileDrop(files);
  }
});

async function handleFileDrop(files: File[]) {
  try {
    const scenes = await fileStore.getUploadConfig(FileSource.CASE_ANALYSIS)
    const currentScene = scenes?.[0] ?? null

    const validFilesToUpload: FileUploadState[] = []

    for (const file of files) {
      const validation = validateFile(file, currentScene)
      if (!validation.valid) {
        toast.error(`文件 "${file.name}" ${validation.message}`)
        continue;
      }

      // 查重
      const isDuplicate =
        selectedFiles.value.some(f => f.fileName === file.name && f.fileSize === file.size) ||
        uploadingFiles.value.some(f => f.file.name === file.name && f.file.size === file.size)

      if (isDuplicate) {
        toast.warning(`文件 "${file.name}" 已在列表中`)
        continue;
      }

      const id = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      validFilesToUpload.push({
        id,
        file,
        mimeType: detectMimeType(file),
        status: 'pending',
        progress: 0
      })
    }

    if (validFilesToUpload.length === 0) return

    // 将合法文件加入正在上传列表
    uploadingFiles.value.push(...validFilesToUpload)

    // 批量获取签名
    const filesInfo = validFilesToUpload.map((state) => ({
      originalFileName: state.file.name,
      fileSize: state.file.size,
      mimeType: state.mimeType,
    }));

    const signatures = await fileStore.getBatchPresignedUrls({
      source: FileSource.CASE_ANALYSIS,
      files: filesInfo,
      encrypted: false,
    });

    if (!signatures || signatures.length !== validFilesToUpload.length) {
      throw new Error(fileStore.error || "批量获取签名失败");
    }

    // 开始并发上传
    const uploadPromises = validFilesToUpload.map(async (state, index) => {
      const signature = signatures[index]
      if (!signature) {
        state.status = 'error'
        state.error = '无签名'
        return null
      }

      state.signature = signature
      state.status = 'uploading'

      try {
        const data = await uploadToOSS(state.file, signature, (progress) => {
          state.progress = progress
        })
        state.status = 'success'
        state.progress = 100
        state.result = data

        // 延迟移除成功的状态并将其转为已选文件
        setTimeout(() => {
          removeUploadingFile(state.id)

          const newFileObject: OssFileItem = {
            id: (data.fileId || data.id) as number,
            fileName: state.file.name,
            fileSize: state.file.size,
            fileType: state.mimeType,
            source: FileSource.CASE_ANALYSIS,
            sourceName: '文件上传',
            status: 1,
            statusName: '正常',
            encrypted: false,
            createdAt: new Date().toISOString()
          }

          handleFilesSelected([newFileObject])
        }, 1000)

        return { state, data }
      } catch (err) {
        state.status = 'error'
        state.error = err instanceof Error ? err.message : '上传失败'
        return null
      }
    })

    await Promise.all(uploadPromises)

  } catch (err) {
    toast.error(err instanceof Error ? err.message : '上传配置获取失败')
  }
}

// Visibility API 优化轮询
const visibility = useDocumentVisibility();
watch(visibility, (state) => {
  if (state === 'visible') {
    // 恢复所有轮询
    fileRecognitionStatus.value.forEach((status, id) => {
      if (status === 'recognizing' && !pollingTimers.value.has(id)) {
        pollFileStatus(id);
      }
    });
  } else {
    // 暂停所有轮询
    stopAllPolling();
  }
});

// 通过 InternalStateSync 在 Provider 内部获取的方法
const clearInput = ref<(() => void) | null>(null)
const clearFiles = ref<(() => void) | null>(null)
const setTextInput = ref<((val: string) => void) | null>(null)

function reset() {
  selectedFiles.value = []
  fileRecognitionStatus.value.clear()
  stopAllPolling()
  clearInput.value?.()
  clearFiles.value?.()
}

defineExpose({
  reset,
  hasContent() {
    return !!internalPromptText.value?.trim() || selectedFiles.value.length > 0
  },
  setText(text: string) {
    setTextInput.value?.(text)
  },
  addFiles: handleFilesSelected,
  get selectedFileIds() {
    return selectedFiles.value.map(f => f.id)
  },
})

function getRecognitionStatus(fileId: number): 'idle' | 'recognizing' | 'success' | 'error' | null {
  return fileRecognitionStatus.value.get(fileId) || null;
}

async function pollFileStatus(ossFileId: number, attemptCount = 0) {
  if (visibility.value !== 'visible') return;
  if (attemptCount >= MAX_POLLING_ATTEMPTS) {
    fileRecognitionStatus.value.set(ossFileId, 'error');
    pollingTimers.value.delete(ossFileId);
    return;
  }

  try {
    const response = await useApiFetch<{
      recognized: boolean;
      status: number;
    }>(`/api/v1/recognition/status/${ossFileId}`, {
      method: 'GET',
      showError: false,
    });

    if (!response) {
      scheduleNextPoll(ossFileId, attemptCount);
      return;
    }

    const recognized = response.recognized === true || response.status === 2;
    if (recognized) {
      fileRecognitionStatus.value.set(ossFileId, 'success');
      pollingTimers.value.delete(ossFileId);
    } else if (response.status === 3) {
      fileRecognitionStatus.value.set(ossFileId, 'error');
      pollingTimers.value.delete(ossFileId);
    } else {
      scheduleNextPoll(ossFileId, attemptCount);
    }
  } catch (error) {
    scheduleNextPoll(ossFileId, attemptCount);
  }
}

/** 调度下一次轮询，清理旧 timer 避免并发轮询 */
function scheduleNextPoll(ossFileId: number, attemptCount: number) {
  const existing = pollingTimers.value.get(ossFileId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => pollFileStatus(ossFileId, attemptCount + 1), POLLING_INTERVAL);
  pollingTimers.value.set(ossFileId, timer);
}

function stopPolling(ossFileId: number) {
  const timer = pollingTimers.value.get(ossFileId);
  if (timer) {
    clearTimeout(timer);
    pollingTimers.value.delete(ossFileId);
  }
}

function stopAllPolling() {
  pollingTimers.value.forEach(clearTimeout);
  pollingTimers.value.clear();
}

async function retryRecognition(file: OssFileItem) {
  fileRecognitionStatus.value.set(file.id, 'recognizing');
  try {
    const response = await useApiFetch<{
      results: Array<{ ossFileId: number; status: 'processing' | 'completed' | 'failed' }>;
    }>('/api/v1/recognition/start', {
      method: 'POST',
      body: { ossFileIds: [file.id] }
    });

    if (response?.results) {
      for (const result of response.results) {
        if (result.status === 'completed') {
          fileRecognitionStatus.value.set(result.ossFileId, 'success');
        } else if (result.status === 'processing') {
          pollFileStatus(result.ossFileId);
        } else {
          fileRecognitionStatus.value.set(result.ossFileId, 'error');
        }
      }
    }
  } catch (error) {
    fileRecognitionStatus.value.set(file.id, 'error');
  }
}

function openPreview(file: OssFileItem) {
  const isDoc = isRecognizableDocFile(file.fileName);
  const isImage = isImageFile(file.fileName);
  const isAudio = isAudioFile(file.fileName);
  if (!isDoc && !isImage && !isAudio) return;

  const recognitionStatus = getRecognitionStatus(file.id);
  if (recognitionStatus !== 'success') {
    toast.info(recognitionStatus === 'recognizing' ? '文件正在识别中' : '文件识别未就绪');
    return;
  }

  previewFile.value = file;
  if (isAudio) audioPreviewDialogOpen.value = true;
  else previewDialogOpen.value = true;
}

function removeFile(fileId: number) {
  selectedFiles.value = selectedFiles.value.filter(f => f.id !== fileId)
  fileRecognitionStatus.value.delete(fileId);
  stopPolling(fileId);
}

async function handleFilesSelected(files: OssFileItem[]) {
  const newFiles = files.filter(f => !selectedFileIds.value.includes(f.id))
  selectedFiles.value = [...selectedFiles.value, ...newFiles]

  const fileIdsToRecognize = newFiles
    .filter(f => isRecognizableDocFile(f.fileName) || isImageFile(f.fileName) || isAudioFile(f.fileName))
    .map(f => f.id);

  if (fileIdsToRecognize.length > 0) {
    fileIdsToRecognize.forEach(id => fileRecognitionStatus.value.set(id, 'recognizing'));
    try {
      const response = await useApiFetch<{
        results: Array<{ ossFileId: number; status: 'processing' | 'completed' | 'failed'; error?: string }>;
      }>('/api/v1/recognition/start', {
        method: 'POST',
        body: { ossFileIds: fileIdsToRecognize },
        showError: false
      });

      if (!response) {
        fileIdsToRecognize.forEach(id => fileRecognitionStatus.value.set(id, 'error'));
        return;
      }

      response.results.forEach(result => {
        if (result.status === 'completed') fileRecognitionStatus.value.set(result.ossFileId, 'success');
        else if (result.status === 'processing') {
          fileRecognitionStatus.value.set(result.ossFileId, 'recognizing');
          pollFileStatus(result.ossFileId);
        } else {
          fileRecognitionStatus.value.set(result.ossFileId, 'error');
          if (result.error) toast.error(`文件识别失败：${result.error}`);
        }
      });
    } catch (error) {
      fileIdsToRecognize.forEach(id => fileRecognitionStatus.value.set(id, 'error'));
    }
  }
}

async function handleSubmit(message: PromptInputMessage) {
  const hasText = !!message.text?.trim();
  const hasAttachments = props.enableFileUpload && selectedFiles.value.length > 0;
  if (!hasText && !hasAttachments) {
    toast.warning("请输入消息内容");
    return;
  }
  if (isAllRecognizing.value) {
    toast.warning("请等待文件识别完成后再提交");
    return;
  }

  const data: AiPromptSubmitData = {
    text: message.text?.trim() || '',
    files: selectedFiles.value.length > 0 ? [...selectedFiles.value] : undefined,
  }
  emit('submit', data)
}

// 由 PromptInputSubmit 按钮直接调用（绕过 form submit）
async function handleSubmitFromButton() {
  // PromptInputSubmit 已确保此时不是 streaming/submitted 状态，直接用输入框当前内容提交
  await handleSubmit({ text: internalPromptText.value || '', files: [] })
}

onUnmounted(stopAllPolling);
</script>
