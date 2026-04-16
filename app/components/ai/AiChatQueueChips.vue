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
    <!-- 状态横幅：运行中 vs 暂停态，视觉区分 -->
    <div
      :class="[
        'px-3 py-2 text-xs flex items-center gap-2',
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
            size="sm"
            variant="outline"
            data-testid="queue-resume"
            @click="emit('resume')"
          >
            <PlayIcon class="size-3 mr-1" />
            恢复队列
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-testid="queue-clear"
            @click="emit('clear')"
          >
            <TrashIcon class="size-3 mr-1" />
            清空
          </Button>
        </div>
      </template>
      <!-- 运行中横幅 -->
      <template v-else>
        <Loader2Icon class="size-3.5 animate-spin shrink-0" />
        <span>排队中 ({{ queue.length }}/{{ max }})</span>
      </template>
    </div>

    <!-- 队列条目列表：基于 ai-elements/queue 基元组件 -->
    <div class="p-2 max-h-[180px] overflow-y-auto">
      <AiElementsQueue>
        <!--
          通过 ! 前缀覆盖 QueueItem 默认的 flex-col 为 flex-row，
          实现横向排列（Tailwind v4 支持 ! 前缀的 !important）
        -->
        <AiElementsQueueItem
          v-for="(item, index) in queue"
          :key="item.id"
          class="!flex-row items-center gap-2"
        >
          <!-- 序号 badge -->
          <Badge variant="secondary" class="shrink-0 text-[10px] h-5 px-1.5">
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

          <!-- 附件数量 badge（仅当有附件时显示） -->
          <Badge v-if="item.files?.length" variant="outline" class="shrink-0 h-5 text-[10px]">
            <PaperclipIcon class="size-3" />
            {{ item.files.length }}
          </Badge>

          <!-- 深度思考标记（带 testid 供测试选取，放在 wrapper span 上避免依赖 lucide attrs 透传） -->
          <span v-if="item.thinking" data-testid="queue-brain-icon" class="inline-flex shrink-0">
            <BrainIcon class="size-3.5 text-primary" />
          </span>

          <!-- 删除按钮：包在 QueueItemActions 里，hover 才显示（AiElementsQueueItemAction 自带行为） -->
          <AiElementsQueueItemActions class="shrink-0">
            <AiElementsQueueItemAction
              data-testid="queue-remove"
              @click="emit('remove', item.id)"
            >
              <XIcon class="size-3" />
            </AiElementsQueueItemAction>
          </AiElementsQueueItemActions>
        </AiElementsQueueItem>
      </AiElementsQueue>
    </div>
  </div>
</template>
