<template>
  <div>
    <!-- 文件上传 + 文本输入（复用 AiPromptInput 完整能力） -->
    <AiPromptInput
      :show-thinking-toggle="false"
      :enable-file-upload="true"
      placeholder="请输入文书需求，或上传参考文件..."
      submit-label="开始生成"
      @submit="handleAiSubmit"
    />

    <!-- 案件材料选择（仅案件场景） -->
    <div v-if="caseId" class="mt-2 flex items-center gap-2">
      <Button size="sm" variant="outline" @click="materialSelectorRef?.openDialog()">
        <FileIcon class="size-4 mr-1" />
        从案件材料选择
      </Button>
      <span v-if="selectedCaseMaterialIds.length" class="text-xs text-muted-foreground">
        已选 {{ selectedCaseMaterialIds.length }} 个案件材料
      </span>
    </div>

    <CaseAnalysisMaterialSelector
      v-if="caseId"
      ref="materialSelectorRef"
      :disabled-file-ids="[]"
      @filesSelected="handleMaterialsSelected"
    />
  </div>
</template>

<script lang="ts" setup>
import { FileIcon } from 'lucide-vue-next'
import type { AiPromptSubmitData } from '~/components/ai/AiPromptInput.vue'
import type { OssFileItem } from '~/store/file'

const props = defineProps<{
  /** 案件 ID，存在时显示"从案件材料选"按钮 */
  caseId?: number
}>()

const emit = defineEmits<{
  submit: [data: { text: string; sourceFileIds: number[] }]
}>()

const materialSelectorRef = ref<{ openDialog: () => void; closeDialog: () => void } | null>(null)
const selectedCaseMaterialIds = ref<number[]>([])

function handleAiSubmit(data: AiPromptSubmitData) {
  const uploadedFileIds = (data.files ?? []).map((f: OssFileItem) => f.id)
  emit('submit', {
    text: data.text,
    sourceFileIds: [...uploadedFileIds, ...selectedCaseMaterialIds.value],
  })
}

function handleMaterialsSelected(files: OssFileItem[]) {
  selectedCaseMaterialIds.value = files.map(f => f.id)
}
</script>
