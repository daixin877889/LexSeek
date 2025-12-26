<template>
  <!-- 网格视图文件列表 -->
  <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
    <div v-for="file in files" :key="file.id" class="group bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md hover:border-primary/50 transition-all cursor-pointer" @click="$emit('click', file)">
      <!-- 文件图标/缩略图 -->
      <div class="flex justify-center mb-3">
        <!-- 图片缩略图（仅非加密图片） -->
        <div v-if="isImageType(file.fileType) && !file.encrypted" class="w-12 h-12 rounded-lg overflow-hidden bg-purple-100 flex items-center justify-center">
          <img v-if="!thumbnailErrors[String(file.id)]" :src="file.url" :alt="file.fileName" class="w-full h-full object-cover" @error="handleThumbnailError(String(file.id))" />
          <ImageIcon v-else class="h-6 w-6 text-purple-600" />
        </div>
        <!-- 其他文件类型图标 -->
        <div v-else class="w-12 h-12 rounded-lg flex items-center justify-center" :class="getFileIconBg(file.fileType)">
          <component :is="getFileIcon(file.fileType)" class="h-6 w-6" :class="getFileIconColor(file.fileType)" />
        </div>
      </div>

      <!-- 文件名 -->
      <p class="text-sm font-medium text-gray-900 truncate text-center mb-1" :title="file.fileName">
        {{ file.fileName }}
      </p>

      <!-- 文件信息 -->
      <div class="flex items-center justify-center gap-2 text-xs text-gray-500">
        <span>{{ formatByteSize(file.fileSize, 2) }}</span>
        <span v-if="file.encrypted" class="text-green-600 flex items-center gap-0.5">
          <LockIcon class="h-3 w-3" />
        </span>
      </div>

      <!-- 来源标签 -->
      <div class="mt-2 flex justify-center">
        <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
          {{ file.sourceName }}
        </span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { LockIcon, ImageIcon } from "lucide-vue-next";

// ==================== Props ====================

interface Props {
  /** 文件列表 */
  files: OssFileItem[];
}

defineProps<Props>();

// ==================== Emits ====================

defineEmits<{
  /** 点击文件 */
  (e: "click", file: OssFileItem): void;
}>();

// ==================== 状态 ====================

// 缩略图加载错误记录
const thumbnailErrors = reactive<Record<string, boolean>>({});

// ==================== 方法 ====================

/**
 * 处理缩略图加载错误
 */
const handleThumbnailError = (fileId: string) => {
  thumbnailErrors[fileId] = true;
};
</script>
