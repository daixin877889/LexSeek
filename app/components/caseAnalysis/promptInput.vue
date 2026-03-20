<template>
  <div class="flex size-full flex-col justify-end relative" ref="dropZoneRef">
    <div class="px-4 relative">
      <!-- 全屏拖拽覆盖层 -->
      <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100" leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 scale-100" leave-to-class="opacity-0 scale-95">
        <div v-if="isOverDropZone"
          class="absolute inset-x-4 inset-y-0 z-50 flex items-center justify-center p-4 bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary rounded-md">
          <div class="flex flex-col items-center gap-4 text-primary animate-pulse">            <div class="p-4 bg-primary/20 rounded-full">
              <UploadIcon class="size-12" />
            </div>
            <p class="text-xl font-bold">释放以添加案情材料</p>
            <p class="text-sm opacity-80">支持 文本、文档、音频、图片</p>
          </div>
        </div>
      </Transition>

      <PromptInputProvider @submit="handleSubmit">
        <!-- 输入状态监听器，同步状态到 store -->
        <CaseAnalysisPromptInputWatcher v-if="enableWatcher" />
        <PromptInput global-drop multiple
          class="**:data-[slot=input-group]:shadow-none **:data-[slot=input-group]:border-primary **:data-[slot=input-group]:rounded-md transition-all">
          <!-- 头部：自定义文件列表 -->
          <PromptInputHeader v-if="selectedFiles.length > 0 || uploadingFiles.length > 0">
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
                  <div class="h-full bg-primary transition-all duration-300" :style="{ width: fileState.progress + '%' }">
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
              :class="['px-4', selectedFiles.length > 0 ? 'pt-0' : 'pt-6']" />
          </PromptInputBody>
          <!-- 底部 -->
          <PromptInputFooter class="border-t border-muted-foreground/20 border-dashed px-4">
            <!-- 工具栏 -->
            <PromptInputTools class="px-0">
              <PromptInputButton variant="ghost" @click="selectMaterial"
                class="ml-[-8px] hover:bg-primary/5 transition-colors">
                <Paperclip class="text-muted-foreground" :size="16" />
                案情材料
                <span v-if="selectedFiles.length > 0" class="ml-1 text-xs text-primary font-bold">({{
                  selectedFiles.length
                }})</span>
              </PromptInputButton>
              <span class="text-muted-foreground text-xs"> </span>
            </PromptInputTools>
            <!-- 附件上传 -->
            <div class="flex items-center gap-2 mr-[-8px]"> <!-- 提交按钮 -->
              <PromptInputSubmit class="h-9 px-4! rounded-md shadow-lg shadow-primary/20 active:scale-95 transition-all"
                :status="submitStatus" :disabled="disabled || isAllRecognizing" size="xs">
                <SendHorizontal class="size-4" />
                <span class="ml-1.5">{{ submitLabel }}</span>
              </PromptInputSubmit>
            </div>
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>

    <!-- 文件选择弹框 -->
    <CaseAnalysisMaterialSelector ref="materialSelectorRef" :disabled-file-ids="selectedFileIds"
      @filesSelected="handleFilesSelected" />

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
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { PromptInput, PromptInputBody, PromptInputButton, PromptInputFooter, PromptInputHeader, PromptInputProvider, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "@/components/ai-elements/prompt-input";
import { usePromptInput } from "@/components/ai-elements/prompt-input/context";
import { Paperclip, SendHorizontal, XIcon, LockIcon, Loader2Icon, CheckIcon, AlertCircleIcon, UploadIcon } from "lucide-vue-next";
import { toast } from "vue-sonner";
import { useDocumentVisibility, useDropZone } from '@vueuse/core';
import type { OssFileItem } from "~/store/file";
import type { CaseMaterialParam, PromptSubmitData } from "#shared/types/case";
import { getFileIcon, getFileIconColor } from "~/utils/file";
import { getMaterialType } from "~/utils/caseMaterial";
import { isImageFile, isAudioFile, isRecognizableDocFile } from "~~/shared/utils/fileType";
import { FileSource } from "#shared/types/file";
import { useBatchUpload, type FileUploadState } from '~/composables/useBatchUpload';

const props = withDefaults(defineProps<{
  placeholder?: string
  submitLabel?: string
  loading?: boolean
  disabled?: boolean
  enableWatcher?: boolean
  minRows?: number
  maxRows?: number
}>(), {
  placeholder: '请输入案情信息或者上传案情材料，支持上传 文本、文档、音频、图片 四种材料。',
  submitLabel: '法索一下',
  loading: false,
  disabled: false,
  enableWatcher: true,
  minRows: 4,
  maxRows: 12,
})

const emit = defineEmits<{
  submit: [data: PromptSubmitData]
}>()

const fileStore = useFileStore();
const { detectMimeType, validateFile, uploadToOSS } = useBatchUpload();

// 本地正在上传的文件列表
const uploadingFiles = ref<FileUploadState[]>([]);

function removeUploadingFile(id: string) {
  uploadingFiles.value = uploadingFiles.value.filter(f => f.id !== id);
}

// 案情材料选择器引用
const materialSelectorRef = ref<{ openDialog: () => void; closeDialog: () => void } | null>(null);

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

// 计算已选文件 ID 列表（传递给 MaterialSelector）
const selectedFileIds = computed(() => selectedFiles.value.map(f => f.id))

// 检查是否所有文件都在识别中
const isAllRecognizing = computed(() => {
  return selectedFiles.value.some(f => getRecognitionStatus(f.id) === 'recognizing');
})

// 提交状态：由外部 loading prop 派生
const submitStatus = computed<"submitted" | "streaming" | "ready" | "error">(() => {
  if (props.loading) return 'streaming'
  return 'ready'
})

// 拖拽上传支持
const dropZoneRef = ref<HTMLDivElement | null>(null);
const { isOverDropZone } = useDropZone(dropZoneRef, {
  onDrop: async (files) => {
    if (!files || files.length === 0) return;

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
        encrypted: false, // 案情材料不再加密
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
          }) // 不再需要强制 'application/octet-stream'，使用文件原始类型
          state.status = 'success'
          state.progress = 100
          state.result = data
          
          // 延迟移除成功的状态并将其转为已选文件
          setTimeout(() => {
            removeUploadingFile(state.id)
            
            // 构建伪造的 OssFileItem 加入列表并触发识别
            const newFileObject: OssFileItem = {
              id: (data.fileId || data.id) as number,
              fileName: state.file.name,
              fileSize: state.file.size,
              fileType: state.mimeType,
              source: FileSource.CASE_ANALYSIS,
              sourceName: '案件分析',
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
});

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

// 通过 usePromptInput 获取清空方法
const clearInput = ref<(() => void) | null>(null)
const clearFiles = ref<(() => void) | null>(null)

watchPostEffect(() => {
  try {
    const ctx = usePromptInput()
    clearInput.value = ctx.clearInput
    clearFiles.value = ctx.clearFiles
  }
  catch { }
})

function reset() {
  selectedFiles.value = []
  fileRecognitionStatus.value.clear()
  stopAllPolling()
  clearInput.value?.()
  clearFiles.value?.()
}

defineExpose({ reset })

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
      const timer = setTimeout(() => pollFileStatus(ossFileId, attemptCount + 1), POLLING_INTERVAL);
      pollingTimers.value.set(ossFileId, timer);
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
      const timer = setTimeout(() => pollFileStatus(ossFileId, attemptCount + 1), POLLING_INTERVAL);
      pollingTimers.value.set(ossFileId, timer);
    }
  } catch (error) {
    const timer = setTimeout(() => pollFileStatus(ossFileId, attemptCount + 1), POLLING_INTERVAL);
    pollingTimers.value.set(ossFileId, timer);
  }
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
  const hasAttachments = selectedFiles.value.length > 0;
  if (!hasText && !hasAttachments) {
    toast.warning("请输入案情信息或选择案情材料");
    return;
  }
  if (isAllRecognizing.value) {
    toast.warning("请等待文件识别完成后再提交");
    return;
  }

  emit('submit', {
    text: message.text?.trim() || '',
    materials: selectedFiles.value.map(file => ({
      type: getMaterialType(file.fileType),
      name: file.fileName,
      ossFileId: file.id,
    })),
  })
}

function selectMaterial() {
  materialSelectorRef.value?.openDialog();
}

onUnmounted(stopAllPolling);
</script>
