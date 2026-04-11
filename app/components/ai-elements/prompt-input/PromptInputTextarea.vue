<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { InputGroupTextarea } from '@repo/shadcn-vue/components/ui/input-group'
import { cn } from '@repo/shadcn-vue/lib/utils'
import { computed, ref } from 'vue'
import { usePromptInput } from './context'

interface Props {
  class?: HTMLAttributes['class']
  placeholder?: string
  /** 最小显示行数（会换算为 min-height） */
  minRows?: number
  /** 最大显示行数（会换算为 max-height） */
  maxRows?: number
}

const props = defineProps<Props>()

const { textInput, setTextInput, submitForm, addFiles, files, removeFile } = usePromptInput()
const isComposing = ref(false)

// 将行数换算为像素高度（line-height ≈ 1.5em，上下 padding 合计 1.5rem）
const sizeStyle = computed(() => {
  const style: Record<string, string> = {}
  if (props.minRows != null) {
    style.minHeight = `calc(${props.minRows} * 1.5em + 1.5rem)`
  }
  if (props.maxRows != null) {
    style.maxHeight = `calc(${props.maxRows} * 1.5em + 1.5rem)`
  }
  return style
})

const hasCustomSize = computed(() => props.minRows != null || props.maxRows != null)

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    if (isComposing.value || e.shiftKey)
      return
    e.preventDefault()
    submitForm()
  }

  // Remove last attachment on backspace if input is empty
  if (e.key === 'Backspace' && textInput.value === '' && files.value.length > 0) {
    const lastFile = files.value[files.value.length - 1]
    if (lastFile) {
      removeFile(lastFile.id)
    }
  }
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items)
    return

  const pastedFiles: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file)
        pastedFiles.push(file)
    }
  }

  if (pastedFiles.length > 0) {
    e.preventDefault()
    addFiles(pastedFiles)
  }
}

const modelValue = computed({
  get: () => textInput.value,
  set: val => setTextInput(val),
})
</script>

<template>
  <InputGroupTextarea
    v-model="modelValue"
    :placeholder="placeholder ?? 'What would you like to know?'"
    name="message"
    :class="cn('field-sizing-content', hasCustomSize ? '' : 'max-h-48 min-h-16', props.class)"
    :style="sizeStyle"
    @keydown="handleKeyDown"
    @paste="handlePaste"
    @compositionstart="isComposing = true"
    @compositionend="isComposing = false"
  />
</template>
