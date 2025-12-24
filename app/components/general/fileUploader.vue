<template>
  <div class="file-uploader h-full flex flex-col" :class="statusMessage ? 'gap-2' : 'gap-4'">
    <!-- 拖拽上传区域（上传中或完成时隐藏） -->
    <div v-if="!isUploading && !isUploadComplete"
      class="relative border-2 border-dashed rounded-lg text-center transition-colors overflow-hidden flex-1 flex flex-col"
      :class="[
        {
          'border-primary bg-primary/5': isDragOver,
          'border-muted-foreground/25 hover:border-muted-foreground/50': !isDragOver,
          'cursor-pointer': true,
        },
      ]" @dragover.prevent="handleDragOver($event)" @dragleave.prevent="handleDragLeave($event)"
      @drop.prevent="handleDrop($event)" @click="triggerFileInput()">
      <!-- 主要内容区域 -->
      <div class="flex-1 flex items-center justify-center">
        <div class="relative px-4 py-4 w-full max-w-sm mx-auto" :class="statusMessage ? 'space-y-2' : 'space-y-4'">
          <!-- 上传图标 -->
          <div class="mx-auto rounded-full bg-muted flex items-center justify-center"
            :class="statusMessage ? 'w-10 h-10' : 'w-16 h-16'">
            <UploadIcon :class="statusMessage ? 'h-5 w-5' : 'h-8 w-8'" class="text-muted-foreground" />
          </div>

          <!-- 上传文本 -->
          <div :class="statusMessage ? 'space-y-1' : 'space-y-2'">
            <p :class="statusMessage ? 'text-sm' : 'text-lg'" class="font-medium leading-tight">
              {{ uploadAreaText }}
            </p>
            <p :class="statusMessage ? 'text-xs' : 'text-sm'" class="text-muted-foreground leading-tight">
              {{ uploadAreaSubText }}
            </p>
          </div>

          <!-- 隐藏的文件输入 -->
          <Input ref="fileInputRef" type="file" @change="handleFileChange" :accept="acceptAttribute"
            :multiple="props.multiple" :disabled="isUploading" class="hidden" />
        </div>
      </div>

      <!-- 允许的文件类型（放在上传框底部） -->
      <div v-if="currentScene"
        class="shrink-0 px-4 py-2 border-t border-dashed text-xs text-muted-foreground bg-muted/30">
        允许的文件类型：{{ formatAcceptTypes(currentScene.accept || []) }}
      </div>
    </div>

    <!-- 多选模式：已选文件列表（上传前显示清空和删除按钮） -->
    <div v-if="props.multiple && selectedFiles.length > 0 && !isUploading && !isUploadComplete"
      class="shrink-0 space-y-2">
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted-foreground">已选择 {{ selectedFiles.length }} 个文件</span>
        <Button variant="ghost" size="sm" @click="clearAllFiles"> 清空 </Button>
      </div>
      <div class="max-h-40 overflow-y-auto space-y-1">
        <div v-for="(fileItem, index) in fileUploadStates" :key="index"
          class="flex items-center justify-between p-2 bg-muted/50 rounded-md text-sm">
          <div class="flex-1 min-w-0 mr-2">
            <p class="truncate font-medium">{{ fileItem.file.name }}</p>
            <div class="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{{ formatByteSize(fileItem.file.size, 2) }}</span>
            </div>
          </div>
          <Button variant="ghost" size="icon" class="h-6 w-6 shrink-0" @click.stop="removeFile(index)">
            <XIcon class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>

    <!-- 上传中/完成时的文件列表（显示进度，无删除按钮） -->
    <div v-if="(isUploading || isUploadComplete) && fileUploadStates.length > 0" class="shrink-0 space-y-2 flex-1">
      <div class="flex items-center justify-between text-sm">
        <span class="text-muted-foreground">
          {{ isUploading ? "正在上传..." : "上传完成" }}
        </span>
        <span class="text-xs text-muted-foreground"> {{ uploadedCount }}/{{ fileUploadStates.length }} 个文件 </span>
      </div>
      <div class="max-h-60 overflow-y-auto space-y-1">
        <div v-for="(fileItem, index) in fileUploadStates" :key="index" class="p-2 bg-muted/50 rounded-md text-sm">
          <div class="flex items-center justify-between mb-1">
            <p class="truncate font-medium flex-1 min-w-0 mr-2">{{ fileItem.file.name }}</p>
            <span class="text-xs shrink-0" :class="{
              'text-primary': fileItem.status === 'uploading',
              'text-green-600': fileItem.status === 'success',
              'text-destructive': fileItem.status === 'error',
              'text-muted-foreground': fileItem.status === 'pending',
            }">
              <template v-if="fileItem.status === 'uploading'">{{ Math.round(fileItem.progress) }}%</template>
              <template v-else-if="fileItem.status === 'success'">✓ 完成</template>
              <template v-else-if="fileItem.status === 'error'">✗ 失败</template>
              <template v-else>等待中</template>
            </span>
          </div>
          <!-- 进度条 -->
          <div class="h-1.5 bg-muted rounded-full overflow-hidden">
            <div class="h-full transition-all duration-300 rounded-full" :class="{
              'bg-primary': fileItem.status === 'uploading',
              'bg-green-500': fileItem.status === 'success',
              'bg-destructive': fileItem.status === 'error',
              'bg-muted-foreground/30': fileItem.status === 'pending',
            }" :style="{ width: (fileItem.status === 'success' ? 100 : fileItem.progress) + '%' }"></div>
          </div>
          <div class="flex items-center gap-2 text-xs text-muted-foreground mt-1">
            <span>{{ formatByteSize(fileItem.file.size, 2) }}</span>
            <span v-if="fileItem.error" class="text-destructive">{{ fileItem.error }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 单选模式：上传中显示进度 -->
    <div v-if="!props.multiple && isUploading && selectedFile"
      class="shrink-0 space-y-2 flex-1 flex flex-col justify-center">
      <div class="p-4 bg-muted/50 rounded-lg">
        <div class="flex items-center justify-between mb-2">
          <p class="truncate font-medium text-sm">{{ selectedFile.name }}</p>
          <span class="text-xs text-primary shrink-0">{{ Math.round(uploadProgress) }}%</span>
        </div>
        <div class="h-2 bg-muted rounded-full overflow-hidden">
          <div class="h-full bg-primary transition-all duration-300 rounded-full"
            :style="{ width: uploadProgress + '%' }">
          </div>
        </div>
        <p class="text-xs text-muted-foreground mt-2">{{ formatByteSize(selectedFile.size, 2) }}</p>
      </div>
    </div>

    <!-- 单选模式：上传完成显示 -->
    <div v-if="!props.multiple && isUploadComplete && selectedFile"
      class="shrink-0 space-y-2 flex-1 flex flex-col justify-center">
      <div class="p-4 bg-green-50 border border-green-200 rounded-lg">
        <div class="flex items-center justify-between mb-2">
          <p class="truncate font-medium text-sm">{{ selectedFile.name }}</p>
          <span class="text-xs text-green-600 shrink-0">✓ 完成</span>
        </div>
        <div class="h-2 bg-green-100 rounded-full overflow-hidden">
          <div class="h-full bg-green-500 rounded-full w-full"></div>
        </div>
        <p class="text-xs text-muted-foreground mt-2">{{ formatByteSize(selectedFile.size, 2) }}</p>
      </div>
    </div>

    <!-- 上传按钮（上传前显示） -->
    <Button v-if="!isUploading && !isUploadComplete" @click="handleUpload" :disabled="!canUpload"
      class="w-full shrink-0" :size="statusMessage ? 'sm' : 'default'">
      <UploadIcon class="h-4 w-4 mr-2" />
      {{ uploadButtonText }}
    </Button>

    <!-- 上传中显示加载状态 -->
    <Button v-if="isUploading" disabled :loading="true" class="w-full shrink-0"
      :size="statusMessage ? 'sm' : 'default'">
      上传中... </Button>

    <!-- 上传完成后显示继续上传按钮 -->
    <Button v-if="isUploadComplete" @click="handleContinueUpload" class="w-full shrink-0"
      :size="statusMessage ? 'sm' : 'default'">
      <UploadIcon class="h-4 w-4 mr-2" />
      继续上传
    </Button>

    <!-- 状态消息 -->
    <div v-if="statusMessage" class="shrink-0 rounded-md p-2 text-xs" :class="{
      'bg-destructive/15 text-destructive border border-destructive/20': statusType === 'error',
      'bg-green-50 text-green-700 border border-green-200': statusType === 'success',
    }">
      {{ statusMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { UploadIcon, XIcon } from "lucide-vue-next";

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
 * 文件类型配置项
 */
interface AcceptItem {
  name: string;
  mime: string;
  maxSize: number;
}

/**
 * 文件验证结果
 */
interface ValidationResult {
  valid: boolean;
  message?: string;
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
    return selectedFiles.value.length > 0 && fileUploadStates.value.every((f) => f.status === "pending" && validateFile(f.file).valid);
  }
  return selectedFile.value && validateFile(selectedFile.value).valid;
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
 * 检测文件的 MIME 类型
 */
const detectMimeType = (file: File): string => {
  const fileName = file.name || "";
  const fileExtension = fileName.split(".").pop()?.toLowerCase() || "";
  let mimeType = file.type || "";
  if (!mimeType || mimeType.trim() === "") {
    mimeType = mime.getType(fileExtension) || "";
  }
  if (fileExtension === "md" && file.type === "text/x-markdown") {
    mimeType = "text/markdown";
  }
  return mimeType;
};

/**
 * 验证文件是否符合当前场景的要求
 */
const validateFile = (file: File): ValidationResult => {
  if (!currentScene.value) {
    return { valid: false, message: "请选择上传场景" };
  }
  if (currentScene.value.accept && currentScene.value.accept.length > 0) {
    const fileName = file.name || "";
    const fileExtension = fileName.split(".").pop()?.toLowerCase() || "";
    const fileMimeType = detectMimeType(file);
    const acceptedMimeType = currentScene.value.accept.find((item: AcceptItem) => item.mime === fileMimeType);
    if (!acceptedMimeType) {
      const acceptedByExtension = currentScene.value.accept.find((item: AcceptItem) => item.name === fileExtension);
      if (!acceptedByExtension) {
        return { valid: false, message: `不支持的文件格式：${fileExtension || "未知"}` };
      }
      if (file.size > acceptedByExtension.maxSize) {
        return {
          valid: false,
          message: `文件大小超出限制: ${formatByteSize(file.size, 2)}，最大允许: ${formatByteSize(acceptedByExtension.maxSize, 2)}`,
        };
      }
      return { valid: true };
    }
    if (file.size > acceptedMimeType.maxSize) {
      return {
        valid: false,
        message: `文件大小超出限制: ${formatByteSize(file.size, 2)}，${acceptedMimeType.mime}最大允许: ${formatByteSize(acceptedMimeType.maxSize, 2)}`,
      };
    }
  }
  return { valid: true };
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
      const validation = validateFile(file);
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
      const validation = validateFile(file);
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
      const validation = validateFile(file);
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
      const validation = validateFile(file);
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
 * 上传单个文件到 OSS
 */
const uploadToOSS = async (file: File, signature: PostSignatureResult, onProgress?: (progress: number) => void): Promise<string> => {
  const formData = new FormData();
  if (!signature.key) {
    throw new Error("未获取到文件路径");
  }
  formData.append("key", signature.key);
  formData.append("policy", signature.policy);
  formData.append("x-oss-signature-version", signature.signatureVersion);
  formData.append("x-oss-credential", signature.credential);
  formData.append("x-oss-date", signature.date);
  formData.append("x-oss-signature", signature.signature);
  if (signature.securityToken) {
    formData.append("x-oss-security-token", signature.securityToken);
  }
  if (signature.callback) {
    formData.append("callback", signature.callback);
  }
  if (signature.callbackVar) {
    for (const [key, value] of Object.entries(signature.callbackVar)) {
      formData.append(key, value);
    }
  }
  formData.append("file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        const progress = (event.loaded / event.total) * 100;
        onProgress?.(progress);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        resolve(xhr.responseText);
      } else {
        reject(new Error(`上传失败: ${xhr.status} ${xhr.statusText}\n${xhr.responseText}`));
      }
    });
    xhr.addEventListener("error", () => {
      reject(new Error("上传过程中发生错误"));
    });
    xhr.open("POST", signature.host);
    xhr.send(formData);
  });
};

/**
 * 处理单文件上传
 */
const handleSingleUpload = async () => {
  if (!selectedFile.value) {
    showStatus("请选择文件", true);
    return;
  }

  const validation = validateFile(selectedFile.value);
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
    });

    if (!signature) {
      throw new Error(fileStore.error || "获取签名失败");
    }

    const responseText = await uploadToOSS(selectedFile.value, signature, (progress) => {
      uploadProgress.value = progress;
    });

    // 解析阿里云回调数据
    const data = JSON.parse(responseText);

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
    const validation = validateFile(state.file);
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
    });

    if (!signatures || signatures.length !== fileUploadStates.value.length) {
      throw new Error(fileStore.error || "批量获取签名失败");
    }

    // 依次上传每个文件
    const successData: Record<string, unknown>[] = [];
    let hasError = false;

    for (let i = 0; i < fileUploadStates.value.length; i++) {
      const state = fileUploadStates.value[i];
      const signature = signatures[i];

      if (!state || !signature) continue;

      state.status = "uploading";
      state.signature = signature;

      try {
        const responseText = await uploadToOSS(state.file, signature, (progress) => {
          state.progress = progress;
          emit("file-upload-progress", state.file, progress);
        });

        // 解析阿里云回调数据
        const data = JSON.parse(responseText);

        state.status = "success";
        state.progress = 100;
        successData.push(data);
      } catch (err) {
        state.status = "error";
        state.error = err instanceof Error ? err.message : "上传失败";
        hasError = true;
        logger.error(`文件 "${state.file.name}" 上传失败:`, err);
      }
    }

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

onMounted(() => {
  loadScenes();
});
</script>

<style scoped>
.file-uploader [role="button"] {
  cursor: pointer;
}
</style>
