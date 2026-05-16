<template>
  <!-- 表格视图：对齐云盘空间设计稿 -->
  <div class="overflow-hidden rounded-xl border border-border bg-card">
    <!-- 表头 -->
    <div
      class="grid h-[42px] items-center gap-3.5 border-b border-border bg-muted px-4 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground [grid-template-columns:40px_minmax(0,1fr)_96px] lg:[grid-template-columns:40px_minmax(0,1fr)_96px_124px_104px]">
      <div></div>
      <div>文件名</div>
      <div>大小</div>
      <div class="hidden lg:block">来源</div>
      <div class="hidden lg:block">上传时间</div>
    </div>

    <!-- 文件行 -->
    <div v-for="file in files" :key="file.id"
      :class="[
        'grid min-h-[60px] cursor-pointer items-center gap-3.5 border-t border-border px-4 transition-colors first:border-t-0 [grid-template-columns:40px_minmax(0,1fr)_96px] lg:[grid-template-columns:40px_minmax(0,1fr)_96px_124px_104px]',
        selectedFileIds.includes(file.id) ? 'bg-primary/5' : 'hover:bg-muted/50'
      ]"
      @click="emit('toggleSelect', file.id)">
      <!-- 复选框 -->
      <div @click.stop="emit('toggleSelect', file.id)">
        <DiskCheckbox :checked="selectedFileIds.includes(file.id)" />
      </div>

      <!-- 文件名 -->
      <div class="flex min-w-0 items-center gap-2.5" @click.stop="emit('click', file)">
        <div
          :class="['flex size-[34px] shrink-0 items-center justify-center rounded-[9px]', getFileIconBg(file.fileType)]">
          <component :is="getFileIcon(file.fileType)" class="size-4" :class="getFileIconColor(file.fileType)" />
        </div>
        <span class="truncate text-sm font-medium text-foreground" :title="file.fileName">{{ file.fileName }}</span>
        <span v-if="file.encrypted" class="inline-flex shrink-0 text-emerald-600 dark:text-emerald-400" title="已加密">
          <LockIcon class="size-3.5" />
        </span>
        <span v-else class="inline-flex shrink-0 text-muted-foreground" title="未加密">
          <UnlockIcon class="size-3.5" />
        </span>
      </div>

      <!-- 大小 -->
      <div class="font-mono text-[13px] text-muted-foreground">{{ formatByteSize(file.fileSize, 2) }}</div>

      <!-- 来源 -->
      <div class="hidden min-w-0 lg:block">
        <span
          class="inline-flex max-w-full truncate rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {{ file.sourceName }}
        </span>
      </div>

      <!-- 上传时间 -->
      <div class="hidden text-[13px] text-muted-foreground lg:block">{{ formatDate(file.createdAt) }}</div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { LockIcon, UnlockIcon } from 'lucide-vue-next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import { formatByteSize } from '#shared/utils/unitConverision'
import type { OssFileItem } from '~/store/file'
import { getFileIcon, getFileIconBg, getFileIconColor } from '~/utils/file'
import DiskCheckbox from '~/components/diskSpace/Checkbox.vue'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

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

/** 格式化日期：7 天内显示相对时间，更早显示日期 */
const formatDate = (dateString: string) => {
  if (!dateString) return '--'
  const date = dayjs(dateString)
  const diffDays = dayjs().diff(date, 'day')
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return date.fromNow()
  return date.format('YYYY-MM-DD')
}
</script>
