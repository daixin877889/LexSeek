<template>
  <div class="flex flex-col" style="height: calc(100vh - 48px)">
    <!-- step = 'ai': AI 创建视图（v-show 保留 DOM 避免输入丢失） -->
    <div v-show="step === 'ai'" class="flex-1 overflow-y-auto">
      <!-- 欢迎语 -->
      <CaseAnalysisWelcome title="描述您的案件" subtitle="AI 将帮您提取关键信息，快速创建案件" />

      <!-- 输入框 -->
      <AiPromptInput ref="promptInputRef" class="h-auto!" placeholder="请描述您的案件情况，例如：张三与李四因房屋租赁合同产生纠纷..."
        :enable-file-upload="true" :show-thinking-toggle="false" :loading="isExtracting" :disabled="isExtracting"
        :min-rows="4" :max-rows="10" submit-label="提取信息" @submit="handleAiSubmit" />

      <!-- 示例卡片 -->
      <CaseAnalysisExample title="✨ 或者点击下方案例快速体验" @select="handleExampleSelect" />

      <!-- 替换确认弹窗 -->
      <AlertDialog v-model:open="showReplaceConfirm">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>替换当前内容</AlertDialogTitle>
            <AlertDialogDescription>
              当前输入框已有内容，填充案例将清除已有的描述和文件。是否继续？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction @click="confirmReplaceExample">确认替换</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <!-- 手动创建入口 -->
      <div class="text-right px-4 pb-4">
        <Button variant="link" @click="goToManual" class="text-muted-foreground">
          手动创建
          <ArrowRightIcon class="size-4 ml-1" />
        </Button>
      </div>
    </div>

    <!-- step = 'confirm': 确认表单视图 -->
    <div v-if="step === 'confirm'" class="flex flex-1 flex-col overflow-y-auto">
      <!-- 返回按钮 -->
      <Button variant="ghost" size="sm" class="self-start m-4 mb-0" @click="step = 'ai'">
        <ArrowLeftIcon class="size-4 mr-1" />
        返回
      </Button>

      <!-- 表单 -->
      <CaseCreationManualForm :case-types="caseTypes" :is-submitting="isSubmitting" :initial-data="formInitialData"
        @submit="handleCreate" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ArrowRightIcon, ArrowLeftIcon } from 'lucide-vue-next'
import type { AiPromptSubmitData } from '~/components/ai/AiPromptInput.vue'
import type { ExampleItem } from '~/components/caseAnalysis/example.vue'

definePageMeta({
  title: '创建案件',
  layout: 'dashboard-layout',
})

const {
  step, isSubmitting, isExtracting, caseTypes,
  extractedFormData, uploadedMaterials,
  loadCaseTypes, createCase, extractCaseInfo,
} = useCaseCreation()

const promptInputRef = ref()
const showReplaceConfirm = ref(false)
const pendingExampleContent = ref('')

onMounted(() => {
  loadCaseTypes()
})

// AI 提交处理
async function handleAiSubmit(data: AiPromptSubmitData) {
  await extractCaseInfo(data.text, data.files)
}

// 示例选择处理
function handleExampleSelect(example: ExampleItem) {
  if (!example.content) return

  const input = promptInputRef.value
  if (input?.hasContent()) {
    pendingExampleContent.value = example.content
    showReplaceConfirm.value = true
    return
  }

  input?.setText(example.content)
}

function confirmReplaceExample() {
  promptInputRef.value?.reset()
  nextTick(() => {
    promptInputRef.value?.setText(pendingExampleContent.value)
    pendingExampleContent.value = ''
  })
}

// 手动创建
function goToManual() {
  extractedFormData.value = null
  uploadedMaterials.value = []
  step.value = 'confirm'
}

// 表单初始数据
const formInitialData = computed(() => {
  if (!extractedFormData.value) return undefined
  return {
    ...extractedFormData.value,
    materials: uploadedMaterials.value,
  }
})

// 创建案件
async function handleCreate(params: {
  caseTypeId: number
  title?: string
  plaintiff?: Array<{ name: string }>
  defendant?: Array<{ name: string }>
  content?: string
  materials?: Array<{ type: number; name?: string; ossFileId?: number }>
}) {
  await createCase(params)
}
</script>
