<template>
  <div class="flex flex-col relative" style="height: calc(100vh - 48px)">
    <!-- 提取中遮罩 -->
    <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0"
      enter-to-class="opacity-100" leave-active-class="transition duration-150 ease-in" leave-from-class="opacity-100"
      leave-to-class="opacity-0">
      <div v-if="isExtracting"
        class="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
        <Loader2Icon class="size-8 animate-spin text-primary" />
        <p class="text-sm text-muted-foreground">正在提取案件信息，请稍候...</p>
      </div>
    </Transition>
    <!-- step = 'ai': AI 创建视图（v-show 保留 DOM 避免输入丢失） -->
    <div v-show="step === 'ai'" class="flex-1 overflow-y-auto">
      <!-- 欢迎语 -->
      <CaseAnalysisWelcome title="你好，我是小索，你的案件分析助手" subtitle="在下方输入框输入或上传案情材料，我会为你分析案件" />

      <!-- 输入框 -->
      <AiPromptInput ref="promptInputRef" class="h-auto!" placeholder="请输入案情信息或者上传案情材料，支持上传 文本、文档、音频、图片 四种材料。"
        :enable-file-upload="true" :show-thinking-toggle="false" :loading="isExtracting" :disabled="isExtracting"
        :min-rows="4" :max-rows="10" submit-label="提取信息" :on-file-button-click="openMaterialSelector"
        @submit="handleAiSubmit" />

      <!-- 文件选择弹框 -->
      <CaseAnalysisMaterialSelector ref="materialSelectorRef" :disabled-file-ids="selectedFileIds"
        @files-selected="handleFilesFromSelector" />

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
    <div v-if="step === 'confirm'" class="flex flex-1 flex-col overflow-y-auto pb-0">
      <!-- 返回按钮 -->
      <Button variant="ghost" size="sm" class="self-start m-4 mb-0" @click="step = 'ai'">
        <ArrowLeftIcon class="size-4 mr-1" />
        返回
      </Button>

      <!-- 表单 -->
      <CaseCreationManualForm ref="manualFormRef" :case-types="caseTypes" :is-submitting="isSubmitting"
        :initial-data="formInitialData" @submit="handleCreate" />
    </div>

    <!-- 确认表单底部操作栏 -->
    <div v-if="step === 'confirm'"
      class="sticky bottom-0 border-t bg-background/95 backdrop-blur-sm px-4 sm:px-6 md:px-12 py-3">
      <div class="flex justify-end">
        <Button :disabled="!manualFormRef?.canSubmit || isSubmitting" class="w-full sm:w-auto min-w-[120px]"
          @click="manualFormRef?.submit()">
          <Loader2Icon v-if="isSubmitting" class="size-4 mr-2 animate-spin" />
          创建案件
        </Button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ArrowRightIcon, ArrowLeftIcon, Loader2Icon } from 'lucide-vue-next'
import type { AiPromptSubmitData } from '~/components/ai/AiPromptInput.vue'
import type { ExampleItem } from '~/components/caseAnalysis/example.vue'
import type { OssFileItem } from '~/store/file'
import type { CreateCaseParams } from '~/composables/useCaseCreation'

definePageMeta({
  title: '创建案件',
  layout: 'dashboard-layout',
})

const {
  step, isSubmitting, isExtracting, caseTypes,
  extractedFormData, rawExtractedInfo, uploadedFiles,
  loadCaseTypes, createCase, extractCaseInfo,
} = useCaseCreation()

const promptInputRef = ref()
const materialSelectorRef = ref()
const manualFormRef = ref()
const showReplaceConfirm = ref(false)
const pendingExampleContent = ref('')

// 已选文件 ID（传给 MaterialSelector 禁用已选项）
const selectedFileIds = computed(() => promptInputRef.value?.selectedFileIds ?? [])

onMounted(() => {
  loadCaseTypes()
})

// 打开文件选择弹框
function openMaterialSelector() {
  materialSelectorRef.value?.openDialog()
}

// 从弹框选择文件后添加到输入框
function handleFilesFromSelector(files: OssFileItem[]) {
  promptInputRef.value?.addFiles(files)
}

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
  uploadedFiles.value = []
  step.value = 'confirm'
}

// 表单初始数据
const formInitialData = computed(() => {
  if (!extractedFormData.value && uploadedFiles.value.length === 0) return undefined
  return {
    ...extractedFormData.value,
    initialFiles: uploadedFiles.value,
    summary: rawExtractedInfo.value?.summary,
    extractedInfo: rawExtractedInfo.value?.extraFields,
  }
})

// 创建案件
async function handleCreate(params: CreateCaseParams) {
  await createCase(params)
}
</script>
