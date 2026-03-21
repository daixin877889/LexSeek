<template>
  <div>
    <CaseAnalysisWelcome />
    <CaseAnalysisPromptInput ref="promptInputRef" v-model:thinking="thinkingEnabled" :loading="isCreating" @submit="handleCreate" />
    <CaseAnalysisExample v-if="!hasPromptInput" />
    <CaseAnalysisModuleSelector v-else id="analysis-module-selector" />
  </div>
</template>

<script lang="ts" setup>
import type { PromptSubmitData } from '#shared/types/case'
import { toast } from 'vue-sonner'

definePageMeta({
  title: "案件分析",
  layout: "dashboard-layout",
})

const router = useRouter()
const store = useCaseAnalysisStore()
const { hasPromptInput } = storeToRefs(store)

const promptInputRef = ref<{ reset: () => void } | null>(null)
const isCreating = ref(false)
const thinkingEnabled = ref(true)

async function handleCreate(data: PromptSubmitData) {
  isCreating.value = true
  try {
    // 生成案件标题
    const title = data.text.trim()
      ? data.text.trim().slice(0, 50) + (data.text.trim().length > 50 ? '...' : '')
      : data.materials[0]?.name || '新案件'

    const createResult = await useApiFetch<{
      caseId: number
      sessionId: string
    }>('/api/v1/case/create', {
      method: 'POST',
      body: {
        title,
        content: data.text.trim() || undefined,
        caseTypeId: 1,
        materials: data.materials.length > 0 ? data.materials : undefined,
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
