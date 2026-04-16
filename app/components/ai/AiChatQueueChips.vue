<script setup lang="ts">
import { PauseIcon, PlayIcon, TrashIcon, Loader2Icon, PaperclipIcon, BrainIcon, XIcon } from 'lucide-vue-next'
import type { QueueItem, QueuePauseReason } from '~/composables/chatQueueActions'

interface Props {
  queue: readonly QueueItem[]
  max: number
  paused: boolean
  pauseReason: QueuePauseReason
}

const props = defineProps<Props>()

const emit = defineEmits<{
  remove: [itemId: string]
  resume: []
  clear: []
}>()

/** 暂停原因的显示文本 */
const pauseReasonText = computed(() => {
  if (props.pauseReason === 'stopped') return '已手动停止'
  if (props.pauseReason === 'failed') return '上一条执行失败'
  return ''
})

/**
 * 截断文本：超过 max 字符时在末尾加 … 号
 * 与 QueueItemContent 的 line-clamp 样式配合使用（视觉截断 + 语义截断双保险）
 */
function truncate(text: string, max = 24): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
</script>

<template>
  <div v-if="queue.length > 0" class="border-t border-b">
    <!-- 状态横幅：运行中 vs 暂停态（方案 A 紧凑化：py-2→py-1.5） -->
    <div
      :class="[
        'px-3 py-1.5 text-xs flex items-center gap-2',
        paused
          ? 'bg-amber-50 text-amber-700 border-b border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30'
          : 'text-muted-foreground bg-muted/30',
      ]"
    >
      <!-- 暂停态横幅 -->
      <template v-if="paused">
        <PauseIcon class="size-3.5 shrink-0" />
        <span>队列已暂停（{{ pauseReasonText }}）</span>
        <div class="ml-auto flex gap-1">
          <Button
            size="icon-sm"
            variant="outline"
            class="!size-6"
            aria-label="恢复队列"
            title="恢复队列"
            data-testid="queue-resume"
            @click="emit('resume')"
          >
            <PlayIcon class="size-3" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            class="!size-6"
            aria-label="清空队列"
            title="清空队列"
            data-testid="queue-clear"
            @click="emit('clear')"
          >
            <TrashIcon class="size-3" />
          </Button>
        </div>
      </template>
      <!-- 运行中横幅 -->
      <template v-else>
        <Loader2Icon class="size-3.5 animate-spin shrink-0" />
        <span>排队中 ({{ queue.length }}/{{ max }})</span>
      </template>
    </div>

    <!-- 队列条目列表（方案 A 紧凑化：p-2→p-1, max-h-[120px]→max-h-[88px] 约容纳 3 条紧凑 chip） -->
    <div class="p-1 max-h-[88px] overflow-y-auto">
      <!-- AiElementsQueue 默认 p-2 gap-2 多占 24px，此处用 !p-0 !gap-0 覆盖 -->
      <AiElementsQueue class="!p-0 !gap-0">
        <!--
          方案 A 紧凑化：!flex-row 覆盖 flex-col + !px-2 !py-0.5 !text-xs 减小每条 chip 高度
          + !rounded-none 去圆角避免"卡片感"，只保留 hover:bg-muted 的背景反馈（默认行为）
          原：px-3 py-1 text-sm (~32px) → 现：扁平无圆角 (~24px)
        -->
        <AiElementsQueueItem
          v-for="(item, index) in queue"
          :key="item.id"
          class="!flex-row items-center gap-1.5 !px-2 !py-0.5 !text-xs !rounded-none"
        >
          <!-- 序号 badge（紧凑：h-5→h-4，text-[10px]→text-[9px]） -->
          <Badge variant="secondary" class="shrink-0 text-[9px] h-4 px-1">
            #{{ index + 1 }}
          </Badge>

          <!--
            文本内容与 Tooltip：
            原计划复用 AiElementsQueueItemContent，但 reka-ui 的 TooltipTrigger as-child
            通过 <Slot> primitive 把事件 + DOM ref 注入子元素，要求子元素能 forward DOM ref。
            Vue 3 自定义组件默认 ref 指向组件实例（非 DOM 节点），QueueItemContent 未做 ref 转发，
            作为 as-child 子元素时 Tooltip 定位失败。
            按 spec §6.4 不改第三方 ai-elements 组件，直接用原生 span + 复制 line-clamp 等样式 class。
          -->
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <span class="line-clamp-1 grow break-words text-muted-foreground min-w-0 cursor-default">
                  {{ truncate(item.text) }}
                </span>
              </TooltipTrigger>
              <TooltipContent class="max-w-md">
                <div class="text-xs whitespace-pre-wrap">{{ item.text }}</div>
                <div v-if="item.files?.length" class="mt-1 text-[10px] text-muted-foreground">
                  附件：{{ item.files.map(f => f.fileName).join('、') }}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <!-- 附件数量 badge（紧凑：h-5→h-4） -->
          <Badge v-if="item.files?.length" variant="outline" class="shrink-0 h-4 text-[9px] px-1">
            <PaperclipIcon class="size-2.5" />
            {{ item.files.length }}
          </Badge>

          <!-- 深度思考标记（带 testid 供测试选取，放在 wrapper span 上避免依赖 lucide attrs 透传） -->
          <span v-if="item.thinking" data-testid="queue-brain-icon" class="inline-flex shrink-0">
            <BrainIcon class="size-3 text-primary" />
          </span>

          <!-- 删除按钮：包在 QueueItemActions 里，hover 才显示（AiElementsQueueItemAction 自带行为） -->
          <AiElementsQueueItemActions class="shrink-0">
            <AiElementsQueueItemAction
              class="!size-5"
              data-testid="queue-remove"
              @click="emit('remove', item.id)"
            >
              <XIcon class="size-2.5" />
            </AiElementsQueueItemAction>
          </AiElementsQueueItemActions>
        </AiElementsQueueItem>
      </AiElementsQueue>
    </div>
  </div>
</template>
