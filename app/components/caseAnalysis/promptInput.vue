<template>
  <div class="px-4 flex size-full flex-col justify-end">
    <PromptInputProvider @submit="handleSubmit">
      <!-- 输入状态监听器，同步状态到 store -->
      <CaseAnalysisPromptInputWatcher />
      <PromptInput ref="promptInputRef" global-drop multiple
        class="[&_[data-slot=input-group]]:shadow-none [&_[data-slot=input-group]]:border-primary [&_[data-slot=input-group]]:rounded-md">
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
          <PromptInputTextarea placeholder="请输入案情信息或者上传案情材料，支持上传 文本、文档、音频、图片 四种材料。" class="min-h-32" />
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
            <PromptInputSubmit class="h-9 px-4! rounded-md" :status="status" size="xs">
              <SendHorizontal class="size-4" />
              <span class="ml-1.5">法索一下</span>
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
import { Paperclip, SendHorizontal, XIcon, LockIcon, Loader2Icon, CheckIcon, AlertCircleIcon } from "lucide-vue-next";
import { toast } from "vue-sonner";
import type { OssFileItem } from "~/store/file";
import type { CaseMaterialParam, CaseMaterialType } from "#shared/types/case";
import { getFileIcon, getFileIconColor } from "~/utils/file";
import { getMaterialType } from "~/utils/caseMaterial";


// 路由
const router = useRouter();

// 案情材料选择器引用
const materialSelectorRef = ref<{ openDialog: () => void; closeDialog: () => void } | null>(null);

// 选择的文件
const selectedFiles = ref<OssFileItem[]>([]);

// 文件识别状态映射：ossFileId -> 状态
const fileRecognitionStatus = ref<Map<number, 'idle' | 'recognizing' | 'success' | 'error'>>(new Map());

// 预览弹框状态
const previewDialogOpen = ref(false);
const audioPreviewDialogOpen = ref(false);
const previewFile = ref<OssFileItem | null>(null);

// 计算已选文件 ID 列表（传递给 MaterialSelector）
const selectedFileIds = computed(() => selectedFiles.value.map(f => f.id))

// 提交状态
const status = ref<"submitted" | "streaming" | "ready" | "error">("ready");

/**
 * 获取文件的识别状态
 */
function getRecognitionStatus(fileId: number): 'idle' | 'recognizing' | 'success' | 'error' | null {
  return fileRecognitionStatus.value.get(fileId) || null;
}

/**
 * 检查文件是否为需要识别的文档文件（docx、doc、pdf、markdown 或 txt）
 */
function isRecognizableDocFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase();
  // 支持 docx、doc、pdf、md、mkd、markdown、txt 文件
  return ['docx', 'doc', 'pdf', 'md', 'mkd', 'markdown', 'txt'].includes(ext || '');
}

/**
 * 检查文件是否为图片文件
 */
function isImageFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(ext || '');
}

/**
 * 检查文件是否为音频文件
 */
function isAudioFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm', 'amr', 'opus'].includes(ext || '');
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
      }>;
    }>('/api/v1/recognition/start', {
      method: 'POST',
      body: { ossFileIds: fileIdsToRecognize }
    });

    if (response?.results) {
      for (const result of response.results) {
        const status = result.status === 'processing' ? 'recognizing' : result.status === 'completed' ? 'success' : 'error';
        fileRecognitionStatus.value.set(result.ossFileId, status);
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
  const status = getRecognitionStatus(file.id);
  if (status !== 'success') {
    if (status === 'recognizing') {
      toast.info('文件正在识别中，请稍后再试');
    } else if (status === 'error') {
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
}

/**
 * 处理文件选择（追加模式）
 */
async function handleFilesSelected(files: OssFileItem[]) {
  // 过滤掉已存在的文件，只添加新文件
  const newFiles = files.filter(f => !selectedFileIds.value.includes(f.id))
  selectedFiles.value = [...selectedFiles.value, ...newFiles]

  // 收集需要识别的文件 ID（文档、图片、音频）
  const fileIdsToRecognize = newFiles
    .filter(f => {
      const isDoc = isRecognizableDocFile(f.fileName);
      const isImage = isImageFile(f.fileName);
      const isAudio = isAudioFile(f.fileName);
      return isDoc || isImage || isAudio;
    })
    .map(f => f.id);

  // 调用统一的识别 API
  if (fileIdsToRecognize.length > 0) {
    console.log('[handleFilesSelected] 开始批量识别，文件 IDs:', fileIdsToRecognize);

    try {
      const response = await useApiFetch<{
        results: Array<{
          ossFileId: number;
          status: 'processing' | 'completed' | 'failed';
        }>;
      }>('/api/v1/recognition/start', {
        method: 'POST',
        body: { ossFileIds: fileIdsToRecognize }
      });

      if (response?.results) {
        for (const result of response.results) {
          const status = result.status === 'processing' ? 'recognizing' : 'error'
          if (result.status === 'failed' && result.error) {
            console.error(`文件 ${result.ossFileId} 识别失败: ${result.error}`)
          }
          fileRecognitionStatus.value.set(result.ossFileId, status);
          console.log(`[handleFilesSelected] 文件 ${result.ossFileId} 识别状态: ${status}`);
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
 * 创建案件和会话，然后跳转到分析页面
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

  status.value = "submitted";

  try {
    // 生成案件标题：使用文本内容的前 50 个字符，或使用第一个文件名
    const title = message.text?.trim() ? message.text.trim().slice(0, 50) + (message.text.trim().length > 50 ? "..." : "") : selectedFiles.value[0]?.fileName || "新案件";

    // 构建材料参数数组
    const materials: CaseMaterialParam[] = selectedFiles.value.map(file => ({
      type: getMaterialType(file.fileType),
      name: file.fileName,
      ossFileId: file.id,
    }));

    // 创建案件（使用默认案件类型 ID = 1）
    const createResult = await useApiFetch<{
      caseId: number;
      sessionId: string;
    }>("/api/v1/case/create", {
      method: "POST",
      body: {
        title,
        content: message.text?.trim() || undefined,
        caseTypeId: 1, // 默认案件类型
        materials: materials.length > 0 ? materials : undefined,
      },
    });

    if (!createResult) {
      // useApiFetch 已经显示了错误提示，这里只需要恢复状态
      status.value = "error";
      setTimeout(() => {
        status.value = "ready";
      }, 3000);
      return;
    }

    // 提交成功后清空已选文件列表和识别状态
    selectedFiles.value = []
    fileRecognitionStatus.value.clear();

    // 跳转到分析页面
    await router.push(`/dashboard/analysis/${createResult.sessionId}`);
  } catch (error) {
    // 捕获其他未预期的错误（如网络异常、路由跳转失败等）
    status.value = "error";
    const errorMessage = error instanceof Error ? error.message : "操作失败，请重试";
    toast.error(errorMessage);

    // 3 秒后恢复状态
    setTimeout(() => {
      status.value = "ready";
    }, 3000);
  }
}

/**
 * 打开材料选择器
 */
function selectMaterial() {
  materialSelectorRef.value?.openDialog();
}

onMounted(() => {
  // 使用 nextTick 确保子组件完全挂载后再调用
  // nextTick(() => {
  //   selectMaterial();
  // });
});
</script>

<style></style>
