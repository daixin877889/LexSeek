<script setup lang="ts">
/**
 * 消息排队条 —— 用户在 AI 回复期间继续发送的消息，在输入框上方排队，
 * 回复结束后由 dispatcher 依次派发。样式对齐设计稿 AssistantMessages 的 MessageQueue：
 * 卡片外框 + 可折叠标题栏（N 条消息排队中）+ 条目列表（队头转圈 / 序号、附件数、删除）。
 */
import { PauseIcon, PlayIcon, Trash2Icon, ChevronDownIcon, Loader2Icon, PaperclipIcon, BrainIcon, XIcon } from 'lucide-vue-next'
import type { QueueItem, QueuePauseReason } from '~/composables/chatQueueActions'

const props = defineProps<{
  queue: readonly QueueItem[]
  max: number
  paused: boolean
  pauseReason: QueuePauseReason
}>()

const emit = defineEmits<{
  remove: [itemId: string]
  resume: []
  clear: []
}>()

/** 列表展开 / 折叠 */
const open = ref(true)

/** 暂停原因文案 */
const pauseReasonText = computed(() => {
  if (props.pauseReason === 'stopped') return '已手动停止'
  if (props.pauseReason === 'failed') return '上一条执行失败'
  return ''
})
</script>

<template>
  <div v-if="queue.length > 0" class="mx-4 mt-3 shrink-0 overflow-hidden rounded-[10px] border border-border bg-card">
    <!-- 暂停态横幅 -->
    <div
      v-if="paused"
      class="flex items-center gap-[7px] bg-amber-500/15 px-3 py-1.5 text-[11.5px] font-medium text-amber-700 dark:text-amber-400">
      <PauseIcon class="size-3.5 shrink-0" />
      <span>队列已暂停<template v-if="pauseReasonText">（{{ pauseReasonText }}）</template></span>
      <span class="flex-1" />
      <button
        type="button"
        title="恢复队列"
        class="inline-flex size-5 items-center justify-center rounded-[5px] transition-colors hover:bg-amber-500/25"
        @click="emit('resume')">
        <PlayIcon class="size-3" />
      </button>
      <button
        type="button"
        title="清空队列"
        class="inline-flex size-5 items-center justify-center rounded-[5px] transition-colors hover:bg-amber-500/25"
        @click="emit('clear')">
        <Trash2Icon class="size-3" />
      </button>
    </div>

    <!-- 折叠标题栏 -->
    <button
      type="button"
      class="flex w-full items-center gap-[7px] px-3 py-[9px] text-left transition-colors hover:bg-muted/40"
      @click="open = !open">
      <span
        class="size-[7px] shrink-0 rounded-full"
        :class="paused ? 'bg-amber-500' : 'animate-pulse bg-primary'" />
      <span class="text-xs font-semibold text-foreground">{{ queue.length }} 条消息排队中</span>
      <span class="text-[11px] text-muted-foreground">· {{ paused ? '恢复后依次发送' : '小索回复后依次发送' }}</span>
      <span class="flex-1" />
      <ChevronDownIcon
        class="size-3.5 shrink-0 text-muted-foreground transition-transform"
        :class="open ? '' : '-rotate-90'" />
    </button>

    <!-- 队列条目 -->
    <ul v-if="open" class="flex list-none flex-col gap-0.5 border-t border-border p-1">
      <li
        v-for="(item, index) in queue"
        :key="item.id"
        class="flex items-center gap-2 rounded-md px-2 py-[5px] transition-colors hover:bg-muted/45">
        <!-- 队头转圈（即将派发）/ 序号 -->
        <Loader2Icon
          v-if="!paused && index === 0"
          class="size-3.5 shrink-0 animate-spin text-primary" />
        <span
          v-else
          class="inline-flex h-4 min-w-[22px] shrink-0 items-center justify-center rounded-[4px] bg-secondary px-[5px] text-[9.5px] font-semibold text-muted-foreground">
          #{{ index + 1 }}
        </span>

        <!-- 文本 -->
        <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{{ item.text }}</span>

        <!-- 附件数 -->
        <span
          v-if="item.files?.length"
          class="inline-flex shrink-0 items-center gap-0.5 rounded-[4px] border border-border px-[5px] py-px text-[9.5px] font-semibold text-muted-foreground">
          <PaperclipIcon class="size-2.5" />{{ item.files.length }}
        </span>

        <!-- 深度思考标记 -->
        <BrainIcon v-if="item.thinking" class="size-3 shrink-0 text-primary" />

        <!-- 取消 -->
        <button
          type="button"
          aria-label="取消发送"
          title="取消发送"
          class="inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
          @click="emit('remove', item.id)">
          <XIcon class="size-3" />
        </button>
      </li>
    </ul>
  </div>
</template>
