<template>
  <!-- 上传文件对话框 -->
  <Dialog v-model:open="dialogOpen">
    <DialogContent class="sm:max-w-2xl upload-dialog-content overflow-hidden"
      @interactOutside="(e) => e.preventDefault()">
      <DialogHeader>
        <DialogTitle>上传文件</DialogTitle>
        <DialogDescription>选择要上传的文件，支持多文件上传和客户端加密</DialogDescription>
      </DialogHeader>
      <div class="py-4 overflow-hidden">
        <GeneralFileUploader :source="FileSource.FILE" :multiple="true" :autoUpload="true" :enableEncryption="true"
          :defaultEncrypted="true" :onSuccess="handleUploadSuccess" :onError="handleUploadError" />
      </div>
    </DialogContent>
  </Dialog>
</template>

<script lang="ts" setup>
// ==================== Props ====================

interface Props {
  /** 是否显示对话框 */
  open: boolean;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  /** 更新显示状态 */
  (e: "update:open", value: boolean): void;
  /** 上传成功事件 */
  (e: "success", files: Record<string, unknown>[]): void;
  /** 上传失败事件 */
  (e: "error", error: Error): void;
}>();

// ==================== 状态 ====================

// 对话框显示状态（双向绑定）
const dialogOpen = computed({
  get: () => props.open,
  set: (value) => emit("update:open", value),
});

// ==================== 方法 ====================

/**
 * 上传成功回调
 */
const handleUploadSuccess = (uploadedFiles: Record<string, unknown>[]) => {
  console.log("上传成功", uploadedFiles);
  dialogOpen.value = false;
  emit("success", uploadedFiles);
};

/**
 * 上传失败回调
 */
const handleUploadError = (err: Error) => {
  console.log("上传失败", err);
  emit("error", err);
};

// ==================== 监听器 ====================

// 动态更新对话框 z-index
watchEffect(() => {
  if (dialogOpen.value) {
    nextTick(() => {
      const overlay = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement | null;
      if (overlay) overlay.style.zIndex = "600";
      const content = document.querySelector('[data-slot="dialog-content"].upload-dialog-content') as HTMLElement | null;
      if (content) content.style.zIndex = "601";
    });
  }
});
</script>

<style>
.upload-dialog-content {
  z-index: 601 !important;
}
</style>
