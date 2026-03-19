<template>
  <div class="px-4 flex size-full flex-col justify-end">
    <PromptInputProvider @submit="handleSubmit">
      <!-- 输入状态监听器，同步状态到 store -->
      <CaseAnalysisPromptInputWatcher v-if="enableWatcher" />
      <!-- 在 Provider 内部调用 usePromptInput 并暴露 clear 方法，供父组件通过 ref 调用 -->
      <PromptInputActions ref="promptInputActionsRef" />
      <PromptInput global-drop multiple
        class="**:data-[slot=input-group]:shadow-none **:data-[slot=input-group]:border-primary **:data-[slot=input-group]:rounded-md">
        <!-- 头部：自定义文件列表 -->
        <PromptInputHeader>
          <div v-if="selectedFiles.length > 0" class="flex flex-wrap items-center gap-2 p-3 w-full">
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
                class="text-xs px-1 h-5 text-blue-500 border-blue-500">
                <Loader2Icon class="size-3 animate-spin mr-0.5" />
                识别中
              </Badge>
              <Badge v-else-if="getRecognitionStatus(file.id) === 'success'" variant="outline"
                class="text-xs px-1 h-5 text-green-500 border-green-500">
                <CheckIcon class="size-3 mr-0.5" />
                已识别
              </Badge>
              <Badge v-else-if="getRecognitionStatus(file.id) === 'error'" variant="outline"
                class="text-xs px-1 h-5 text-red-500 border-red-500 cursor-pointer"
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
          </div>
        </PromptInputHeader>
        <!-- 中间部分 -->
        <PromptInputBody>
          <PromptInputTextarea :placeholder="placeholder" class="min-h-32" />
        </PromptInputBody>
        <!-- 底部 -->
        <PromptInputFooter class="border-t border-muted-foreground/20 border-dashed">
          <!-- 工具栏 -->
          <PromptInputTools>
            <PromptInputButton variant="ghost" @click="selectMaterial">
              <Paperclip class="text-muted-foreground" :size="16" />
              案情材料
              <span v-if="selectedFiles.length > 0" class="ml-1 text-xs text-primary">({{ selectedFiles.length
                }})</span>
            </PromptInputButton>
            <span class="text-muted-foreground text-xs"> </span>
          </PromptInputTools>
          <!-- 附件上传 -->
          <div class="flex items-center gap-2">
            <!-- 提交按钮 -->
            <PromptInputSubmit class="h-9 px-4! rounded-md" :status="submitStatus" :disabled="disabled" size="xs">
              <SendHorizontal class="size-4" />
              <span class="ml-1.5">{{ submitLabel }}</span>
            </PromptInputSubmit>
          </div>
        </PromptInputFooter>
      </PromptInput>
    </PromptInputProvider>

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
import { PromptInputActions } from "@/components/ai-elements/prompt-input";
import { Paperclip, SendHorizontal, XIcon, LockIcon, Loader2Icon, CheckIcon, AlertCircleIcon } from "lucide-vue-next";
import { toast } from "vue-sonner";
import type { OssFileItem } from "~/store/file";
import type { CaseMaterialParam, PromptSubmitData } from "#shared/types/case";
import { getFileIcon, getFileIconColor } from "~/utils/file";
import { getMaterialType } from "~/utils/caseMaterial";
import { isImageFile, isAudioFile, isRecognizableDocFile } from "~~/shared/utils/fileType";

const props = withDefaults(defineProps<{
  placeholder?: string
  submitLabel?: string
  loading?: boolean
  disabled?: boolean
  enableWatcher?: boolean
}>(), {
  placeholder: '请输入案情信息或者上传案情材料，支持上传 文本、文档、音频、图片 四种材料。',
  submitLabel: '法索一下',
  loading: false,
  disabled: false,
  enableWatcher: true,
})

const emit = defineEmits<{
  submit: [data: PromptSubmitData]
}>()

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

// 提交状态：由外部 loading prop 派生
const submitStatus = computed<"submitted" | "streaming" | "ready" | "error">(() => {
  if (props.loading) return 'streaming'
  return 'ready'
})

// PromptInputActions ref：用于调用 Provider 内部的 clear 方法
const promptInputActionsRef = ref<{ clearInput: () => void; clearFiles: () => void } | null>(null)

// 通过 template ref 调用 clear（而非 composable，因 usePromptInput 必须在 Provider 内部调用）

/**
 * 重置组件状态：清空文本、文件、识别状态、轮询
 */
function reset() {
  selectedFiles.value = []
  fileRecognitionStatus.value.clear()
  stopAllPolling()
  promptInputActionsRef.value?.clearInput()
  promptInputActionsRef.value?.clearFiles()
}

defineExpose({ reset })

/**
 * 获取文件的识别状态
 */
function getRecognitionStatus(fileId: number): 'idle' | 'recognizing' | 'success' | 'error' | null {
  return fileRecognitionStatus.value.get(fileId) || null;
}

/**
 * 轮询检查文件识别状态
 * 用于异步识别任务（图片、音频、pdf）
 * @param ossFileId OSS 文件 ID
 * @param attemptCount 当前尝试次数
 */
async function pollFileStatus(ossFileId: number, attemptCount = 0) {
  // 超过最大次数，停止轮询
  if (attemptCount >= MAX_POLLING_ATTEMPTS) {
    console.warn(`文件 ${ossFileId} 识别超时`);
    fileRecognitionStatus.value.set(ossFileId, 'error');
    pollingTimers.value.delete(ossFileId);
    return;
  }

  try {
    // 调用统一的识别状态查询 API
    // useApiFetch 会自动提取 response.data，所以直接使用返回的对象
    const response = await useApiFetch<{
      recognized: boolean;
      status: number;
      recordType: 'doc' | 'image' | 'audio' | 'unknown';
    }>(`/api/v1/recognition/status/${ossFileId}`, {
      method: 'GET',
      showError: false,
    });

    // useApiFetch 返回 null 表示请求失败
    if (!response) {
      // 继续轮询
      const timer = setTimeout(() => {
        pollFileStatus(ossFileId, attemptCount + 1);
      }, POLLING_INTERVAL);
      pollingTimers.value.set(ossFileId, timer);
      return;
    }

    // 统一 API 返回格式：{ recognized: boolean, status: number, recordType: 'doc'|'image'|'audio'|'unknown' }
    // recognized === true 或 status === 2 表示识别成功
    const recognized = response.recognized === true || response.status === 2;

    if (recognized) {
      // 识别成功
      fileRecognitionStatus.value.set(ossFileId, 'success');
      pollingTimers.value.delete(ossFileId);
      console.log(`文件 ${ossFileId} 识别成功`);
    } else {
      // 检查是否失败（status === 3）
      if (response.status === 3) {
        fileRecognitionStatus.value.set(ossFileId, 'error');
        pollingTimers.value.delete(ossFileId);
        console.log(`文件 ${ossFileId} 识别失败`);
        return;
      }

      // 继续轮询
      const timer = setTimeout(() => {
        pollFileStatus(ossFileId, attemptCount + 1);
      }, POLLING_INTERVAL);
      pollingTimers.value.set(ossFileId, timer);
    }
  } catch (error) {
    console.error(`轮询文件 ${ossFileId} 状态失败:`, error);
    // 继续尝试
    const timer = setTimeout(() => {
      pollFileStatus(ossFileId, attemptCount + 1);
    }, POLLING_INTERVAL);
    pollingTimers.value.set(ossFileId, timer);
  }
}

/**
 * 停止文件识别状态轮询
 */
function stopPolling(ossFileId: number) {
  const timer = pollingTimers.value.get(ossFileId);
  if (timer) {
    clearTimeout(timer);
    pollingTimers.value.delete(ossFileId);
  }
}

/**
 * 停止所有轮询
 */
function stopAllPolling() {
  pollingTimers.value.forEach((timer) => {
    clearTimeout(timer);
  });
  pollingTimers.value.clear();
}

/**
 * 重试识别
 */
async function retryRecognition(file: OssFileItem) {
  // 重新触发批量识别
  const fileIdsToRecognize = [file.id];
  try {
    const response = await useApiFetch<{
      results: Array<{
        ossFileId: number;
        status: 'processing' | 'completed' | 'failed';
        error?: string;
      }>;
    }>('/api/v1/recognition/start', {
      method: 'POST',
      body: { ossFileIds: fileIdsToRecognize }
    });

    if (response?.results) {
      for (const result of response.results) {
        // 处理状态映射
        let mappedStatus: 'recognizing' | 'success' | 'error'
        if (result.status === 'completed') {
          mappedStatus = 'success'
        } else if (result.status === 'processing') {
          mappedStatus = 'recognizing'
          // 启动轮询
          pollFileStatus(result.ossFileId)
        } else {
          mappedStatus = 'error'
          if (result.error) {
            console.error(`文件 ${result.ossFileId} 识别失败: ${result.error}`)
          }
        }
        fileRecognitionStatus.value.set(result.ossFileId, mappedStatus);
      }
    }
  } catch (error) {
    console.error('重试识别失败:', error);
    fileRecognitionStatus.value.set(file.id, 'error');
  }
}

/**
 * 打开文件预览弹框
 * 支持文档文件、图片和音频的预览
 */
function openPreview(file: OssFileItem) {
  // 检查文件类型
  const isDoc = isRecognizableDocFile(file.fileName);
  const isImage = isImageFile(file.fileName);
  const isAudio = isAudioFile(file.fileName);

  if (!isDoc && !isImage && !isAudio) {
    return;
  }

  // 只有已识别成功的文件才能预览
  const recognitionStatus = getRecognitionStatus(file.id);
  if (recognitionStatus !== 'success') {
    if (recognitionStatus === 'recognizing') {
      toast.info('文件正在识别中，请稍后再试');
    } else if (recognitionStatus === 'error') {
      toast.warning('文件识别失败，请重试');
    } else {
      toast.info('文件尚未识别');
    }
    return;
  }

  previewFile.value = file;

  // 根据文件类型打开对应的预览弹框
  if (isAudio) {
    audioPreviewDialogOpen.value = true;
  } else {
    previewDialogOpen.value = true;
  }
}

/**
 * 移除已选文件
 */
function removeFile(fileId: number) {
  selectedFiles.value = selectedFiles.value.filter(f => f.id !== fileId)
  // 清除识别状态
  fileRecognitionStatus.value.delete(fileId);
  // 停止轮询
  stopPolling(fileId);
}

/**
 * 处理文件选择（追加模式）
 */
async function handleFilesSelected(files: OssFileItem[]) {
  // 过滤掉已存在的文件，只添加新文件
  const newFiles = files.filter(f => !selectedFileIds.value.includes(f.id))
  selectedFiles.value = [...selectedFiles.value, ...newFiles]

  // 收集需要识别的文件 ID（文档、图片、音频）
  const filesToRecognize = newFiles
    .filter(f => {
      const isDoc = isRecognizableDocFile(f.fileName);
      const isImage = isImageFile(f.fileName);
      const isAudio = isAudioFile(f.fileName);
      return isDoc || isImage || isAudio;
    });

  const fileIdsToRecognize = filesToRecognize.map(f => f.id);

  // 调用统一的识别 API
  if (fileIdsToRecognize.length > 0) {
    console.log('[handleFilesSelected] 开始批量识别，文件 IDs:', fileIdsToRecognize);

    // 在 API 调用前先设置状态为 'recognizing'，让用户立即看到识别中状态
    for (const fileId of fileIdsToRecognize) {
      fileRecognitionStatus.value.set(fileId, 'recognizing');
    }

    try {
      const response = await useApiFetch<{
        results: Array<{
          ossFileId: number;
          status: 'processing' | 'completed' | 'failed';
          error?: string;
        }>;
      }>('/api/v1/recognition/start', {
        method: 'POST',
        body: { ossFileIds: fileIdsToRecognize },
        showError: false  // 禁用自动错误提示，我们手动处理
      });

      // response 为 null 表示 API 调用失败（如网络错误、401 等）
      if (!response) {
        console.error('[handleFilesSelected] API 调用失败');
        for (const fileId of fileIdsToRecognize) {
          fileRecognitionStatus.value.set(fileId, 'error');
        }
        toast.error('识别服务调用失败，请稍后重试');
        return;
      }

      if (response?.results) {
        for (const result of response.results) {
          // 处理状态映射：completed/processing -> recognizing/success, failed -> error
          let mappedStatus: 'recognizing' | 'success' | 'error'
          if (result.status === 'completed') {
            // 同步处理的文件，状态直接为 success
            mappedStatus = 'success'
          } else if (result.status === 'processing') {
            // 异步处理的文件，状态为 recognizing，启动轮询
            mappedStatus = 'recognizing'
            pollFileStatus(result.ossFileId)
          } else {
            mappedStatus = 'error'
            // 显示友好的错误提示
            if (result.error) {
              console.error(`文件 ${result.ossFileId} 识别失败：${result.error}`)
              // 积分不足的特殊提示
              if (result.error.includes('积分不足')) {
                toast.error('文件识别失败：积分不足，请充值后重试')
              } else {
                toast.error(`文件识别失败：${result.error}`)
              }
            }
          }
          fileRecognitionStatus.value.set(result.ossFileId, mappedStatus);
          console.log(`[handleFilesSelected] 文件 ${result.ossFileId} 识别状态: ${mappedStatus}`);
        }
      }
    } catch (error) {
      console.error('[handleFilesSelected] 批量识别失败:', error);
      // 识别失败时设置错误状态
      for (const fileId of fileIdsToRecognize) {
        fileRecognitionStatus.value.set(fileId, 'error');
      }
    }
  }
}

/**
 * 处理提交
 * 校验输入 → 构建标准化数据 → emit submit 事件
 */
async function handleSubmit(message: PromptInputMessage) {
  const hasText = !!message.text?.trim();
  const hasAttachments = selectedFiles.value.length > 0;

  // 验证：必须有文本或附件
  if (!hasText && !hasAttachments) {
    toast.warning("请输入案情信息或选择案情材料");
    return;
  }

  // 检查是否有正在识别的文件（文档、图片或音频）
  const recognizingFiles = selectedFiles.value.filter(f => {
    const isRecognizable = isRecognizableDocFile(f.fileName) || isImageFile(f.fileName) || isAudioFile(f.fileName);
    return isRecognizable && getRecognitionStatus(f.id) === 'recognizing';
  });
  if (recognizingFiles.length > 0) {
    toast.warning("请等待文件识别完成后再提交");
    return;
  }

  // 构建标准化数据
  const materials: CaseMaterialParam[] = selectedFiles.value.map(file => ({
    type: getMaterialType(file.fileType),
    name: file.fileName,
    ossFileId: file.id,
  }));

  emit('submit', {
    text: message.text?.trim() || '',
    materials,
  })
}

/**
 * 打开材料选择器
 */
function selectMaterial() {
  materialSelectorRef.value?.openDialog();
}

// 组件卸载时停止所有轮询
onUnmounted(() => {
  stopAllPolling();
});
</script>

<style></style>
