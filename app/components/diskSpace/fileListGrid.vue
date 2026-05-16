<template>
  <!-- 网格视图：自适应列宽，对齐云盘空间设计稿 -->
  <div class="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(176px,1fr))]">
    <div v-for="file in files" :key="file.id"
      :class="[
        'relative cursor-pointer rounded-xl border bg-card px-3.5 py-4 transition duration-150',
        selectedFileIds.includes(file.id)
          ? 'border-primary bg-primary/5'
          : 'border-border hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-[0_10px_26px_-12px_rgba(0,0,0,0.22)]'
      ]"
      @click="emit('click', file)">
      <!-- 复选框（左上角） -->
      <div class="absolute left-3 top-3 z-10" @click.stop="emit('toggleSelect', file.id)">
        <DiskCheckbox :checked="selectedFileIds.includes(file.id)" />
      </div>

      <!-- 文件图标 / 图片缩略图 -->
      <div class="mb-3 mt-1 flex justify-center">
        <div
          :class="['flex size-[52px] items-center justify-center overflow-hidden rounded-xl', getFileIconBg(file.fileType)]">
          <img v-if="showThumbnail(file)" :src="file.url" :alt="file.fileName" class="size-full object-cover"
            @error="handleThumbnailError(String(file.id))" />
          <component :is="getFileIcon(file.fileType)" v-else class="size-6"
            :class="getFileIconColor(file.fileType)" />
        </div>
      </div>

      <!-- 文件名 -->
      <p class="mb-1.5 truncate text-center text-[13px] font-medium text-foreground" :title="file.fileName">
        {{ file.fileName }}
      </p>

      <!-- 大小 + 加密标识 -->
      <div class="mb-2.5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <span>{{ formatByteSize(file.fileSize, 2) }}</span>
        <LockIcon v-if="file.encrypted" class="size-3 text-emerald-600 dark:text-emerald-400" />
      </div>

      <!-- 来源标签 -->
      <div class="flex justify-center">
        <span
          class="max-w-full truncate rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {{ file.sourceName }}
        </span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { LockIcon } from 'lucide-vue-next'
import { formatByteSize } from '#shared/utils/unitConverision'
import type { OssFileItem } from '~/store/file'
import { getFileIcon, getFileIconBg, getFileIconColor, isImageType } from '~/utils/file'
import DiskCheckbox from '~/components/diskSpace/Checkbox.vue'

interface Props {
  /** 文件列表 */
  files: OssFileItem[]
  /** 选中的文件 ID 数组 */
  selectedFileIds: number[]
}
defineProps<Props>()

const emit = defineEmits<{
  /** 点击文件 */
  (e: 'click', file: OssFileItem): void
  /** 切换选择 */
  (e: 'toggleSelect', fileId: number): void
}>()

// 缩略图加载失败记录
const thumbnailErrors = reactive<Record<string, boolean>>({})

/** 是否展示图片缩略图（未加密、有 URL、且未加载失败的图片） */
const showThumbnail = (file: OssFileItem) =>
  isImageType(file.fileType) && !file.encrypted && !!file.url && !thumbnailErrors[String(file.id)]

const handleThumbnailError = (fileId: string) => {
  thumbnailErrors[fileId] = true
}
</script>
