<template>
  <!-- 移动端文件列表（上拉加载、下拉刷新） -->
  <div class="h-full overflow-y-auto">
    <!-- 下拉刷新指示器 -->
    <div v-if="refreshing" class="flex items-center justify-center py-4">
      <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mr-2"></div>
      <span class="text-sm text-gray-500">刷新中...</span>
    </div>

    <!-- 文件卡片列表 -->
    <div class="space-y-3 px-1">
      <div v-for="file in files" :key="file.id" class="bg-white rounded-lg border border-gray-200 p-3 active:bg-gray-50 transition-colors" @click="$emit('click', file)">
        <div class="flex items-start gap-3">
          <!-- 文件图标/缩略图 -->
          <div class="shrink-0">
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

          <!-- 文件信息 -->
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900 truncate" :title="file.fileName">
              {{ file.fileName }}
            </p>
            <div class="flex items-center gap-2 mt-1 text-xs text-gray-500">
              <span>{{ formatByteSize(file.fileSize, 2) }}</span>
              <span>·</span>
              <span>{{ file.sourceName }}</span>
              <span v-if="file.encrypted" class="text-green-600 flex items-center gap-0.5">
                <LockIcon class="h-3 w-3" />
              </span>
            </div>
          </div>

          <!-- 右侧箭头 -->
          <ChevronRightIcon class="h-5 w-5 text-gray-400 shrink-0 self-center" />
        </div>
      </div>
    </div>

    <!-- 上拉加载触发器（使用 IntersectionObserver 检测） -->
    <div ref="loadMoreTriggerRef" class="py-4 text-center">
      <div v-if="loading" class="flex items-center justify-center">
        <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mr-2"></div>
        <span class="text-sm text-gray-500">加载中...</span>
      </div>
      <div v-else-if="!hasMore" class="text-sm text-gray-400">
        {{ files.length > 0 ? "没有更多了" : "" }}
      </div>
      <div v-else class="text-sm text-gray-400">上拉加载更多</div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { LockIcon, ChevronRightIcon, ImageIcon } from "lucide-vue-next";
import { useIntersectionObserver } from "@vueuse/core";

// ==================== Props ====================

interface Props {
  /** 文件列表 */
  files: OssFileItem[];
  /** 是否正在加载 */
  loading?: boolean;
  /** 是否正在刷新 */
  refreshing?: boolean;
  /** 是否还有更多数据 */
  hasMore?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  refreshing: false,
  hasMore: true,
});

// ==================== Emits ====================

const emit = defineEmits<{
  /** 点击文件 */
  (e: "click", file: OssFileItem): void;
  /** 加载更多 */
  (e: "loadMore"): void;
  /** 下拉刷新 */
  (e: "refresh"): void;
}>();

// ==================== 状态 ====================

const loadMoreTriggerRef = ref<HTMLElement | null>(null);
const thumbnailErrors = reactive<Record<string, boolean>>({});

// ==================== 使用 IntersectionObserver 检测底部元素 ====================

useIntersectionObserver(
  loadMoreTriggerRef,
  (entries) => {
    const entry = entries[0];
    // 当底部元素进入视口且满足加载条件时触发加载
    if (entry?.isIntersecting && !props.loading && props.hasMore) {
      emit("loadMore");
    }
  },
  {
    // 提前 100px 触发
    rootMargin: "100px",
  }
);

// ==================== 方法 ====================

/**
 * 处理缩略图加载错误
 */
const handleThumbnailError = (fileId: string) => {
  thumbnailErrors[fileId] = true;
};
</script>
