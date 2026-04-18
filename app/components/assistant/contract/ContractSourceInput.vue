<template>
  <AiPromptInput
    :show-thinking-toggle="false"
    :enable-file-upload="true"
    placeholder="粘贴合同全文或上传 .docx（≤ 20 MB）..."
    submit-label="开始审查"
    @submit="handleAiSubmit"
  />
</template>

<script lang="ts" setup>
import { toast } from 'vue-sonner'
import type { AiPromptSubmitData } from '~/components/ai/AiPromptInput.vue'
import type { OssFileItem } from '~/store/file'
import type { CreateReviewRequest } from '#shared/types/contract'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_SIZE_BYTES = 20 * 1024 * 1024

const emit = defineEmits<{
  submit: [payload: CreateReviewRequest]
}>()

function handleAiSubmit(data: AiPromptSubmitData) {
  const files = data.files ?? []
  const text = (data.text ?? '').trim()

  if (files.length > 1) {
    toast.warning('只能上传一份合同')
    return
  }

  if (files.length === 1) {
    const file = files[0] as OssFileItem
    if (file.fileType !== DOCX_MIME) {
      toast.warning('仅支持 .docx 文件')
      return
    }
    if (file.fileSize > MAX_SIZE_BYTES) {
      toast.warning('文件不得超过 20 MB')
      return
    }
    emit('submit', { sourceType: 'upload', ossFileId: file.id })
    return
  }

  // 无文件：要求文本非空（空则静默，按钮在 AiPromptInput 内部已 disable）
  if (!text) return
  emit('submit', { sourceType: 'paste', text })
}
</script>
