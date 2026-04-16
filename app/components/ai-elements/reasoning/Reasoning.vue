<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Collapsible } from '@repo/shadcn-vue/components/ui/collapsible'
import { cn } from '@repo/shadcn-vue/lib/utils'
import { computed, getCurrentInstance, onBeforeUnmount, provide, ref, watch } from 'vue'
import { ReasoningKey } from './context'

interface Props {
  class?: HTMLAttributes['class']
  isStreaming?: boolean
  open?: boolean
  defaultOpen?: boolean
  duration?: number
}

const props = withDefaults(defineProps<Props>(), {
  isStreaming: false,
  defaultOpen: false,
  duration: undefined,
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:duration', value: number): void
}>()

// Vue 3 会把声明为 boolean 但父组件未传的 prop 默认 cast 为 false（不是 undefined），
// 因此 `props.open` 无法区分"未传"和"显式 false"。这里通过 vnode.props 在挂载期一次性
// 检测父组件是否真的写了 :open / v-model:open，决定走 controlled 还是 uncontrolled 模式。
// uncontrolled 模式下完全用内部 ref + defaultOpen 初始化，避免被 boolean cast 强制覆盖。
const __vm = getCurrentInstance()
const isControlled = !!__vm?.vnode?.props && (
  'open' in __vm.vnode.props || 'onUpdate:open' in __vm.vnode.props
)

const internalOpen = ref(props.defaultOpen)
const isOpen = computed<boolean>({
  get: () => isControlled ? !!props.open : internalOpen.value,
  set: (val) => {
    if (!isControlled) internalOpen.value = val
    emit('update:open', val)
  },
})

const internalDuration = ref<number | undefined>(props.duration)

watch(() => props.duration, (newVal) => {
  internalDuration.value = newVal
})

function updateDuration(val: number) {
  internalDuration.value = val
  emit('update:duration', val)
}

const startTime = ref<number | null>(null)
const hasAutoClosed = ref(false)
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null

const MS_IN_S = 1000
const AUTO_CLOSE_DELAY = 1000

function cancelAutoCloseTimer() {
  if (autoCloseTimer !== null) {
    clearTimeout(autoCloseTimer)
    autoCloseTimer = null
    // 视为已 auto-close，下次 isStreaming false 边沿不再启动新的 timer
    hasAutoClosed.value = true
  }
}

// 边沿触发：仅在 isStreaming 由 true → false（且 defaultOpen 启用）时
// 启动一次性 1s 自动收起。期间用户手动操作会取消 timer 并彻底关闭闸门，
// 避免老实现"watch 把 isOpen 当依赖 + cleanup 不更新 hasAutoClosed"导致的
// 用户单次点击展开后又被 timer 自动收起的 bug。
watch(() => props.isStreaming, (newStreaming, oldStreaming) => {
  if (newStreaming) {
    isOpen.value = true
    if (startTime.value === null && props.duration === undefined) {
      startTime.value = Date.now()
    }
    return
  }

  if (startTime.value !== null) {
    const calculated = Math.ceil((Date.now() - startTime.value) / MS_IN_S)
    updateDuration(calculated)
    startTime.value = null
  }

  // 真正的"边沿"：从 streaming(true) 转入 idle(false) 才触发一次自动收起
  // 不依赖 defaultOpen —— defaultOpen 仅控制初始可见状态，
  // 流式结束的自动收起是独立的 UX 行为（让用户专注于最终结果）
  if (oldStreaming === true && !hasAutoClosed.value) {
    autoCloseTimer = setTimeout(() => {
      autoCloseTimer = null
      hasAutoClosed.value = true
      isOpen.value = false
    }, AUTO_CLOSE_DELAY)
  }
}, { immediate: true })

// 用户手动操作 isOpen 时取消尚未触发的 auto-close timer，
// 同时把 hasAutoClosed 置 true 防止后续 isStreaming 边沿再次启动 timer。
watch(isOpen, () => {
  cancelAutoCloseTimer()
})

// 组件销毁前清理 pending 的 timer，避免回调在 unmount 后无意义地写入响应式状态
onBeforeUnmount(() => {
  if (autoCloseTimer !== null) clearTimeout(autoCloseTimer)
})

provide(ReasoningKey, {
  isStreaming: computed(() => props.isStreaming),
  isOpen,
  setIsOpen: (val: boolean) => { isOpen.value = val },
  duration: computed(() => internalDuration.value),
})
</script>

<template>
  <Collapsible
    v-model:open="isOpen"
    :class="cn('not-prose mb-4', props.class)"
  >
    <slot />
  </Collapsible>
</template>
