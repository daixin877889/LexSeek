<template>
  <AiChat
    :title="headerTitle"
    v-model:panel-mode="panelMode"
    :messages="streamMessages"
    :loading="isLoading"
    :show-prompt="false"
    :show-task-queue="false"
    class="h-full" style="height: calc(100vh - 48px)"
    @back="goBack"
  >
    <template #message-list="{ messages: parsedMessages, loading: msgLoading }">
      <div class="flex flex-col h-full">
        <!-- 固定状态栏 -->
        <InitAnalysisPipelineProgress
          v-if="phase !== 'select'"
          :modules="activeModules"
          :module-states="moduleStates"
          class="shrink-0 bg-background border-b"
        />

        <!-- 阶段一：模块选择 -->
        <div v-if="phase === 'select'" class="flex-1 overflow-y-auto p-4">
          <InitAnalysisModuleSelector
            v-model="selectedModules"
            :completed-modules="completedModules"
            @start="startAnalysis"
            @skip="navigateTo(`/dashboard/cases/${caseId}`)"
          />
        </div>

        <!-- 阶段二/三：消息列表（StickToBottom 管理滚动） -->
        <template v-else>
          <div class="flex-1 min-h-0">
            <AiMessageList :messages="parsedMessages" :loading="msgLoading" />
          </div>
        </template>

        <!-- 完成后操作（固定在底部，不在滚动区域内） -->
        <div v-if="phase === 'complete'" class="shrink-0 flex justify-center py-4 bg-background/95 border-t">
          <Button size="lg" @click="navigateTo(`/dashboard/cases/${caseId}`)">
            进入案件详情
          </Button>
        </div>
      </div>
    </template>

    <template #right-panel>
      <div class="h-full flex flex-col bg-background border-l">
        <!-- 仪表盘模式：可滚动 -->
        <div v-show="rightPanelViewMode === 'dashboard'" class="flex-1 overflow-y-auto">
          <div class="flex flex-col">
            <!-- 案件信息 + 材料（复用 CaseDetailOverview 只读模式） -->
            <CaseDetailOverview
              v-if="caseId > 0"
              :case-id="caseId"
              :materials="materials"
              :materials-loading="materialsLoading"
              :analysis-results="[]"
              :readonly="true"
              @preview-material="openMaterialPreview"
            />

            <Separator class="opacity-50" />

            <!-- 分析结果（独立渲染，readonly） -->
            <CaseAnalysisResults
              v-if="phase !== 'select'"
              :results="completedResults"
              v-model:active-index="activeIndex"
              v-model:view-mode="rightPanelViewMode"
              :is-analyzing="phase === 'running'"
              :readonly="true"
              empty-title="分析结果处理中"
              empty-description="AI 正在读取案件材料并生成分析建议，请稍等..."
            />
          </div>
        </div>

        <!-- 详情模式：沉浸式阅读 -->
        <div v-if="rightPanelViewMode === 'detail'" class="flex-1 overflow-hidden">
          <CaseAnalysisResults
            :results="completedResults"
            v-model:active-index="activeIndex"
            v-model:view-mode="rightPanelViewMode"
            :is-analyzing="phase === 'running'"
            :readonly="true"
          />
        </div>
      </div>
    </template>
  </AiChat>

  <!-- 统一中断处理器 -->
  <CaseInterruptHandler :interrupt-data="interruptData" @resume="resumeWorkflow" />

  <!-- 文档/图片预览 -->
  <CaseAnalysisDocPreviewDialog
    v-if="previewMaterial?.type === 2 || previewMaterial?.type === 3"
    v-model:open="showPreview"
    :oss-file-id="previewMaterial!.ossFileId!"
    :file-name="previewMaterial!.name"
    :file-type="previewMaterial!.fileType || 'document'"
  />

  <!-- 音频预览 -->
  <CaseAnalysisAudioPreviewDialog
    v-if="previewMaterial?.type === 4"
    v-model:open="showPreview"
    :oss-file-id="previewMaterial!.ossFileId!"
    :file-name="previewMaterial!.name"
  />

  <!-- 文本内容预览 -->
  <Dialog v-model:open="showTextPreview">
    <DialogContent class="max-w-2xl max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <FileTextIcon class="size-5 text-blue-500" />
          {{ previewMaterial?.name }}
        </DialogTitle>
      </DialogHeader>
      <div v-if="textLoading" class="flex justify-center py-8">
        <Loader2Icon class="size-6 animate-spin text-muted-foreground" />
      </div>
      <div v-else-if="textContent" class="text-sm leading-relaxed whitespace-pre-wrap">
        {{ textContent }}
      </div>
      <div v-else class="text-sm text-muted-foreground text-center py-8">
        暂无文本内容
      </div>
    </DialogContent>
  </Dialog>
</template>

<script lang="ts" setup>
import type { AnalysisResult } from '#shared/types/case'
import type { CaseDetailMaterialItem } from '~/composables/useCaseDetail'
import { CaseMaterialType } from '#shared/types/case'
import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import { FileTextIcon, Loader2Icon } from 'lucide-vue-next'

definePageMeta({
  title: "初始化分析",
  layout: "dashboard-layout",
})

const route = useRoute()
const router = useRouter()
const sessionId = computed(() => route.params.sessionId as string)

// 材料预览状态
const previewMaterial = ref<CaseDetailMaterialItem | null>(null)
const showPreview = ref(false)
const showTextPreview = ref(false)
const textContent = ref<string | null>(null)
const textLoading = ref(false)

// 材料数据
const materials = ref<CaseDetailMaterialItem[]>([])
const materialsLoading = ref(false)

async function loadMaterials(id: number) {
  if (id <= 0) return
  materialsLoading.value = true
  try {
    const data = await useApiFetch<CaseDetailMaterialItem[]>(`/api/v1/case/${id}/materials`)
    if (data) materials.value = data
  } finally {
    materialsLoading.value = false
  }
}

// 右侧面板查看模式
const rightPanelViewMode = ref<'dashboard' | 'detail'>('dashboard')

async function openMaterialPreview(material: CaseDetailMaterialItem) {
    // 移除当前焦点，避免 aria-hidden 警告
    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
    }
    previewMaterial.value = material
    if (material.type === CaseMaterialType.CASE_CONTENT) {
        showTextPreview.value = true
    textLoading.value = true
    textContent.value = null
    try {
      const data = await useApiFetch<{ content: string | null }>(
        `/api/v1/material/content/${material.id}`,
        { query: { detail: false } }
      )
      textContent.value = data?.content ?? null
    } finally {
      textLoading.value = false
    }
  } else {
    showPreview.value = true
  }
}

// 面板布局模式：选择阶段只显示左侧
const panelMode = ref<'left' | 'right' | 'both'>('left')

const {
  phase,
  caseId,
  selectedModules,
  moduleStates,
  activeModules,
  isLoading,
  interruptData,
  mergedResult,
  streamMessages,
  loadStatus,
  startAnalysis,
  resumeWorkflow,
  retryModule,
  activeIndex,
} = useInitAnalysis(sessionId)

// 已完成模块列表（用于补充分析时在 ModuleSelector 中禁用）
const completedModules = ref<string[]>([])

// 加载案件标题和已完成模块
const caseTitle = ref('')

watch(caseId, async (id) => {
  if (id <= 0) return
  // 不阻塞标题和状态加载，后台并行获取材料
  loadMaterials(id)
  const data = await useApiFetch<{ title: string }>(`/api/v1/case/${id}`)
  if (data?.title) caseTitle.value = data.title

  // 获取该案件已完成的模块
  const status = await useApiFetch<{ modules: Array<{ name: string; status: string }> }>(
    `/api/v1/case/init-analysis-status/${id}`,
  )
  if (status?.modules) {
    completedModules.value = status.modules
      .filter(m => m.status === 'complete')
      .map(m => m.name)
    // 补充分析时，预选未完成的模块（排除已完成的）
    if (phase.value === 'select' && completedModules.value.length > 0) {
      selectedModules.value = selectedModules.value.filter(
        name => !completedModules.value.includes(name),
      )
    }
  }
}, { immediate: true })

// 标题栏显示
const headerTitle = computed(() =>
  caseTitle.value ? `${caseTitle.value}` : '初始化分析',
)

// 分析开始（phase 离开 select）时自动展开右侧面板
watch(phase, (val) => {
  if (val !== 'select' && panelMode.value === 'left') {
    panelMode.value = 'both'
  }
})

// 从 mergedResult 转换为 AnalysisResult[] 供右侧面板显示
// mergedResult 合并了 DB 结果（刷新恢复）和流式结果
const completedResults = computed<AnalysisResult[]>(() => {
  const result = mergedResult.value
  if (!result || Object.keys(result).length === 0) return []
  return Object.entries(result)
    .filter(([_, content]) => !!content)
    .map(([moduleName, content]) => {
      const mod = INIT_ANALYSIS_MODULES.find(m => m.name === moduleName)
      return {
        nodeId: 0,
        moduleName,
        moduleTitle: mod?.title ?? moduleName,
        content: content as string,
        analyzedAt: new Date().toISOString(),
      }
    })
})

// 当结果列表变化时，确保 activeIndex 在有效范围内
watch(completedResults, (results) => {
  if (results.length > 0 && activeIndex.value >= results.length) {
    activeIndex.value = results.length - 1
  }
}, { immediate: true })

const goBack = () => {
  router.push({ name: "dashboard-cases" })
}

// 跨标签页同步：模块对话在其他标签完成时刷新已完成模块列表
useCrossTabListener('analysis:updated', (data) => {
  if (caseId.value > 0 && data.caseId === caseId.value) {
    loadStatus()
  }
})

onMounted(() => {
  loadStatus()
})
</script>
