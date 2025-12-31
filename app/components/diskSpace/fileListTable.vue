<template>
  <!-- 表格视图文件列表 -->
  <div class="bg-card rounded-lg border border-border overflow-hidden">
    <!-- 表头 -->
    <div
      class="grid grid-cols-12 gap-4 px-4 py-3 bg-muted border-b border-border text-sm font-medium text-muted-foreground">
      <div class="col-span-5">文件名</div>
      <div class="col-span-2">大小</div>
      <div class="col-span-2">来源</div>
      <div class="col-span-2">上传时间</div>
      <div class="col-span-1 text-center">状态</div>
    </div>

    <!-- 文件列表 -->
    <div class="divide-y divide-border">
      <div v-for="file in files" :key="file.id"
        class="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer items-center"
        @click="$emit('click', file)">
        <!-- 文件名 -->
        <div class="col-span-5 flex items-center gap-3 min-w-0">
          <div class="w-8 h-8 rounded flex items-center justify-center shrink-0" :class="getFileIconBg(file.fileType)">
            <component :is="getFileIcon(file.fileType)" class="h-4 w-4" :class="getFileIconColor(file.fileType)" />
          </div>
          <span class="text-sm text-foreground truncate" :title="file.fileName">
            {{ file.fileName }}
          </span>
        </div>

        <!-- 大小 -->
        <div class="col-span-2 text-sm text-muted-foreground">
          {{ formatByteSize(file.fileSize, 2) }}
        </div>

        <!-- 来源 -->
        <div class="col-span-2">
          <span class="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {{ file.sourceName }}
          </span>
        </div>

        <!-- 上传时间 -->
        <div class="col-span-2 text-sm text-muted-foreground">
          {{ formatDate(file.createdAt) }}
        </div>

        <!-- 状态 -->
        <div class="col-span-1 flex justify-center">
          <span v-if="file.encrypted" class="text-green-600 dark:text-green-400" title="已加密">
            <LockIcon class="h-4 w-4" />
          </span>
          <span v-else class="text-muted-foreground" title="未加密">
            <UnlockIcon class="h-4 w-4" />
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { LockIcon, UnlockIcon } from "lucide-vue-next";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";

// 配置 dayjs
dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

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

// ==================== 方法 ====================

/**
 * 格式化日期
 */
const formatDate = (dateString: string) => {
  if (!dateString) return "--";
  const date = dayjs(dateString);
  const now = dayjs();
  const diffDays = now.diff(date, "day");

  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return date.fromNow();
  return date.format("YYYY-MM-DD");
};
</script>
