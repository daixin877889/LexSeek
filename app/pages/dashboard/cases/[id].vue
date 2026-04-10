<script lang="ts" setup>
import type { ActiveView, CaseDetailMaterialItem } from '~/composables/useCaseDetail'
import type { AnalysisResult } from '#shared/types/case'
import { CaseMaterialType } from '#shared/types/case'
import { ArrowLeftIcon, FileTextIcon, DownloadIcon } from 'lucide-vue-next'
import { VisuallyHidden } from 'reka-ui'
import xiaosuoIcon from '~/assets/icon/xiaosuo.svg'

definePageMeta({
  title: '案件详情',
  layout: 'dashboard-layout',
})

const route = useRoute()
const router = useRouter()
const caseId = computed(() => Number(route.params.id))

// --- 路由 query 持久化状态 ---
const validViews: ActiveView[] = ['overview', 'materials', 'analysis', 'todos', 'documents']
const initialView = validViews.includes(route.query.tab as ActiveView)
  ? (route.query.tab as ActiveView)
  : 'overview'

const activeView = ref<ActiveView>(initialView)
const analysisIndex = ref(route.query.ai ? Number(route.query.ai) : 0)
const analysisMode = ref<'dashboard' | 'detail'>(route.query.am === 'detail' ? 'detail' : 'dashboard')
const xiaosuoOpen = ref(false)
const showExportDialog = ref(false)

// 统一同步所有状态到 query
watch([activeView, analysisIndex, analysisMode], ([view, ai, am]) => {
  const query: Record<string, string> = {}
  if (view !== 'overview') query.tab = view
  if (view === 'analysis') {
    if (ai > 0) query.ai = String(ai)
    if (am === 'detail') query.am = 'detail'
  }
  router.replace({ query })
})

const {
  caseInfo,
  materials,
  analysisResults,
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
  toggleMaterialSelection,
} = useCaseDetail(caseId)

const pageTitle = computed(() => caseInfo.value?.title ?? '案件详情')

const viewLabelMap: Record<ActiveView, string> = {
  overview: '概览',
  materials: '案件材料',
  analysis: '分析结果',
  todos: '待办事项',
  documents: '文书生成',
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

function navigateToAnalysis(index: number) {
  analysisIndex.value = index
  analysisMode.value = 'detail'
  activeView.value = 'analysis'
}

// --- 模块对话管理 ---
const moduleChatManager = useModuleChatManager(caseId, { onAnalysisSaved: refreshAnalysis })

// --- 小索对话管理 ---
const xiaosuoChat = useXiaosuoChat(caseId)

async function handleModuleRegenerate(result: AnalysisResult) {
  await moduleChatManager.getOrCreateInstance(result.moduleName, result.moduleTitle)
  moduleChatManager.expandModule(result.moduleName)
}

// 当前展开的模块实例（用于模板绑定，避免 undefined）
const expandedChatInstance = computed(() => {
  const name = moduleChatManager.expandedModule.value
  return name ? moduleChatManager.instances[name] : undefined
})

// 页面刷新后恢复活跃 session
onMounted(() => {
  moduleChatManager.restoreActiveSessions()
})
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
        <ClientOnly><img :src="xiaosuoIcon" class="size-4" alt="小索" /></ClientOnly>
      </Button>
    </header>

    <!-- 主体 -->
    <div class="flex flex-1 min-h-0">
      <!-- 侧边栏 - 仅桌面端 -->
      <aside class="hidden md:block w-50 shrink-0 border-r bg-muted/30">
        <CaseDetailSidebar v-model="activeView" />
      </aside>

      <!-- 内容区 -->
      <main class="flex-1 min-w-0 overflow-hidden relative">
        <Transition name="page-fade" mode="out-in">
          <CaseDetailOverview v-if="activeView === 'overview'" :key="'overview'" :case-id="caseId" :analysis-results="analysisResults"
            :materials="materials ?? []"
            :disabled-oss-file-ids="disabledOssFileIds"
            :is-adding-materials="isAddingMaterials"
            :file-recognition-status="fileRecognitionStatus"
            :get-recognition-status="getRecognitionStatus"
            @navigate-view="navigateToView" @preview-material="openMaterialPreview"
            @navigate-analysis="navigateToAnalysis" @updated="refreshCase"
            @add-materials="addMaterials"
            @delete-materials="deleteMaterials"
            @retry-material="retryMaterial"
            @navigate-to-select-mode="navigateToSelectMode" />
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
            v-model:active-index="analysisIndex" v-model:view-mode="analysisMode"
            @version-changed="refreshAnalysis"
            @regenerate="handleModuleRegenerate" />
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
    <ClientOnly>
      <CaseDetailXiaosuo v-model="xiaosuoOpen" :xiaosuo-chat="xiaosuoChat" />
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
    <DialogContent class="max-w-2xl max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <FileTextIcon class="size-5 text-blue-500" />
          {{ previewMaterial?.name }}
        </DialogTitle>
        <VisuallyHidden><DialogDescription>文本内容预览</DialogDescription></VisuallyHidden>
      </DialogHeader>
      <div v-if="textContent" class="text-sm leading-relaxed whitespace-pre-wrap">
        {{ textContent }}
      </div>
      <div v-else class="text-sm text-muted-foreground text-center py-8">
        暂无文本内容
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
