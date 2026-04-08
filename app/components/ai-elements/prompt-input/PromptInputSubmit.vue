<script setup lang="ts">
// import type { InputGroupButtonVariants } from '@/components/ui/input-group'
import type { ChatStatus } from 'ai'
import type { HTMLAttributes } from 'vue'
import { InputGroupButton } from '@/components/ui/input-group'
import { cn } from '@/lib/utils'
import { CornerDownLeftIcon, Loader2Icon, SquareIcon, XIcon } from 'lucide-vue-next'
import { computed } from 'vue'

type InputGroupButtonProps = InstanceType<typeof InputGroupButton>['$props']

interface Props extends /* @vue-ignore */ InputGroupButtonProps {
  class?: HTMLAttributes['class']
  status?: ChatStatus
  variant?: InputGroupButtonProps['variant']
  size?: InputGroupButtonProps['size']
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  size: 'icon-sm',
})

const icon = computed(() => {
  if (props.status === 'submitted') {
    return Loader2Icon
  }
  else if (props.status === 'streaming') {
    return SquareIcon
  }
  else if (props.status === 'error') {
    return XIcon
  }
  return CornerDownLeftIcon
})

const iconClass = computed(() => {
  if (props.status === 'submitted') {
    return 'size-4 animate-spin'
  }
  return 'size-4'
})

const emit = defineEmits<{
  (e: 'submit'): void
  (e: 'stop'): void
}>()

const { status, size, variant, class: _, ...restProps } = props

function handleClick() {
  if (status === 'streaming' || status === 'submitted') {
    emit('stop')
  }
  else {
    emit('submit')
  }
}
</script>

<template>
  <InputGroupButton
    aria-label="Submit"
    :class="cn(props.class)"
    :size="size"
    :variant="variant"
    type="button"
    :disabled="status === 'submitted' || $attrs.disabled === true"
    v-bind="restProps"
    @click.stop="handleClick"
  >
    <div class="flex items-center justify-center">
      <Loader2Icon v-if="status === 'streaming' || status === 'submitted'" class="size-4 animate-spin shrink-0" />
      <slot v-else>
        <component :is="icon" :class="iconClass" />
      </slot>
    </div>
  </InputGroupButton>
</template>
