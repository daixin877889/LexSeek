<template>
  <div>
    <CaseAnalysisWelcome />

    <div class="p-4 pt-2">
      <AiPromptInput
        ref="promptInputRef"
        v-model:thinking="thinkingEnabled"
        :loading="isCreating"
        :enable-file-upload="true"
        :on-file-button-click="openMaterialSelector"
        placeholder="请输入案情信息或者上传案情材料，支持上传 文本、文档、音频、图片 四种材料。"
        submit-label="法索一下"
        :min-rows="4"
        :max-rows="12"
        @submit="handleAiSubmit"
      />
    </div>

    <CaseAnalysisExample v-if="!hasPromptInput" />
    <CaseAnalysisModuleSelector v-else id="analysis-module-selector" />

    <!-- 阶段 7：MaterialSelector 由调用方接管（取代 promptInput.vue 内嵌） -->
    <CaseAnalysisMaterialSelector
      ref="materialSelectorRef"
      :disabled-file-ids="selectedFileIds"
      @files-selected="handleFilesFromSelector"
    />
  </div>
</template>

<script lang="ts" setup>
import type { AiPromptSubmitData } from '~/components/ai/AiPromptInput.vue'
import type { OssFileItem } from '~/store/file'
import { toast } from 'vue-sonner'
import AiPromptInput from '~/components/ai/AiPromptInput.vue'
import CaseAnalysisExample from '~/components/caseAnalysis/example.vue'
import CaseAnalysisMaterialSelector from '~/components/caseAnalysis/materialSelector.vue'
import CaseAnalysisModuleSelector from '~/components/caseAnalysis/moduleSelector.vue'
import CaseAnalysisWelcome from '~/components/caseAnalysis/welcome.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useCaseAnalysisStore } from '~/store/caseAnalysis'
import { getMaterialType } from '~/utils/caseMaterial'

definePageMeta({
  title: "案件分析",
  layout: "dashboard-layout",
})

const router = useRouter()
const store = useCaseAnalysisStore()
const { hasPromptInput } = storeToRefs(store)

const promptInputRef = ref<{
  reset: () => void
  addFiles: (files: OssFileItem[]) => void
  selectedFileIds: number[]
} | null>(null)
const materialSelectorRef = ref<{ openDialog: () => void } | null>(null)

const isCreating = ref(false)
const thinkingEnabled = ref(true)

// 已选文件 ID（传给 MaterialSelector 禁用已选项）
const selectedFileIds = computed(() => promptInputRef.value?.selectedFileIds ?? [])

function openMaterialSelector() {
  materialSelectorRef.value?.openDialog()
}

function handleFilesFromSelector(files: OssFileItem[]) {
  promptInputRef.value?.addFiles(files)
}

async function handleAiSubmit(data: AiPromptSubmitData) {
  isCreating.value = true
  try {
    const text = data.text.trim()
    const files = data.files ?? []

    // 生成案件标题（与旧 promptInput.vue 一致）
    const title = text
      ? text.slice(0, 50) + (text.length > 50 ? '...' : '')
      : files[0]?.fileName || '新案件'

    // OssFileItem → CaseMaterialParam 映射（旧 promptInput.vue 内部已做，新版搬到这里）
    const materials = files.map(file => ({
      type: getMaterialType(file.fileType),
      name: file.fileName,
      ossFileId: file.id,
    }))

    const createResult = await useApiFetch<{
      caseId: number
      sessionId: string
    }>('/api/v1/case/create', {
      method: 'POST',
      body: {
        title,
        content: text || undefined,
        caseTypeId: 1,
        materials: materials.length > 0 ? materials : undefined,
      },
    })

    if (!createResult) return

    promptInputRef.value?.reset()
    await router.push({
      path: `/dashboard/analysis/${createResult.sessionId}`,
      query: thinkingEnabled.value ? undefined : { thinking: 'false' },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '操作失败，请重试'
    toast.error(errorMessage)
  } finally {
    isCreating.value = false
  }
}
</script>

<style></style>
