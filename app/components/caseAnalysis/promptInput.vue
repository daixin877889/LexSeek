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
    <CaseAnalysisDocPreviewDialog v-if="previewFile" v-model:open="previewDialogOpen" :oss-file-id="previewFile.id"
      :file-name="previewFile.fileName" :file-type="previewFile.fileType" :encrypted="previewFile.encrypted" />
  </div>
</template>

<script lang="ts" setup>
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { PromptInput, PromptInputBody, PromptInputButton, PromptInputFooter, PromptInputHeader, PromptInputProvider, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "@/components/ai-elements/prompt-input";
import { Paperclip, SendHorizontal, XIcon, LockIcon, Loader2Icon, CheckIcon, AlertCircleIcon } from "lucide-vue-next";
import { toast } from "vue-sonner";
import type { OssFileItem } from "~/store/file";
import { getFileIcon, getFileIconColor } from "~/utils/file";


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
const previewFile = ref<OssFileItem | null>(null);

// docx 识别 composable
const { recognize, checkRecognitionStatus } = useDocxRecognition();

// 图像识别 composable
const { recognize: recognizeImage, checkRecognitionStatus: checkImageRecognitionStatus, isImageFile } = useImageRecognition();

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
 * 触发图像识别
 */
async function triggerImageRecognition(file: OssFileItem) {
  console.log('[triggerImageRecognition] ========== 函数开始 ==========');
  console.log('[triggerImageRecognition] 文件信息:', JSON.stringify({ id: file.id, fileName: file.fileName }));

  if (!isImageFile(file.fileName)) {
    console.log('[triggerImageRecognition] 文件不是图片类型');
    return;
  }

  // 设置识别中状态
  fileRecognitionStatus.value.set(file.id, 'recognizing');
  console.log('[triggerImageRecognition] 设置状态为 recognizing');

  try {
    // 先检查是否已识别
    console.log('[triggerImageRecognition] 开始检查识别状态...');
    const statusCheck = await checkImageRecognitionStatus(file.id);
    console.log('[triggerImageRecognition] 状态检查结果:', statusCheck);

    if (statusCheck.recognized) {
      // 已识别，直接标记成功
      console.log('[triggerImageRecognition] 图片已识别，标记成功');
      fileRecognitionStatus.value.set(file.id, 'success');
      return;
    }

    // 需要识别，获取下载 URL
    const downloadUrl = file.url;
    console.log('[triggerImageRecognition] 开始识别，downloadUrl:', downloadUrl);

    // 执行识别
    await recognizeImage({
      ossFileId: file.id,
      fileName: file.fileName,
      encrypted: file.encrypted,
      downloadUrl,
    });

    console.log('[triggerImageRecognition] 识别完成');
    fileRecognitionStatus.value.set(file.id, 'success');
    toast.success(`图片 ${file.fileName} 识别完成`);
  } catch (error) {
    console.error('图像识别失败:', error);
    fileRecognitionStatus.value.set(file.id, 'error');
    const errorMessage = error instanceof Error ? error.message : '识别失败';
    toast.error(`图片 ${file.fileName} 识别失败: ${errorMessage}`);
  }
}

/**
 * 触发文档文件识别（支持 docx、markdown 和 txt）
 */
async function triggerDocRecognition(file: OssFileItem) {
  console.log('[triggerDocRecognition] ========== 函数开始 ==========');
  console.log('[triggerDocRecognition] 文件信息:', JSON.stringify({ id: file.id, fileName: file.fileName, url: file.url?.substring(0, 50) }));

  if (!isRecognizableDocFile(file.fileName)) {
    console.log('[triggerDocRecognition] 文件不需要识别');
    return;
  }

  // 设置识别中状态
  fileRecognitionStatus.value.set(file.id, 'recognizing');
  console.log('[triggerDocRecognition] 设置状态为 recognizing');

  try {
    // 先检查是否已识别
    console.log('[triggerDocRecognition] 开始检查识别状态...');
    const statusCheck = await checkRecognitionStatus(file.id);
    console.log('[triggerDocRecognition] 状态检查结果:', statusCheck);

    if (statusCheck.recognized) {
      // 已识别，直接标记成功
      console.log('[triggerDocRecognition] 文件已识别，标记成功');
      fileRecognitionStatus.value.set(file.id, 'success');
      return;
    }

    // 需要识别，获取下载 URL
    // 注意：这里需要获取文件的下载 URL，如果文件有 url 字段则使用
    const downloadUrl = file.url;
    console.log('[triggerDocRecognition] 开始识别，downloadUrl:', downloadUrl);

    // 执行识别（传递文件名用于图片命名）
    // 如果正在处理中，recognize 内部会轮询等待
    await recognize({
      ossFileId: file.id,
      fileName: file.fileName,
      encrypted: file.encrypted,
      downloadUrl,
      bucket: 'lexseek-files', // 默认 bucket
    });

    console.log('[triggerDocRecognition] 识别完成');
    fileRecognitionStatus.value.set(file.id, 'success');
    toast.success(`文件 ${file.fileName} 识别完成`);
  } catch (error) {
    console.error('文档识别失败:', error);
    fileRecognitionStatus.value.set(file.id, 'error');
    const errorMessage = error instanceof Error ? error.message : '识别失败';
    toast.error(`文件 ${file.fileName} 识别失败: ${errorMessage}`);
  }
}

/**
 * 重试识别
 */
async function retryRecognition(file: OssFileItem) {
  const isDoc = isRecognizableDocFile(file.fileName);
  const isImage = isImageFile(file.fileName);
  
  if (isDoc) {
    await triggerDocRecognition(file);
  } else if (isImage) {
    await triggerImageRecognition(file);
  }
}

/**
 * 打开文件预览弹框
 * 只有已识别的文档文件和图片才能预览
 */
function openPreview(file: OssFileItem) {
  // 只有可识别的文档文件或图片才能预览
  const isDoc = isRecognizableDocFile(file.fileName);
  const isImage = isImageFile(file.fileName);
  
  if (!isDoc && !isImage) {
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
  previewDialogOpen.value = true;
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

  // 对新添加的文件触发识别
  for (const file of newFiles) {
    const isDoc = isRecognizableDocFile(file.fileName);
    const isImage = isImageFile(file.fileName);
    
    console.log('检查文件是否需要识别:', file.fileName, 'isDoc:', isDoc, 'isImage:', isImage);
    
    if (isDoc) {
      // 文档文件识别（docx、markdown 和 txt）
      console.log('[handleFilesSelected] 准备调用 triggerDocRecognition:', file.fileName);
      triggerDocRecognition(file).catch((err) => {
        console.error('[handleFilesSelected] triggerDocRecognition 异常:', err);
      });
      console.log('[handleFilesSelected] triggerDocRecognition 已调用（异步）');
    } else if (isImage) {
      // 图像文件识别
      console.log('[handleFilesSelected] 准备调用 triggerImageRecognition:', file.fileName);
      triggerImageRecognition(file).catch((err) => {
        console.error('[handleFilesSelected] triggerImageRecognition 异常:', err);
      });
      console.log('[handleFilesSelected] triggerImageRecognition 已调用（异步）');
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

  // 检查是否有正在识别的文件（文档或图片）
  const recognizingFiles = selectedFiles.value.filter(f => {
    const isRecognizable = isRecognizableDocFile(f.fileName) || isImageFile(f.fileName);
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
      },
    });

    if (!createResult) {
      throw new Error("创建案件失败");
    }

    // 将材料数据存储到 sessionStorage，供分析页面使用
    const materialData = {
      text: message.text?.trim() || "",
      fileIds: selectedFiles.value.map((f) => f.id),
      files: selectedFiles.value.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        fileType: f.fileType,
        fileSize: f.fileSize,
        encrypted: f.encrypted,
      })),
    };
    sessionStorage.setItem(`analysis_materials_${createResult.sessionId}`, JSON.stringify(materialData));

    // 提交成功后清空已选文件列表和识别状态
    selectedFiles.value = []
    fileRecognitionStatus.value.clear();

    // 跳转到分析页面
    await router.push(`/dashboard/analysis/${createResult.sessionId}`);
  } catch (error) {
    status.value = "error";
    const errorMessage = error instanceof Error ? error.message : "提交失败";
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
