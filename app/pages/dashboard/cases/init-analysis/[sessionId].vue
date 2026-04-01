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
        <!-- 仪表盘模式：可滚动，显示全部概况 -->
        <div v-show="rightPanelViewMode === 'dashboard'" class="flex-1 overflow-y-auto">
          <div class="flex flex-col">
            <!-- 案件信息卡片 -->
            <InitAnalysisCaseInfoCard v-if="caseId > 0" :case-id="caseId" />

            <Separator class="opacity-50" />

            <!-- 案件材料列表 -->
            <InitAnalysisMaterialList
              v-if="caseId > 0"
              ref="materialListRef"
              :case-id="caseId"
              @preview="openMaterialPreview"
            />

            <Separator class="opacity-50" />

            <!-- 分析结果列表（仅当分析开始或有结果时显示） -->
            <CaseAnalysisResults
              v-if="phase !== 'select'"
              :results="completedResults"
              v-model:active-index="activeIndex"
              v-model:view-mode="rightPanelViewMode"
              :is-analyzing="phase === 'running'"
              empty-title="分析结果处理中"
              empty-description="AI 正在读取案件材料并生成分析建议，请稍等..."
            />
          </div>
        </div>

        <!-- 详情模式：占据全屏，进行沉浸式阅读 -->
        <div v-if="rightPanelViewMode === 'detail'" class="flex-1 overflow-hidden">
          <CaseAnalysisResults
            :results="completedResults"
            v-model:active-index="activeIndex"
            v-model:view-mode="rightPanelViewMode"
            :is-analyzing="phase === 'running'"
          />
        </div>
      </div>
    </template>
  </AiChat>

  <!-- 积分不足覆盖层 -->
  <Dialog :open="!!interruptData" @update:open="() => {}">
    <DialogContent class="sm:max-w-2xl max-h-[95vh] overflow-y-auto p-0" :show-close-button="false" @pointer-down-outside.prevent @escape-key-down.prevent @open-auto-focus.prevent>
      <DialogHeader class="sr-only">
        <DialogTitle>积分不足</DialogTitle>
        <DialogDescription>请购买积分后继续分析</DialogDescription>
      </DialogHeader>
      <InitAnalysisInsufficientPointsCard
        v-if="interruptData"
        :is-member="interruptData.data?.isMember ?? false"
        :available-points="interruptData.data?.availablePoints"
        :required-points="interruptData.data?.requiredPoints"
        :reason="interruptData.data?.reason"
        @resume="resumeWorkflow"
      />
    </DialogContent>
  </Dialog>

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
import { CaseMaterialType } from '#shared/types/case'
import { FileTextIcon, Loader2Icon } from 'lucide-vue-next'

definePageMeta({
  title: "初始化分析",
  layout: "dashboard-layout",
})

const route = useRoute()
const router = useRouter()
const sessionId = computed(() => route.params.sessionId as string)

// 材料预览状态
interface MaterialItem {
  id: number
  name: string
  type: number
  typeText: string
  ossFileId: number | null
  isEncrypted: boolean
  status: number
  summary: string | null
  fileName: string | null
  fileSize: number | null
  fileType: string | null
}

const materialListRef = ref()
const previewMaterial = ref<MaterialItem | null>(null)
const showPreview = ref(false)
const showTextPreview = ref(false)
const textContent = ref<string | null>(null)
const textLoading = ref(false)

// 右侧面板查看模式
const rightPanelViewMode = ref<'dashboard' | 'detail'>('dashboard')

async function openMaterialPreview(material: MaterialItem) {
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
  interrupt,
  values,
  mergedResult,
  streamMessages,
  loadStatus,
  startAnalysis,
  resumeWorkflow,
  retryModule,
  activeIndex,
} = useInitAnalysis(sessionId)

// 案件标题
const caseTitle = ref('')

// 加载案件标题
watch(caseId, async (id) => {
  if (id <= 0) return
  const data = await useApiFetch<{ title: string }>(`/api/v1/case/${id}`)
  if (data?.title) caseTitle.value = data.title
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
      const mod = activeModules.value.find(m => m.name === moduleName)
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

// LangGraph interrupt 数据
const interruptData = computed(() => {
  const raw = interrupt.value
  if (!raw) return null
  const first = Array.isArray(raw) ? raw[0] : raw
  const val = first?.value ?? first
  if (val?.type === "insufficient_points") return val
  return null
})

const goBack = () => {
  router.push({ name: "dashboard-cases" })
}

onMounted(() => {
  loadStatus()
})
</script>
