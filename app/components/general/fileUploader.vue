<template>
  <div class="file-uploader h-full flex flex-col" :class="statusMessage ? 'gap-2' : 'gap-4'">
    <!-- 场景信息显示 -->
    <div v-if="currentScene" class="shrink-0 text-sm text-muted-foreground space-y-1">
      <p><strong>允许的文件类型：</strong> {{ formatAcceptTypes(currentScene.accept || []) }}</p>
    </div>

    <!-- 拖拽上传区域 -->
    <div
      class="relative border-2 border-dashed rounded-lg text-center transition-colors overflow-hidden flex-1 flex items-center justify-center"
      :class="[
        {
          'border-primary bg-primary/5': isDragOver && !isUploading,
          'border-muted-foreground/25 hover:border-muted-foreground/50': !isDragOver && !isUploading,
          'border-muted-foreground/10 bg-muted/50 cursor-not-allowed': isUploading,
          'cursor-pointer': !isUploading,
        },
      ]" @dragover.prevent="!isUploading && handleDragOver($event)"
      @dragleave.prevent="!isUploading && handleDragLeave($event)" @drop.prevent="!isUploading && handleDrop($event)"
      @click="!isUploading && triggerFileInput()">
      <!-- 上传进度背景 -->
      <div v-if="isUploading" class="absolute inset-0 bg-primary/10 transition-all duration-300"
        :style="{ width: uploadProgress + '%' }"></div>

      <div class="relative px-4 py-4 w-full max-w-sm mx-auto" :class="statusMessage ? 'space-y-2' : 'space-y-4'">
        <!-- 上传图标 -->
        <div class="mx-auto rounded-full bg-muted flex items-center justify-center"
          :class="statusMessage ? 'w-10 h-10' : 'w-16 h-16'">
          <UploadIcon :class="statusMessage ? 'h-5 w-5' : 'h-8 w-8'" class="text-muted-foreground" />
        </div>

        <!-- 上传文本 -->
        <div :class="statusMessage ? 'space-y-1' : 'space-y-2'">
          <p :class="statusMessage ? 'text-sm' : 'text-lg'" class="font-medium leading-tight">
            {{ isUploading ? "正在上传..." : selectedFile ? selectedFile.name : "拖拽文件到此处或点击上传" }}
          </p>
          <p :class="statusMessage ? 'text-xs' : 'text-sm'" class="text-muted-foreground leading-tight">
            {{ isUploading ? `${Math.round(uploadProgress)}% 已完成` : selectedFile ? formatByteSize(selectedFile.size, 2)
              : "支持拖拽上传或点击选择文件" }}
          </p>
        </div>

        <!-- 隐藏的文件输入 -->
        <Input ref="fileInputRef" type="file" @change="handleFileChange" :accept="acceptAttribute"
          :disabled="isUploading" class="hidden" />
      </div>
    </div>

    <!-- 上传按钮 -->
    <Button @click="handleUpload" :disabled="!canUpload || isUploading" :loading="isUploading" class="w-full shrink-0"
      :size="statusMessage ? 'sm' : 'default'">
      <UploadIcon class="h-4 w-4 mr-2" />
      {{ isUploading ? "上传中..." : "上传文件" }}
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
import { UploadIcon } from "lucide-vue-next";
// import { mime } from "~~/shared/utils/mime";
// import { formatByteSize } from "~~/shared/utils/unitConverision";
// import type { FileSource, FileSourceAccept } from "~~/shared/types/file";
// import type { PostSignatureResult } from "~~/shared/types/oss";

interface FileUploaderProps {
  source?: FileSource;
  onSuccess?: (signature: PostSignatureResult) => void;
  onError?: (error: Error) => void;
}

interface AcceptItem {
  name: string;
  mime: string;
  maxSize: number;
}

interface ValidationResult {
  valid: boolean;
  message?: string;
}

const props = withDefaults(defineProps<FileUploaderProps>(), {
  source: "file" as FileSource,
  onSuccess: () => { },
  onError: () => { },
});

const emit = defineEmits<{
  (e: "upload-success", signature: PostSignatureResult): void;
  (e: "upload-error", error: Error): void;
}>();

const fileStore = useFileStore();

const currentScene = ref<FileSourceAccept | null>(null);
const fileInputRef = ref<{ $el: HTMLInputElement } | null>(null);
const selectedFile = ref<File | null>(null);
const isUploading = ref(false);
const uploadProgress = ref(0);
const statusMessage = ref("");
const statusType = ref<"error" | "success">("success");
const detectedMimeType = ref("");
const isDragOver = ref(false);

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

const canUpload = computed(() => {
  return selectedFile.value && validateFile(selectedFile.value).valid;
});

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

const showStatus = (message: string, isError = false) => {
  statusMessage.value = message;
  statusType.value = isError ? "error" : "success";
};

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
  logger.debug("文件扩展名:", fileExtension, "检测到的 MIME 类型:", mimeType);
  return mimeType;
};

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
        return { valid: false, message: `文件大小超出限制: ${formatByteSize(file.size, 2)}，最大允许: ${formatByteSize(acceptedByExtension.maxSize, 2)}` };
      }
      return { valid: true };
    }
    if (file.size > acceptedMimeType.maxSize) {
      return { valid: false, message: `文件大小超出限制: ${formatByteSize(file.size, 2)}，${acceptedMimeType.mime}最大允许: ${formatByteSize(acceptedMimeType.maxSize, 2)}` };
    }
  }
  return { valid: true };
};

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

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  selectedFile.value = file ?? null;
  if (file) {
    detectedMimeType.value = detectMimeType(file);
    const validation = validateFile(file);
    if (!validation.valid) {
      showStatus(validation.message || "文件验证失败", true);
    } else {
      statusMessage.value = "";
    }
  } else {
    detectedMimeType.value = "";
  }
};

const triggerFileInput = () => {
  if (fileInputRef.value && fileInputRef.value.$el) {
    fileInputRef.value.$el.click();
  }
};

const handleDragOver = (event: DragEvent) => {
  if (isUploading.value) return;
  event.preventDefault();
  isDragOver.value = true;
};

const handleDragLeave = (event: DragEvent) => {
  if (isUploading.value) return;
  event.preventDefault();
  isDragOver.value = false;
};

const handleDrop = (event: DragEvent) => {
  if (isUploading.value) return;
  event.preventDefault();
  isDragOver.value = false;
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    const file = files[0];
    if (file) {
      selectedFile.value = file;
      detectedMimeType.value = detectMimeType(file);
      const validation = validateFile(file);
      if (!validation.valid) {
        showStatus(validation.message || "文件验证失败", true);
      } else {
        statusMessage.value = "";
      }
    }
  }
};

const uploadToOSS = async (file: File, signature: PostSignatureResult): Promise<string> => {
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
        uploadProgress.value = (event.loaded / event.total) * 100;
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

const handleUpload = async () => {
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
    await uploadToOSS(selectedFile.value, signature);
    showStatus("文件上传成功！");
    emit("upload-success", signature);
    props.onSuccess(signature);
    toast.success(`文件 "${selectedFile.value.name}" 上传成功`);
    // 上传成功后清除已选中的文件
    resetForm();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("上传失败:", error);
    const errorMessage = `上传失败: ${error.message || "服务器错误"}`;
    showStatus(errorMessage, true);
    emit("upload-error", error);
    props.onError(error);
    toast.error(`文件 "${selectedFile.value?.name}" 上传失败: ${error.message || "服务器错误"}`);
  } finally {
    isUploading.value = false;
  }
};

const resetForm = () => {
  selectedFile.value = null;
  statusMessage.value = "";
  uploadProgress.value = 0;
  isDragOver.value = false;
  detectedMimeType.value = "";
  // 使用 nextTick 延迟重置文件输入框，避免 Vue 更新冲突
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
