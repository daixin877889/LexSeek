<template>
  <div class="file-uploader flex h-full w-full flex-col overflow-hidden" :class="statusMessage ? 'gap-2.5' : 'gap-4'">
    <!-- 拖拽上传区域（上传中或完成时隐藏） -->
    <div v-if="!isUploading && !isUploadComplete"
      class="dropzone group relative flex flex-1 cursor-pointer flex-col overflow-hidden rounded-[14px] border-2 border-dashed transition-colors"
      :class="isDragOver
        ? 'border-primary bg-primary/[0.07]'
        : 'dropzone-wash border-primary/35 hover:border-primary/55'"
      @dragover.prevent="handleDragOver($event)" @dragleave.prevent="handleDragLeave($event)"
      @drop.prevent="handleDrop($event)" @click="triggerFileInput()">
      <!-- 主要内容区域 -->
      <div class="flex flex-1 flex-col items-center justify-center px-6 text-center"
        :class="statusMessage ? 'py-5' : 'py-9'">
        <!-- 品牌渐变上传图标 -->
        <div class="flex items-center justify-center rounded-full bg-gradient-brand text-white shadow-[0_14px_28px_-10px_rgba(30,158,237,0.4)]"
          :class="statusMessage ? 'mb-3 size-12' : 'mb-4 size-15'">
          <UploadIcon :class="statusMessage ? 'size-5' : 'size-6'" />
        </div>

        <!-- 上传文本 -->
        <p class="font-semibold leading-tight" :class="statusMessage ? 'text-sm' : 'text-[15.5px]'">
          {{ isDragOver ? "释放以上传文件" : uploadAreaText }}
        </p>
        <p class="mt-1.5 leading-snug text-muted-foreground" :class="statusMessage ? 'text-xs' : 'text-[12.5px]'">
          {{ uploadAreaSubText }}
        </p>

        <!-- 隐藏的文件输入 -->
        <Input ref="fileInputRef" type="file" @change="handleFileChange" :accept="acceptAttribute"
          :multiple="props.multiple" :disabled="isUploading" class="hidden" />
      </div>

      <!-- 允许的文件类型（放在上传框底部） -->
      <div v-if="currentScene"
        class="shrink-0 border-t border-dashed border-primary/20 bg-muted/40 px-4 py-2 text-center text-[11.5px] leading-snug text-muted-foreground">
        允许的文件类型：{{ formatAcceptTypes(currentScene.accept || []) }}
      </div>
    </div>

    <!-- 多选模式：已选文件列表（上传前显示清空和删除按钮） -->
    <div v-if="props.multiple && selectedFiles.length > 0 && !isUploading && !isUploadComplete" class="shrink-0">
      <div class="mb-2 flex items-center justify-between">
        <span class="text-[12.5px] text-muted-foreground">已选择 {{ selectedFiles.length }} 个文件</span>
        <button type="button"
          class="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="clearAllFiles">清空</button>
      </div>
      <div class="max-h-44 space-y-1.5 overflow-y-auto pr-0.5">
        <div v-for="(fileItem, index) in fileUploadStates" :key="index"
          class="flex items-center gap-2.5 rounded-[9px] border border-border bg-muted px-2.5 py-2">
          <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-card">
            <component :is="getFileIcon(fileItem.file.type)" class="size-4" :class="getFileIconColor(fileItem.file.type)" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[12.5px] font-medium">{{ fileItem.file.name }}</p>
            <p class="mt-0.5 text-[11px] text-muted-foreground">{{ formatByteSize(fileItem.file.size, 2) }}</p>
          </div>
          <Button variant="ghost" size="icon" class="size-7 shrink-0 text-muted-foreground" @click.stop="removeFile(index)">
            <XIcon class="size-3.5" />
          </Button>
        </div>
      </div>
    </div>

    <!-- 上传中/完成时的文件列表（显示进度，无删除按钮） -->
    <div v-if="(isUploading || isUploadComplete) && fileUploadStates.length > 0"
      class="flex shrink-0 flex-1 flex-col overflow-hidden">
      <div class="mb-2 flex items-center justify-between">
        <span class="text-[13px] font-semibold">{{ isUploading ? "正在上传…" : "上传完成" }}</span>
        <span class="text-xs text-muted-foreground">{{ uploadedCount }}/{{ fileUploadStates.length }} 个文件</span>
      </div>
      <div class="max-h-60 space-y-2 overflow-y-auto pr-0.5">
        <div v-for="(fileItem, index) in fileUploadStates" :key="index"
          class="rounded-[10px] border border-border bg-muted px-3 py-2.5">
          <div class="mb-1.5 flex items-center gap-2">
            <component :is="getFileIcon(fileItem.file.type)" class="size-3.5 shrink-0"
              :class="getFileIconColor(fileItem.file.type)" />
            <span class="min-w-0 flex-1 truncate text-[12.5px] font-medium">{{ fileItem.file.name }}</span>
            <span class="shrink-0 whitespace-nowrap text-[11.5px] font-semibold tabular-nums" :class="{
              'text-primary': fileItem.status === 'uploading',
              'text-green-600 dark:text-green-400': fileItem.status === 'success',
              'text-destructive': fileItem.status === 'error',
              'text-muted-foreground': fileItem.status === 'pending',
            }">
              <template v-if="fileItem.status === 'uploading'">{{ Math.round(fileItem.progress) }}%</template>
              <span v-else-if="fileItem.status === 'success'" class="inline-flex items-center gap-0.5">
                <CheckIcon class="size-3" />完成
              </span>
              <span v-else-if="fileItem.status === 'error'" class="inline-flex items-center gap-0.5">
                <XIcon class="size-3" />失败
              </span>
              <template v-else>等待中</template>
            </span>
          </div>
          <!-- 进度条 -->
          <div class="h-1.5 overflow-hidden rounded-full bg-muted-foreground/15">
            <div class="h-full rounded-full transition-all duration-300" :class="{
              'bg-primary': fileItem.status === 'uploading',
              'bg-green-500': fileItem.status === 'success',
              'bg-destructive': fileItem.status === 'error',
              'bg-muted-foreground/30': fileItem.status === 'pending',
            }" :style="{ width: (fileItem.status === 'success' || fileItem.status === 'error' ? 100 : fileItem.progress) + '%' }"></div>
          </div>
          <div class="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{{ formatByteSize(fileItem.file.size, 2) }}</span>
            <span v-if="fileItem.error" class="text-destructive">· {{ fileItem.error }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 单选模式：上传中显示进度 -->
    <div v-if="!props.multiple && isUploading && selectedFile"
      class="flex shrink-0 flex-1 flex-col justify-center">
      <div class="rounded-[10px] border border-border bg-muted px-3 py-3">
        <div class="mb-1.5 flex items-center gap-2">
          <component :is="getFileIcon(selectedFile.type)" class="size-4 shrink-0"
            :class="getFileIconColor(selectedFile.type)" />
          <span class="min-w-0 flex-1 truncate text-[12.5px] font-medium">{{ selectedFile.name }}</span>
          <span class="shrink-0 text-[11.5px] font-semibold tabular-nums text-primary">
            {{ Math.round(uploadProgress) }}%
          </span>
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-muted-foreground/15">
          <div class="h-full rounded-full bg-primary transition-all duration-300"
            :style="{ width: uploadProgress + '%' }"></div>
        </div>
        <p class="mt-1.5 text-[11px] text-muted-foreground">{{ formatByteSize(selectedFile.size, 2) }}</p>
      </div>
    </div>

    <!-- 单选模式：上传完成显示 -->
    <div v-if="!props.multiple && isUploadComplete && selectedFile"
      class="flex shrink-0 flex-1 flex-col justify-center">
      <div class="rounded-[10px] border border-green-200 bg-green-50 px-3 py-3 dark:border-green-500/25 dark:bg-green-500/10">
        <div class="mb-1.5 flex items-center gap-2">
          <component :is="getFileIcon(selectedFile.type)" class="size-4 shrink-0"
            :class="getFileIconColor(selectedFile.type)" />
          <span class="min-w-0 flex-1 truncate text-[12.5px] font-medium">{{ selectedFile.name }}</span>
          <span class="inline-flex shrink-0 items-center gap-0.5 text-[11.5px] font-semibold text-green-600 dark:text-green-400">
            <CheckIcon class="size-3" />完成
          </span>
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-green-200 dark:bg-green-500/20">
          <div class="h-full w-full rounded-full bg-green-500"></div>
        </div>
        <p class="mt-1.5 text-[11px] text-muted-foreground">{{ formatByteSize(selectedFile.size, 2) }}</p>
      </div>
    </div>

    <!-- 上传按钮（上传前显示）：未选文件时点击打开文件选择，已选文件时执行上传 -->
    <div v-if="!isUploading && !isUploadComplete" class="shrink-0">
      <Button @click="handleUploadButtonClick" :disabled="hasSelectedFiles && !canUpload"
        :size="statusMessage ? 'sm' : 'default'"
        class="w-full bg-gradient-brand-button text-white shadow-[0_10px_20px_-8px_rgba(30,158,237,0.42)]">
        <UploadIcon class="size-4" />
        {{ uploadButtonText }}
      </Button>
    </div>

    <!-- 上传中显示加载状态 -->
    <Button v-if="isUploading" disabled :loading="true" class="w-full shrink-0"
      :size="statusMessage ? 'sm' : 'default'">
      上传中... </Button>

    <!-- 上传完成后显示继续上传按钮 -->
    <Button v-if="isUploadComplete" @click="handleContinueUpload" :size="statusMessage ? 'sm' : 'default'"
      class="w-full shrink-0 bg-gradient-brand-button text-white shadow-[0_10px_20px_-8px_rgba(30,158,237,0.42)]">
      <UploadIcon class="size-4" />
      继续上传其他文件
    </Button>

    <!-- 状态消息 -->
    <div v-if="statusMessage" class="shrink-0 rounded-lg border px-3 py-2 text-xs font-medium" :class="statusType === 'error'
      ? 'border-destructive/25 bg-destructive/10 text-destructive'
      : 'border-green-200 bg-green-50 text-green-700 dark:border-green-500/25 dark:bg-green-500/10 dark:text-green-400'">
      {{ statusMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { CheckIcon, UploadIcon, XIcon } from "lucide-vue-next";
import { useBatchUpload } from "~/composables/useBatchUpload";
import { getFileIcon, getFileIconColor } from "~/utils/file";
import { FileSource } from '#shared/types/file'
import type { FileSourceAccept } from '#shared/types/file'
import type { PostSignatureResult } from '#shared/types/oss'
import { mime } from '#shared/utils/mime'
import toast from '#shared/utils/toast'
import { formatByteSize } from '#shared/utils/unitConverision'
import type { AcceptItem } from '~/composables/useBatchUpload'
import { useFileStore } from '~/store/file'

/**
 * 文件上传组件 Props
 */
interface FileUploaderProps {
  /** 上传场景 */
  source?: FileSource;
  /** 是否多选模式 */
  multiple?: boolean;
  /** 是否自动上传（选中文件后自动开始上传） */
  autoUpload?: boolean;
  /** 上传成功回调（返回阿里云回调数据数组） */
  onSuccess?: (data: Record<string, unknown>[]) => void;
  /** 上传失败回调 */
  onError?: (error: Error) => void;
}

/**
 * 文件上传状态
 */
interface FileUploadState {
  file: File;
  mimeType: string;
  status: "pending" | "uploading" | "success" | "error";
  progress: number;
  error?: string;
  signature?: PostSignatureResult;
}

/**
 * 组件事件定义
 */
const emit = defineEmits<{
  (e: "upload-success", data: Record<string, unknown>[]): void;
  (e: "upload-error", error: Error): void;
  (e: "file-upload-progress", file: File, progress: number): void;
}>();

const props = withDefaults(defineProps<FileUploaderProps>(), {
  source: "file" as FileSource,
  multiple: false,
  autoUpload: false,
  onSuccess: () => { },
  onError: () => { },
});

const fileStore = useFileStore();
const { detectMimeType, validateFile, uploadToOSS } = useBatchUpload();

// 基础状态
const currentScene = ref<FileSourceAccept | null>(null);
const fileInputRef = ref<{ $el: HTMLInputElement } | null>(null);
const isUploading = ref(false);
const isUploadComplete = ref(false); // 新增：上传完成状态
const uploadProgress = ref(0);
const statusMessage = ref("");
const statusType = ref<"error" | "success">("success");
const isDragOver = ref(false);

// 单选模式状态
const selectedFile = ref<File | null>(null);
const detectedMimeType = ref("");

// 多选模式状态
const selectedFiles = ref<File[]>([]);
const fileUploadStates = ref<FileUploadState[]>([]);

/**
 * 计算已上传完成的文件数量
 */
const uploadedCount = computed(() => {
  return fileUploadStates.value.filter((f) => f.status === "success").length;
});

/**
 * 计算文件输入框的 accept 属性
 */
const acceptAttribute = computed(() => {
  if (!currentScene.value || !currentScene.value.accept || currentScene.value.accept.length === 0) {
    return "";
  }
  const acceptItems = currentScene.value.accept.map((item: AcceptItem) => {
    const mimeType = item.mime;
    const extension = mime.getExtension(mimeType);
    if (extension) {
      return `${mimeType},.${extension}`;
    }
    return mimeType;
  });
  return acceptItems.join(",");
});

/**
 * 计算是否可以上传
 */
const canUpload = computed(() => {
  if (props.multiple) {
    return selectedFiles.value.length > 0 && fileUploadStates.value.every((f) => f.status === "pending" && validateFile(f.file, currentScene.value as FileSourceAccept).valid);
  }
  return selectedFile.value && validateFile(selectedFile.value, currentScene.value as FileSourceAccept).valid;
});

/**
 * 是否已选择文件（多选/单选统一）
 */
const hasSelectedFiles = computed(() => {
  return props.multiple ? selectedFiles.value.length > 0 : !!selectedFile.value;
});

/**
 * 上传区域主文本
 */
const uploadAreaText = computed(() => {
  if (props.multiple) {
    return selectedFiles.value.length > 0 ? `已选择 ${selectedFiles.value.length} 个文件` : "拖拽文件到此处或点击上传";
  }
  return selectedFile.value ? selectedFile.value.name : "拖拽文件到此处或点击上传";
});

/**
 * 上传区域副文本
 */
const uploadAreaSubText = computed(() => {
  if (props.multiple) {
    return selectedFiles.value.length > 0 ? "点击添加更多文件" : "支持拖拽上传或点击选择多个文件";
  }
  return selectedFile.value ? formatByteSize(selectedFile.value.size, 2) : "支持拖拽上传或点击选择文件";
});

/**
 * 上传按钮文本
 */
const uploadButtonText = computed(() => {
  if (isUploading.value) {
    return "上传中...";
  }
  if (props.multiple && selectedFiles.value.length > 0) {
    return `上传 ${selectedFiles.value.length} 个文件`;
  }
  return "上传文件";
});

/**
 * 格式化允许的文件类型显示
 */
const formatAcceptTypes = (acceptConfig: AcceptItem[]): string => {
  if (!acceptConfig || acceptConfig.length === 0) {
    return "所有文件格式";
  }
  const friendlyNames = acceptConfig.map((item) => {
    const extension = mime.getExtension(item.mime) || item.mime;
    const maxSize = formatByteSize(item.maxSize, 2);
    return `.${extension}(${maxSize})`;
  });
  return friendlyNames.join(" | ");
};

/**
 * 显示状态消息
 */
const showStatus = (message: string, isError = false) => {
  statusMessage.value = message;
  statusType.value = isError ? "error" : "success";
};



/**
 * 加载上传场景配置
 */
const loadScenes = async () => {
  try {
    logger.debug("loadScenes 调用，source:", props.source);
    const result = await fileStore.getUploadConfig(props.source as FileSource);
    logger.debug("getUploadConfig 返回结果:", result);
    if (result && result.length > 0) {
      currentScene.value = result[0] ?? null;
      logger.debug("当前场景配置:", currentScene.value);
    }
  } catch (err) {
    logger.error("获取场景配置失败:", err);
    showStatus(`获取场景配置失败: ${fileStore.error || "未知错误"}`, true);
  }
};

/**
 * 处理文件选择变化
 */
const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const files = target.files;

  if (!files || files.length === 0) {
    return;
  }

  let hasValidFiles = false;

  if (props.multiple) {
    // 多选模式：添加到文件列表
    const newFiles = Array.from(files);
    for (const file of newFiles) {
      const validation = validateFile(file, currentScene.value as FileSourceAccept);
      if (!validation.valid) {
        showStatus(`文件 "${file.name}" ${validation.message}`, true);
        continue;
      }
      // 避免重复添加
      if (!selectedFiles.value.some((f) => f.name === file.name && f.size === file.size)) {
        selectedFiles.value.push(file);
        fileUploadStates.value.push({
          file,
          mimeType: detectMimeType(file),
          status: "pending",
          progress: 0,
        });
        hasValidFiles = true;
      }
    }
    if (selectedFiles.value.length > 0) {
      statusMessage.value = "";
    }
  } else {
    // 单选模式：只保留一个文件
    const file = files[0];
    if (file) {
      selectedFile.value = file;
      detectedMimeType.value = detectMimeType(file);
      const validation = validateFile(file, currentScene.value as FileSourceAccept);
      if (!validation.valid) {
        showStatus(validation.message || "文件验证失败", true);
      } else {
        statusMessage.value = "";
        hasValidFiles = true;
      }
    }
  }

  // 重置文件输入框
  if (target) {
    target.value = "";
  }

  // 自动上传
  if (props.autoUpload && hasValidFiles) {
    nextTick(() => {
      handleUpload();
    });
  }
};

/**
 * 触发文件选择器
 */
const triggerFileInput = () => {
  if (fileInputRef.value && fileInputRef.value.$el) {
    fileInputRef.value.$el.click();
  }
};

/**
 * 处理拖拽进入事件
 */
const handleDragOver = (event: DragEvent) => {
  if (isUploading.value) return;
  event.preventDefault();
  isDragOver.value = true;
};

/**
 * 处理拖拽离开事件
 */
const handleDragLeave = (event: DragEvent) => {
  if (isUploading.value) return;
  event.preventDefault();
  isDragOver.value = false;
};

/**
 * 处理文件拖放事件
 */
const handleDrop = (event: DragEvent) => {
  if (isUploading.value) return;
  event.preventDefault();
  isDragOver.value = false;

  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;

  let hasValidFiles = false;

  if (props.multiple) {
    // 多选模式：添加所有文件
    const newFiles = Array.from(files);
    for (const file of newFiles) {
      const validation = validateFile(file, currentScene.value as FileSourceAccept);
      if (!validation.valid) {
        showStatus(`文件 "${file.name}" ${validation.message}`, true);
        continue;
      }
      if (!selectedFiles.value.some((f) => f.name === file.name && f.size === file.size)) {
        selectedFiles.value.push(file);
        fileUploadStates.value.push({
          file,
          mimeType: detectMimeType(file),
          status: "pending",
          progress: 0,
        });
        hasValidFiles = true;
      }
    }
    if (selectedFiles.value.length > 0) {
      statusMessage.value = "";
    }
  } else {
    // 单选模式：只取第一个文件
    const file = files[0];
    if (file) {
      selectedFile.value = file;
      detectedMimeType.value = detectMimeType(file);
      const validation = validateFile(file, currentScene.value as FileSourceAccept);
      if (!validation.valid) {
        showStatus(validation.message || "文件验证失败", true);
      } else {
        statusMessage.value = "";
        hasValidFiles = true;
      }
    }
  }

  // 自动上传
  if (props.autoUpload && hasValidFiles) {
    nextTick(() => {
      handleUpload();
    });
  }
};

/**
 * 移除单个文件（多选模式）
 */
const removeFile = (index: number) => {
  selectedFiles.value.splice(index, 1);
  fileUploadStates.value.splice(index, 1);
};

/**
 * 清空所有文件（多选模式）
 */
const clearAllFiles = () => {
  selectedFiles.value = [];
  fileUploadStates.value = [];
  statusMessage.value = "";
};


/**
 * 处理单文件上传
 */
const handleSingleUpload = async () => {
  if (!selectedFile.value) {
    showStatus("请选择文件", true);
    return;
  }

  const validation = validateFile(selectedFile.value, currentScene.value as FileSourceAccept);
  if (!validation.valid) {
    showStatus(validation.message || "文件验证失败", true);
    return;
  }

  try {
    isUploading.value = true;
    statusMessage.value = "";
    uploadProgress.value = 0;

    const signature = await fileStore.getPresignedUrl({
      source: props.source as FileSource,
      originalFileName: selectedFile.value.name,
      fileSize: selectedFile.value.size,
      mimeType: detectedMimeType.value,
      encrypted: false,
    });

    if (!signature) {
      throw new Error(fileStore.error || "获取签名失败");
    }

    // Worker 直接返回解析后的数据
    const data = await uploadToOSS(selectedFile.value, signature, (progress) => {
      uploadProgress.value = progress;
    });

    showStatus("文件上传成功！");
    props.onSuccess([data]);
    emit("upload-success", [data]);
    toast.success(`文件 "${selectedFile.value.name}" 上传成功`);
    isUploadComplete.value = true; // 设置上传完成状态
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("上传失败:", error);
    const errorMessage = `上传失败: ${error.message || "服务器错误"}`;
    showStatus(errorMessage, true);
    props.onError(error);
    emit("upload-error", error);
    toast.error(`文件 "${selectedFile.value?.name}" 上传失败: ${error.message || "服务器错误"}`);
  } finally {
    isUploading.value = false;
  }
};

/**
 * 处理批量文件上传
 */
const handleBatchUpload = async () => {
  if (selectedFiles.value.length === 0) {
    showStatus("请选择文件", true);
    return;
  }

  // 验证所有文件
  for (const state of fileUploadStates.value) {
    const validation = validateFile(state.file, currentScene.value as FileSourceAccept);
    if (!validation.valid) {
      showStatus(`文件 "${state.file.name}" ${validation.message}`, true);
      return;
    }
  }

  try {
    isUploading.value = true;
    statusMessage.value = "";

    // 批量获取签名
    const filesInfo = fileUploadStates.value.map((state) => ({
      originalFileName: state.file.name,
      fileSize: state.file.size,
      mimeType: state.mimeType,
    }));

    const signatures = await fileStore.getBatchPresignedUrls({
      source: props.source as FileSource,
      files: filesInfo,
      encrypted: false,
    });

    if (!signatures || signatures.length !== fileUploadStates.value.length) {
      throw new Error(fileStore.error || "批量获取签名失败");
    }

    // 为每个文件分配签名
    for (let i = 0; i < fileUploadStates.value.length; i++) {
      const state = fileUploadStates.value[i];
      const signature = signatures[i];
      if (state && signature) {
        state.signature = signature;
      }
    }

    /**
     * 上传单个文件的处理函数
     */
    const uploadSingleFile = async (state: FileUploadState): Promise<Record<string, unknown> | null> => {
      if (!state.signature) return null;

      try {
        state.status = "uploading";

        // Worker 直接返回解析后的数据
        const data = await uploadToOSS(state.file, state.signature, (progress) => {
          state.progress = progress;
          emit("file-upload-progress", state.file, progress);
        });

        state.status = "success";
        state.progress = 100;
        return data;
      } catch (err) {
        state.status = "error";
        state.error = err instanceof Error ? err.message : "上传失败";
        logger.error(`文件 "${state.file.name}" 上传失败:`, err);
        return null;
      }
    };

    // 并行上传所有文件
    const uploadPromises = fileUploadStates.value.map((state) => uploadSingleFile(state));
    const results = await Promise.all(uploadPromises);

    // 收集成功上传的数据
    const successData = results.filter((data): data is Record<string, unknown> => data !== null);
    const hasError = fileUploadStates.value.some((f) => f.status === "error");

    if (successData.length > 0) {
      props.onSuccess(successData);
      emit("upload-success", successData);
    }

    if (hasError) {
      const failedCount = fileUploadStates.value.filter((f) => f.status === "error").length;
      const failedFiles = fileUploadStates.value.filter((f) => f.status === "error");
      const errorMessage = `${failedCount} 个文件上传失败`;
      showStatus(errorMessage, true);
      toast.error(errorMessage);
      // 调用错误回调，传递第一个失败文件的错误信息
      const firstError = new Error(failedFiles[0]?.error || errorMessage);
      props.onError(firstError);
      emit("upload-error", firstError);
      isUploadComplete.value = true; // 即使有错误也设置完成状态
    } else {
      showStatus(`${successData.length} 个文件上传成功！`);
      toast.success(`${successData.length} 个文件上传成功`);
      isUploadComplete.value = true; // 设置上传完成状态
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("批量上传失败:", error);
    showStatus(`批量上传失败: ${error.message || "服务器错误"}`, true);
    props.onError(error);
    emit("upload-error", error);
    toast.error(`批量上传失败: ${error.message || "服务器错误"}`);
  } finally {
    isUploading.value = false;
  }
};

/**
 * 处理上传按钮点击
 */
const handleUpload = async () => {
  if (props.multiple) {
    await handleBatchUpload();
  } else {
    await handleSingleUpload();
  }
};

/**
 * 上传按钮点击：未选文件时打开文件选择器，已选文件时执行上传
 */
const handleUploadButtonClick = () => {
  if (hasSelectedFiles.value) {
    handleUpload();
  } else {
    triggerFileInput();
  }
};

/**
 * 处理继续上传按钮点击
 */
const handleContinueUpload = () => {
  resetForm();
};

/**
 * 重置表单状态
 */
const resetForm = () => {
  // 单选模式状态
  selectedFile.value = null;
  detectedMimeType.value = "";

  // 多选模式状态
  selectedFiles.value = [];
  fileUploadStates.value = [];

  // 通用状态
  statusMessage.value = "";
  uploadProgress.value = 0;
  isDragOver.value = false;
  isUploadComplete.value = false; // 重置上传完成状态

  // 重置文件输入框
  nextTick(() => {
    if (fileInputRef.value && fileInputRef.value.$el) {
      fileInputRef.value.$el.value = "";
    }
  });
};

defineExpose({ resetForm, loadScenes });

onMounted(async () => {
  // 加载上传场景配置
  await loadScenes();
});
</script>

<style scoped>
.file-uploader [role="button"] {
  cursor: pointer;
}
</style>
