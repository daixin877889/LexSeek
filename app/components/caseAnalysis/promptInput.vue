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
              class="group relative flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-md border border-border px-1.5 font-medium text-sm transition-all hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
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
    <CaseAnalysisMaterialSelector ref="materialSelectorRef" :disabled-file-ids="selectedFileIds"
      @filesSelected="handleFilesSelected" />
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

// docx 识别 composable
const { recognize, checkRecognitionStatus } = useDocxRecognition();

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
 * 检查文件是否为 docx 文件
 */
function isDocxFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext === 'docx' || ext === 'doc';
}

/**
 * 触发 docx 文件识别
 */
async function triggerDocxRecognition(file: OssFileItem) {
  if (!isDocxFile(file.fileName)) {
    return;
  }

  // 设置识别中状态
  fileRecognitionStatus.value.set(file.id, 'recognizing');

  try {
    // 先检查是否已识别
    const statusCheck = await checkRecognitionStatus(file.id);

    if (statusCheck.recognized) {
      // 已识别，直接标记成功
      fileRecognitionStatus.value.set(file.id, 'success');
      return;
    }

    if (statusCheck.processing) {
      // 正在处理中，等待
      toast.info(`文件 ${file.fileName} 正在识别中，请稍后`);
      fileRecognitionStatus.value.set(file.id, 'recognizing');
      return;
    }

    // 需要识别，获取下载 URL
    // 注意：这里需要获取文件的下载 URL，如果文件有 url 字段则使用
    const downloadUrl = file.url;

    // 执行识别（传递文件名用于图片命名）
    await recognize({
      ossFileId: file.id,
      fileName: file.fileName,
      encrypted: file.encrypted,
      downloadUrl,
      bucket: 'lexseek-files', // 默认 bucket
    });

    fileRecognitionStatus.value.set(file.id, 'success');
    toast.success(`文件 ${file.fileName} 识别完成`);
  } catch (error) {
    console.error('docx 识别失败:', error);
    fileRecognitionStatus.value.set(file.id, 'error');
    const errorMessage = error instanceof Error ? error.message : '识别失败';
    toast.error(`文件 ${file.fileName} 识别失败: ${errorMessage}`);
  }
}

/**
 * 重试识别
 */
async function retryRecognition(file: OssFileItem) {
  await triggerDocxRecognition(file);
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

  // 对新添加的 docx 文件触发识别
  for (const file of newFiles) {
    if (isDocxFile(file.fileName)) {
      // 异步触发识别，不阻塞
      triggerDocxRecognition(file);
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

  // 检查是否有正在识别的文件
  const recognizingFiles = selectedFiles.value.filter(f =>
    isDocxFile(f.fileName) && getRecognitionStatus(f.id) === 'recognizing'
  );
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
