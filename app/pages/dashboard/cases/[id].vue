<script lang="ts" setup>
import type { ActiveView, CaseDetailMaterialItem } from '~/composables/useCaseDetail'
import type { AnalysisResult } from '#shared/types/case'
import { VALID_MODULE_NAMES } from '#shared/types/initAnalysis'
import { CaseMaterialType } from '#shared/types/case'
import { ArrowLeftIcon, FileTextIcon, DownloadIcon } from 'lucide-vue-next'
import { VisuallyHidden } from 'reka-ui'
import AssistantDocumentTemplatePickerSheet from '~/components/assistant/document/DocumentTemplatePickerSheet.vue'
import CaseAnalysisModuleChat from '~/components/case/AnalysisModuleChat.vue'
import CaseAnalysisModuleChatBar from '~/components/case/AnalysisModuleChatBar.vue'
import CaseAnalysisAudioPreviewDialog from '~/components/caseAnalysis/AudioPreviewDialog.vue'
import CaseAnalysisDocPreviewDialog from '~/components/caseAnalysis/DocPreviewDialog.vue'
import CaseDetailAnalysis from '~/components/caseDetail/CaseDetailAnalysis.vue'
import CaseDetailBottomTabs from '~/components/caseDetail/CaseDetailBottomTabs.vue'
import CaseDetailContracts from '~/components/caseDetail/CaseDetailContracts.vue'
import CaseDetailDocuments from '~/components/caseDetail/CaseDetailDocuments.vue'
import CaseDetailMaterials from '~/components/caseDetail/CaseDetailMaterials.vue'
import CaseDetailMemory from '~/components/caseDetail/CaseDetailMemory.vue'
import CaseDetailOverview from '~/components/caseDetail/CaseDetailOverview.vue'
import CaseDetailSidebar from '~/components/caseDetail/CaseDetailSidebar.vue'
import CaseDetailXiaosuo from '~/components/caseDetail/CaseDetailXiaosuo.vue'
import CaseDetailCaseExportDialog from '~/components/caseDetail/CaseExportDialog.vue'
import IconXiaosuoIcon from '~/components/icon/XiaosuoIcon.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useCaseDetail } from '~/composables/useCaseDetail'
import { postCrossTabEvent } from '~/composables/useCrossTabEvents'
import { useCaseMainAgent, useCaseModuleAgent } from '~/composables/agents'

definePageMeta({
  title: '案件详情',
  layout: 'dashboard-layout',
})

const route = useRoute()
const router = useRouter()
const caseId = computed(() => Number(route.params.id))

// --- 路由 query 持久化状态 ---
const validViews: ActiveView[] = ['overview', 'materials', 'analysis', 'todos', 'documents', 'contracts', 'memory']
const initialView = validViews.includes(route.query.tab as ActiveView)
  ? (route.query.tab as ActiveView)
  : 'overview'

const activeView = ref<ActiveView>(initialView)
// URL ai 参数：moduleName 字符串（带白名单校验）
const rawAi = route.query.ai
const analysisModule = ref<string | null>(
  typeof rawAi === 'string' && VALID_MODULE_NAMES.includes(rawAi)
    ? rawAi
    : null,
)
const analysisMode = ref<'dashboard' | 'detail'>(route.query.am === 'detail' ? 'detail' : 'dashboard')
const xiaosuoOpen = ref(false)
const showExportDialog = ref(false)

// 统一同步所有状态到 query
watch([activeView, analysisModule, analysisMode], ([view, am, mode]) => {
  const query: Record<string, string> = {}
  if (view !== 'overview') query.tab = view
  if (view === 'analysis') {
    if (am) query.ai = am
    if (mode === 'detail') query.am = 'detail'
  }
  router.replace({ query })
})

// --- 模块对话管理（必须在 useCaseDetail 之前，因为 generatingModules 是依赖） ---
// 使用 let 变量打破 refreshAnalysis 与 moduleChatManager 的循环依赖
let _refreshAnalysis: (() => Promise<void>) | undefined
const moduleChatManager = useCaseModuleAgent(caseId, {
  onAnalysisSaved: () => {
    _refreshAnalysis?.()
    // 广播给其他标签页（init-analysis 页面 / 另一个案件详情 tab）
    postCrossTabEvent('analysis:updated', { caseId: caseId.value })
  },
})

// 小索浮窗：与 moduleChatManager 同样依赖 _refreshAnalysis（晚于 useCaseDetail 才赋值），
// 但因 xiaosuoChat.generatingModules 要在 useCaseDetail 时合并到本 tab UI 状态里，
// 必须提前到 useCaseDetail 之前声明。回调内通过 _refreshAnalysis?.() 兜底未赋值情况。
const xiaosuoChat = useCaseMainAgent(caseId, {
  onAnalysisSaved: () => {
    _refreshAnalysis?.()
    postCrossTabEvent('analysis:updated', { caseId: caseId.value })
  },
})

// 模块对话 + 小索两路"生成中"模块名合并（去重）。
// 小索调起 ask_*_expert 时模块名出现在 subThreadsMap 中（status='running' bucket）。
const allGeneratingModules = computed(() => {
  const fromManager = moduleChatManager.generatingModules.value ?? []
  const fromXiaosuo = xiaosuoChat.generatingModules.value ?? []
  return Array.from(new Set([...fromManager, ...fromXiaosuo]))
})

const {
  caseInfo,
  materials,
  analysisResults,
  analysisStatus,
  allModuleCards,
  showBatchButton,
  isInitAnalysisRunning,
  hasPendingInterrupt,
  refreshAnalysis,
  refreshCase,
  addMaterials,
  retryMaterial,
  isAddingMaterials,
  disabledOssFileIds,
  fileRecognitionStatus,
  getRecognitionStatus,
  deleteMaterials,
  selectedMaterialIds,
  isDeleting,
  isSelectMode,
  toggleSelectMode,
  drafts,
  refreshDrafts,
  toggleMaterialSelection,
} = useCaseDetail(caseId, {
  generatingModules: allGeneratingModules,
})
_refreshAnalysis = refreshAnalysis

const pageTitle = computed(() => caseInfo.value?.title ?? '案件详情')

const viewLabelMap: Record<ActiveView, string> = {
  overview: '概览',
  materials: '案件材料',
  analysis: '分析结果',
  todos: '待办事项',
  documents: '案件文书',
  contracts: '合同审查',
  memory: '案件记忆',
}

// --- 材料预览弹窗状态（复用 init-analysis 的模式） ---
const previewMaterial = ref<CaseDetailMaterialItem | null>(null)
const showPreview = ref(false)
const showTextPreview = ref(false)
const textContent = ref<string | null>(null)

async function openMaterialPreview(material: CaseDetailMaterialItem) {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
  previewMaterial.value = material
  if (material.type === CaseMaterialType.CASE_CONTENT) {
    showTextPreview.value = true
    textContent.value = null
    const res = await useApiFetch<{ content: string | null }>(`/api/v1/material/content/${material.id}`)
    textContent.value = res?.content ?? null
  } else {
    showPreview.value = true
  }
}

// 移动端分析详情模式时隐藏页面 header（由 AnalysisResults 通过 useState 控制）
const hideDashboardHeader = useState('hideDashboardHeader', () => false)

// --- 导航 ---
function navigateToView(view: ActiveView) {
  activeView.value = view
}

function navigateToSelectMode() {
  activeView.value = 'materials'
  nextTick(() => {
    if (!isSelectMode.value) toggleSelectMode()
  })
}

function navigateToAnalysis(moduleName: string) {
  analysisModule.value = moduleName
  analysisMode.value = 'detail'
  activeView.value = 'analysis'
}

async function handleModuleRegenerate(result: AnalysisResult) {
  const instance = moduleChatManager.getOrCreateInstance(result.moduleName, result.moduleTitle)
  // 工厂池化模式：getOrCreateInstance 同步返回 factory，需手动 init() 拉取 sessions
  await instance.init()
  moduleChatManager.expandModule(result.moduleName)
}

// --- 单个生成/重试/重新展开 ---
const generatingGuard = new Set<string>()

async function handleGenerateModule(moduleName: string, moduleTitle: string) {
  if (generatingGuard.has(moduleName)) return
  generatingGuard.add(moduleName)

  try {
    const card = allModuleCards.value.find(c => c.moduleName === moduleName)
    if (!card || card.locked || hasPendingInterrupt.value) return

    if (card.status === 'in_progress') {
      // 模块对话正在生成 → 仅重新展开窗口
      const existing = moduleChatManager.instances[moduleName]
      if (existing) moduleChatManager.expandModule(moduleName)
      return
    }

    // idle 或 failed → 创建 instance、立即展开窗口、后台触发自动消息
    // 注意：不能 await sendMessage —— 它要等到整轮 SSE 流结束才 resolve，
    // 期间 expandedModule 仍为 null，对话框不渲染（仅显示右下角状态条）。
    const instance = moduleChatManager.getOrCreateInstance(moduleName, moduleTitle)
    // 工厂池化模式：getOrCreateInstance 同步返回 factory，需手动 init() 后再发消息
    await instance.init()
    moduleChatManager.expandModule(moduleName)
    void instance.sendMessage(`请为本案件生成${moduleTitle}分析报告`)
      ?.catch(err => console.error('[handleGenerateModule] autoMessage failed', err))
  } finally {
    generatingGuard.delete(moduleName)
  }
}

// --- 批量生成（跳转到初始化分析页面） ---
function handleBatchGenerate() {
  navigateTo(`/dashboard/cases/init-analysis?caseId=${caseId.value}`)
}

// --- 打开历史批量分析会话（由 BatchAnalysisPopover 列表项点击触发） ---
function handleOpenInitSession(sessionId: string) {
  navigateTo(`/dashboard/cases/init-analysis/${sessionId}`)
}

// --- 前往处理中断 ---
function handleGoToInterrupt() {
  const sessionId = analysisStatus.value?.sessionId
  if (sessionId) {
    navigateTo(`/dashboard/cases/init-analysis/${sessionId}`)
  }
}

// --- 查看正在运行的工作流详情 ---
function handleGoToRunningWorkflow() {
  const sessionId = analysisStatus.value?.sessionId
  if (sessionId) {
    navigateTo(`/dashboard/cases/init-analysis/${sessionId}`)
  }
}

// idle 模块直达详情模式时自动降级为 dashboard
watch([analysisModule, analysisMode, allModuleCards], ([mod, mode, cards]) => {
  if (mode === 'detail' && mod) {
    const card = cards.find(c => c.moduleName === mod)
    if (card && card.status !== 'complete') {
      analysisMode.value = 'dashboard'
    }
  }
})

// 当前展开的模块实例（用于模板绑定，避免 undefined）
const expandedChatInstance = computed(() => {
  const name = moduleChatManager.expandedModule.value
  return name ? moduleChatManager.instances[name] : undefined
})

// 合并后的"生成中"模块名跨标签广播（init-analysis 页面、另一个案件详情 tab 同步）
watch(allGeneratingModules, (modules) => {
  if (caseId.value > 0) {
    postCrossTabEvent('module:generating', { caseId: caseId.value, modules })
  }
})

// --- 案件文书：Sheet + 创建流程 ---
const documentSheetOpen = ref(false)

function handleCreateDocument() {
  documentSheetOpen.value = true
}

async function handleTemplateSelect(templateId: number) {
  const result = await useApiFetch<{ draftId: number; sessionId: string }>(
    '/api/v1/assistant/document/drafts',
    { method: 'POST', body: { templateId, caseId: caseId.value } },
  )
  if (!result) return
  // activeView 当前值作为 returnTab（documents 或 overview）
  const returnTab = activeView.value === 'overview' ? 'overview' : 'documents'
  // 先跳转再关 Sheet：页面卸载时 Sheet 自然销毁，避免关闭动画与路由切换并发闪烁
  await navigateTo(
    `/dashboard/document/drafts/${result.draftId}`
    + `?from=case&caseId=${caseId.value}&returnTab=${returnTab}`,
  )
  documentSheetOpen.value = false
}

// 页面挂载：处理 xiaosuo focus query
// 注意：restoreActiveSessions 在阶段 7 已移除（工厂池化模式下，模块对话实例
// 由用户操作（点击"重试/重新生成"等）按需创建；切回页面时不再扫描后端 sessions 主动 instantiate）
onMounted(() => {
  handleXiaosuoFocusQuery()
})

// Task 18：支持 ?focus=xiaosuo&xiaosuoSessionId=xxx 自动展开浮窗 + 定位 session
function handleXiaosuoFocusQuery() {
  if (route.query.focus !== 'xiaosuo') return
  xiaosuoOpen.value = true  // 触发 CaseDetailXiaosuo 内 watch(isOpen) → init()

  const targetSid = typeof route.query.xiaosuoSessionId === 'string'
    ? route.query.xiaosuoSessionId
    : null
  if (!targetSid) return

  // sessions 初始为 []，init 完成后至少有 1 条；用此判断就绪时机
  // 就绪后检查目标 session 是否存在，存在则切换（不存在则保持 init 选的默认 session）
  const stopWatch = watch(
    xiaosuoChat.sessions,
    (sessions) => {
      if (sessions.length === 0) return  // init 尚未完成
      stopWatch()
      if (sessions.some(s => s.sessionId === targetSid)) {
        void xiaosuoChat.switchSession(targetSid)
      }
    },
  )
}
</script>

<template>
  <div class="flex flex-col relative" :style="{ height: hideDashboardHeader ? '100vh' : 'calc(100vh - 48px)' }">
    <!-- 头部 - 移动端分析详情模式时隐藏 -->
    <header
      class="h-12 shrink-0 border-b flex items-center px-4 gap-3"
      :class="{ 'hidden md:flex': hideDashboardHeader }"
    >
      <Button variant="ghost" size="icon" class="size-8 shrink-0" @click="navigateTo('/dashboard/cases')">
        <ArrowLeftIcon class="size-4" />
      </Button>

      <div class="flex-1 min-w-0">
        <h1 class="text-sm font-medium truncate">
          {{ pageTitle }}
          <span v-if="activeView !== 'overview'" class="text-muted-foreground ml-1">
            · {{ viewLabelMap[activeView] }}
          </span>
        </h1>
      </div>

      <Button variant="ghost" size="icon" class="size-8 shrink-0" title="导出文档"
        :disabled="!analysisResults || analysisResults.length === 0"
        @click="showExportDialog = true">
        <DownloadIcon class="size-4" />
      </Button>
      <Button variant="ghost" size="icon" class="size-8 shrink-0 md:hidden" @click="xiaosuoOpen = true">
        <ClientOnly><IconXiaosuoIcon class="size-4" /></ClientOnly>
      </Button>
    </header>

    <!-- 主体 -->
    <div class="flex flex-1 min-h-0">
      <!-- 侧边栏 - 仅桌面端 -->
      <aside class="hidden md:block w-14 lg:w-50 shrink-0 border-r bg-muted/30 transition-all">
        <CaseDetailSidebar v-model="activeView" />
      </aside>

      <!-- 内容区 -->
      <main class="flex-1 min-w-0 overflow-hidden relative">
        <Transition name="page-fade" mode="out-in">
          <CaseDetailOverview v-if="activeView === 'overview'" :key="'overview'" :case-id="caseId" :analysis-results="analysisResults"
            :module-cards="allModuleCards"
            :show-batch-button="showBatchButton"
            :has-pending-interrupt="hasPendingInterrupt"
            :is-analysis-running="isInitAnalysisRunning"
            :materials="materials ?? []"
            :disabled-oss-file-ids="disabledOssFileIds"
            :is-adding-materials="isAddingMaterials"
            :file-recognition-status="fileRecognitionStatus"
            :get-recognition-status="getRecognitionStatus"
            :drafts="drafts"
            @navigate-view="navigateToView" @preview-material="openMaterialPreview"
            @navigate-analysis="navigateToAnalysis" @updated="refreshCase"
            @add-materials="addMaterials"
            @delete-materials="deleteMaterials"
            @retry-material="retryMaterial"
            @navigate-to-select-mode="navigateToSelectMode"
            @generate-module="handleGenerateModule"
            @batch-generate="handleBatchGenerate"
            @open-init-session="handleOpenInitSession"
            @go-to-interrupt="handleGoToInterrupt"
            @go-to-running-workflow="handleGoToRunningWorkflow"
            @create-document="handleCreateDocument"
            @refresh-drafts="refreshDrafts" />
          <CaseDetailMaterials v-else-if="activeView === 'materials'" :key="'materials'" :materials="materials ?? []"
            :disabled-oss-file-ids="disabledOssFileIds"
            :is-adding="isAddingMaterials"
            :is-deleting="isDeleting"
            :is-select-mode="isSelectMode"
            :selected-material-ids="selectedMaterialIds"
            :file-recognition-status="fileRecognitionStatus"
            :get-recognition-status="getRecognitionStatus"
            @preview="openMaterialPreview"
            @add-materials="addMaterials"
            @retry-material="retryMaterial"
            @delete-materials="deleteMaterials"
            @toggle-select-mode="toggleSelectMode"
            @toggle-selection="toggleMaterialSelection" />
          <CaseDetailAnalysis v-else-if="activeView === 'analysis'" :key="'analysis'" :case-id="caseId" :results="analysisResults"
            :module-cards="allModuleCards"
            :show-batch-button="showBatchButton"
            :has-pending-interrupt="hasPendingInterrupt"
            :is-analysis-running="isInitAnalysisRunning"
            v-model:active-module="analysisModule" v-model:view-mode="analysisMode"
            @version-changed="refreshAnalysis"
            @regenerate="handleModuleRegenerate"
            @generate-module="handleGenerateModule"
            @batch-generate="handleBatchGenerate"
            @open-init-session="handleOpenInitSession"
            @go-to-interrupt="handleGoToInterrupt"
            @go-to-running-workflow="handleGoToRunningWorkflow" />
          <CaseDetailDocuments
            v-else-if="activeView === 'documents'"
            :key="'documents'"
            :case-id="caseId"
            :drafts="drafts"
            @create-document="handleCreateDocument"
            @refresh="refreshDrafts"
          />
          <CaseDetailContracts v-else-if="activeView === 'contracts'" :key="'contracts'" :case-id="caseId" />
          <CaseDetailMemory v-else-if="activeView === 'memory'" :key="'memory'" :case-id="caseId" />
          <!-- 其他视图占位 -->
          <div v-else :key="'placeholder'" class="flex items-center justify-center h-full text-muted-foreground">
            当前视图：{{ activeView }}
          </div>
        </Transition>
      </main>
    </div>

    <!-- 底部 Tab 栏 - 仅移动端，分析详情模式时隐藏 -->
    <div v-show="!hideDashboardHeader" class="md:hidden shrink-0">
      <CaseDetailBottomTabs v-model="activeView" />
    </div>

    <!-- 模块对话悬浮窗 -->
    <ClientOnly>
      <CaseAnalysisModuleChat
        v-if="expandedChatInstance"
        v-model="expandedChatInstance.isExpanded.value"
        :case-id="caseId"
        :chat-instance="expandedChatInstance"
      />
    </ClientOnly>

    <!-- 模块对话最小化状态条 -->
    <ClientOnly>
      <CaseAnalysisModuleChatBar
        :modules="moduleChatManager.activeModules.value.filter(m => !m.isExpanded.value)"
        @expand="moduleChatManager.expandModule"
        @close="moduleChatManager.hideModule"
      />
    </ClientOnly>

    <!-- 小索助手 - 提升到此层级以覆盖 header -->
    <!-- on-attach-files-to-case：把小索输入框上传的附件入"案件材料"，
         让 caseProcessMaterialMiddleware 能扫到并喂给 AI；同时立即刷新材料列表 -->
    <ClientOnly>
      <CaseDetailXiaosuo
        v-model="xiaosuoOpen"
        :xiaosuo-chat="xiaosuoChat"
        :on-attach-files-to-case="addMaterials"
      />
    </ClientOnly>
  </div>

  <!-- 文档/图片预览弹窗 -->
  <CaseAnalysisDocPreviewDialog
    v-if="previewMaterial?.type === CaseMaterialType.DOCUMENT || previewMaterial?.type === CaseMaterialType.IMAGE"
    v-model:open="showPreview" :oss-file-id="previewMaterial!.ossFileId!" :file-name="previewMaterial!.name"
    :file-type="previewMaterial!.fileType || 'document'" />

  <!-- 音频预览弹窗 -->
  <CaseAnalysisAudioPreviewDialog v-if="previewMaterial?.type === CaseMaterialType.AUDIO" v-model:open="showPreview"
    :oss-file-id="previewMaterial!.ossFileId!" :file-name="previewMaterial!.name" />

  <!-- 文本内容预览弹窗 -->
  <Dialog v-model:open="showTextPreview">
    <DialogContent class="w-full max-h-[80vh] md:min-w-[70vw] flex flex-col">
      <DialogHeader class="shrink-0">
        <DialogTitle class="flex items-center gap-2">
          <FileTextIcon class="size-5 text-blue-500" />
          {{ previewMaterial?.name }}
        </DialogTitle>
        <VisuallyHidden><DialogDescription>文本内容预览</DialogDescription></VisuallyHidden>
      </DialogHeader>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div v-if="textContent" class="text-sm leading-relaxed whitespace-pre-wrap">
          {{ textContent }}
        </div>
        <div v-else class="text-sm text-muted-foreground text-center py-8">
          暂无文本内容
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <!-- 导出文档弹窗 -->
  <ClientOnly>
    <CaseDetailCaseExportDialog
      v-model:open="showExportDialog"
      :title="pageTitle"
      :results="analysisResults ?? []"
    />
  </ClientOnly>

  <!-- 案件文书：模板选择 Sheet（documents Tab + overview 板块共享） -->
  <AssistantDocumentTemplatePickerSheet
    v-if="documentSheetOpen"
    v-model:open="documentSheetOpen"
    @select="handleTemplateSelect"
  />
</template>

<style scoped>
.page-fade-enter-active,
.page-fade-leave-active {
  transition: all 0.2s ease-out;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateX(10px);
}

.page-fade-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}
</style>
