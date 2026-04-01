<script lang="ts" setup>
import type { ActiveView, MaterialItem } from '~/composables/useCaseDetail'
import { CaseMaterialType } from '#shared/types/case'
import { ArrowLeftIcon, FileTextIcon } from 'lucide-vue-next'
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

const { caseInfo, materials, analysisResults, refreshAnalysis, refreshCase } = useCaseDetail(caseId)

const pageTitle = computed(() => caseInfo.value?.title ?? '案件详情')

// --- 材料预览弹窗状态（复用 init-analysis 的模式） ---
const previewMaterial = ref<MaterialItem | null>(null)
const showPreview = ref(false)
const showTextPreview = ref(false)
const textContent = ref<string | null>(null)

async function openMaterialPreview(material: MaterialItem) {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
  previewMaterial.value = material
  if (material.type === CaseMaterialType.CASE_CONTENT) {
    showTextPreview.value = true
    textContent.value = caseInfo.value?.content ?? null
  } else {
    showPreview.value = true
  }
}

// --- 分析视图 ref ---
const analysisRef = ref<{ setActiveIndex: (index: number) => void }>()

// 移动端分析详情模式时隐藏页面 header（由 AnalysisResults 通过 useState 控制）
const hideDashboardHeader = useState('hideDashboardHeader', () => false)

// --- 导航 ---
function navigateToView(view: ActiveView) {
  activeView.value = view
}

function navigateToAnalysis(index: number) {
  activeView.value = 'analysis'
  nextTick(() => {
    analysisRef.value?.setActiveIndex(index)
  })
}
</script>

<template>
  <div class="flex flex-col" :style="{ height: hideDashboardHeader ? '100vh' : 'calc(100vh - 48px)' }">
    <!-- 头部 - 移动端分析详情模式时隐藏 -->
    <header
      class="h-12 shrink-0 border-b flex items-center px-4 gap-3"
      :class="{ 'hidden md:flex': hideDashboardHeader }"
    >
      <Button variant="ghost" size="icon" class="size-8 shrink-0" @click="navigateTo('/dashboard/cases')">
        <ArrowLeftIcon class="size-4" />
      </Button>
      <h1 class="text-sm font-medium truncate flex-1">{{ pageTitle }}</h1>
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
        <CaseDetailOverview v-if="activeView === 'overview'" :case-id="caseId" :analysis-results="analysisResults"
          @navigate-view="navigateToView" @preview-material="openMaterialPreview"
          @navigate-analysis="navigateToAnalysis" @updated="refreshCase" />
        <CaseDetailMaterials v-else-if="activeView === 'materials'" :materials="materials ?? []"
          @preview="openMaterialPreview" />
        <CaseDetailAnalysis v-else-if="activeView === 'analysis'" ref="analysisRef" :case-id="caseId" :results="analysisResults"
          v-model:active-index="analysisIndex" v-model:view-mode="analysisMode"
          @version-changed="refreshAnalysis" />
        <!-- 其他视图占位 -->
        <div v-else class="flex items-center justify-center h-full text-muted-foreground">
          当前视图：{{ activeView }}
        </div>

        <!-- 小索助手 -->
        <ClientOnly>
          <CaseDetailXiaosuo v-model="xiaosuoOpen" />
        </ClientOnly>
      </main>
    </div>

    <!-- 底部 Tab 栏 - 仅移动端，分析详情模式时隐藏 -->
    <div v-show="!hideDashboardHeader" class="md:hidden shrink-0">
      <CaseDetailBottomTabs v-model="activeView" />
    </div>
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
</template>
