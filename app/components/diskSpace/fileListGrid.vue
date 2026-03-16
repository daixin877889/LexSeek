<template>
  <!-- 网格视图文件列表 -->
  <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
    <div v-for="file in files" :key="file.id"
      :class="[
        'group bg-card rounded-lg border p-4 hover:shadow-md transition-all relative',
        props.selectedFileIds.includes(file.id)
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/50'
      ]">
      <!-- 复选框 - 始终显示 -->
      <div
        class="absolute top-3 left-3 z-10"
        @click="emit('toggleSelect', file.id)">
        <div
          :class="[
            'w-5 h-5 rounded border-2 cursor-pointer flex items-center justify-center transition-colors',
            props.selectedFileIds.includes(file.id)
              ? 'bg-primary border-primary'
              : 'bg-white border-gray-300 dark:bg-gray-600 dark:border-gray-400'
          ]">
          <svg v-if="props.selectedFileIds.includes(file.id)" class="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>

      <!-- 文件内容区域 - 点击打开详情 -->
      <div class="cursor-pointer" @click="$emit('click', file)">
        <!-- 文件图标/缩略图 -->
        <div class="flex justify-center mb-3 mt-2">
        <!-- 图片缩略图（仅非加密图片） -->
        <div v-if="isImageType(file.fileType) && !file.encrypted"
          class="w-12 h-12 rounded-lg overflow-hidden bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
          <img v-if="!thumbnailErrors[String(file.id)]" :src="file.url" :alt="file.fileName"
            class="w-full h-full object-cover" @error="handleThumbnailError(String(file.id))" />
          <ImageIcon v-else class="h-6 w-6 text-purple-600 dark:text-purple-400" />
        </div>
        <!-- 其他文件类型图标 -->
        <div v-else class="w-12 h-12 rounded-lg flex items-center justify-center" :class="getFileIconBg(file.fileType)">
          <component :is="getFileIcon(file.fileType)" class="h-6 w-6" :class="getFileIconColor(file.fileType)" />
        </div>
      </div>

      <!-- 文件名 -->
      <p class="text-sm font-medium text-foreground truncate text-center mb-1" :title="file.fileName">
        {{ file.fileName }}
      </p>

      <!-- 文件信息 -->
      <div class="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <span>{{ formatByteSize(file.fileSize, 2) }}</span>
        <span v-if="file.encrypted" class="text-green-600 dark:text-green-400 flex items-center gap-0.5">
          <LockIcon class="h-3 w-3" />
        </span>
      </div>

      <!-- 来源标签 -->
      <div class="mt-2 flex justify-center">
        <span class="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
          {{ file.sourceName }}
        </span>
      </div>
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
  /** 选中的文件 ID 数组 */
  selectedFileIds: number[];
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  /** 点击文件 */
  (e: "click", file: OssFileItem): void;
  /** 切换选择 */
  (e: "toggleSelect", fileId: number): void;
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
