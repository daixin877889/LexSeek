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
      <CaseAnalysisWelcome title="你好，我是小索，您的案件分析助手" subtitle="在下方输入框输入或上传案情材料，我会为您分析案件" />

      <!-- 输入框 -->
      <AiPromptInput ref="promptInputRef" class="h-auto!" placeholder="请描述您的案件情况，例如：张三与李四因房屋租赁合同产生纠纷..."
        :enable-file-upload="true" :show-thinking-toggle="false" :loading="isExtracting" :disabled="isExtracting"
        :min-rows="4" :max-rows="10" submit-label="提取信息" :on-file-button-click="openMaterialSelector"
        @submit="handleAiSubmit" />

      <!-- 文件选择弹框 -->
      <CaseAnalysisMaterialSelector ref="materialSelectorRef" :disabled-file-ids="selectedFileIds"
        @files-selected="handleFilesFromSelector" />

      <!-- 示例卡片 -->
      <CaseAnalysisExample
        :examples="demoCases"
        :loading="demoCasesLoading"
        :selecting-id="preparingDemoCaseId"
        title="✨ 或者点击下方案例快速体验"
        @select="handleExampleSelect"
      />

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
      <!-- 页头：返回 + 标题 + AI 回填提示 -->
      <div class="px-4 pt-5 sm:px-6 md:px-10">
        <button type="button"
          class="-ml-2 mb-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="step = 'ai'">
          <ArrowLeftIcon class="size-4" />
          返回上一步
        </button>

        <h1 class="text-[22px] font-bold tracking-tight">完善案件信息</h1>
        <p class="mt-1 text-[13.5px] text-muted-foreground">核对并补全以下信息，确认后小索将立即开始案件分析</p>

        <!-- AI 回填提示横幅 -->
        <div v-if="aiFilled"
          class="mt-4 flex items-center gap-3 rounded-xl border border-primary/15 bg-gradient-brand-soft px-4 py-3 dark:bg-gradient-brand-soft-dark">
          <div
            class="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-brand p-[2.5px] shadow-[0_10px_20px_-9px_rgba(30,158,237,0.5)]">
            <div class="flex size-full items-center justify-center overflow-hidden rounded-full bg-white">
              <IconXiaosuoIcon class="size-6" />
            </div>
          </div>
          <p class="text-[13px] leading-relaxed text-foreground">
            <GradientText class="font-semibold">小索</GradientText>
            已根据案情自动梳理以下信息，请核对修改后提交。
          </p>
        </div>
      </div>

      <!-- 表单 -->
      <CaseCreationManualForm ref="manualFormRef" :case-types="caseTypes" :is-submitting="isSubmitting"
        :initial-data="formInitialData" @submit="handleCreate" />
    </div>

    <!-- 确认表单底部操作栏 -->
    <div v-if="step === 'confirm'"
      class="sticky bottom-0 border-t border-border bg-background/90 px-4 py-3 backdrop-blur-sm sm:px-6 md:px-10">
      <div class="flex items-center justify-between gap-3">
        <span class="text-[12.5px] text-muted-foreground">
          <span class="text-destructive">*</span> 为必填项
        </span>
        <div class="flex items-center gap-2.5">
          <Button variant="outline" :disabled="isSubmitting" @click="step = 'ai'">取消</Button>
          <Button :disabled="!manualFormRef?.canSubmit || isSubmitting"
            class="min-w-[120px] bg-gradient-brand-button text-white shadow-[0_10px_20px_-8px_rgba(30,158,237,0.42)]"
            @click="manualFormRef?.submit()">
            <Loader2Icon v-if="isSubmitting" class="size-4 animate-spin" />
            创建案件
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ArrowRightIcon, ArrowLeftIcon, Loader2Icon } from 'lucide-vue-next'
import type { AiPromptSubmitData } from '~/components/ai/AiPromptInput.vue'
import type { OssFileItem } from '~/store/file'
import type { CreateCaseParams } from '~/composables/useCaseCreation'
import AiPromptInput from '~/components/ai/AiPromptInput.vue'
import CaseAnalysisExample from '~/components/caseAnalysis/example.vue'
import CaseAnalysisMaterialSelector from '~/components/caseAnalysis/materialSelector.vue'
import CaseAnalysisWelcome from '~/components/caseAnalysis/welcome.vue'
import CaseCreationManualForm from '~/components/caseCreation/ManualForm.vue'
import GradientText from '~/components/general/GradientText.vue'
import IconXiaosuoIcon from '~/components/icon/XiaosuoIcon.vue'
import { useCaseCreation } from '~/composables/useCaseCreation'

definePageMeta({
  title: '创建案件',
  layout: 'dashboard-layout',
})

const promptInputRef = ref()
const {
  step, isSubmitting, isExtracting, caseTypes,
  extractedFormData, rawExtractedInfo, uploadedFiles,
  loadCaseTypes, createCase, extractCaseInfo,
  // demo case 扩展
  demoCases, demoCasesLoading, preparingDemoCaseId,
  showReplaceConfirm,
  loadDemoCases, handleExampleSelect, confirmReplaceExample,
} = useCaseCreation(promptInputRef)

const materialSelectorRef = ref()
const manualFormRef = ref()

// 已选文件 ID（传给 MaterialSelector 禁用已选项）
const selectedFileIds = computed(() => promptInputRef.value?.selectedFileIds ?? [])

onMounted(() => {
  loadCaseTypes()
  loadDemoCases()
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

// 手动创建
function goToManual() {
  extractedFormData.value = null
  uploadedFiles.value = []
  step.value = 'confirm'
}

// AI 是否已回填表单（决定是否显示小索回填提示横幅）
const aiFilled = computed(() => !!extractedFormData.value)

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
