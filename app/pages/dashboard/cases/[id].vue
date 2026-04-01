<script lang="ts" setup>
import type { ActiveView, MaterialItem } from '~/composables/useCaseDetail'
import { CaseMaterialType } from '#shared/types/case'
import { ArrowLeftIcon, BotIcon, FileTextIcon, Loader2Icon } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard-layout',
})

const route = useRoute()
const caseId = computed(() => Number(route.params.id))

const activeView = ref<ActiveView>('overview')
const selectedMaterialId = ref<number | null>(null)
const xiaosuoOpen = ref(false)

const { caseInfo, materials, analysisResults } = useCaseDetail(caseId)

const pageTitle = computed(() => caseInfo.value?.title ?? '案件详情')

// --- 材料预览弹窗状态（复用 init-analysis 的模式） ---
const previewMaterial = ref<MaterialItem | null>(null)
const showPreview = ref(false)
const showTextPreview = ref(false)
const textContent = ref<string | null>(null)
const textLoading = ref(false)

async function openMaterialPreview(material: MaterialItem) {
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

// --- 分析视图 ref ---
const analysisRef = ref<{ setActiveIndex: (index: number) => void }>()

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
  <div class="flex flex-col" style="height: calc(100vh - 48px)">
    <!-- 头部 -->
    <header class="h-12 shrink-0 border-b flex items-center px-4 gap-3">
      <Button variant="ghost" size="icon" class="size-8 shrink-0" @click="navigateTo('/dashboard/cases')">
        <ArrowLeftIcon class="size-4" />
      </Button>
      <h1 class="text-sm font-medium truncate flex-1">{{ pageTitle }}</h1>
      <Button variant="ghost" size="icon" class="size-8 shrink-0 md:hidden" @click="xiaosuoOpen = true">
        <BotIcon class="size-4" />
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
        <CaseDetailOverview
          v-if="activeView === 'overview'"
          :case-id="caseId"
          :analysis-results="analysisResults"
          @navigate-view="navigateToView"
          @preview-material="openMaterialPreview"
          @navigate-analysis="navigateToAnalysis"
        />
        <CaseDetailMaterials
          v-else-if="activeView === 'materials'"
          :materials="materials ?? []"
          v-model:selected-id="selectedMaterialId"
          @preview="openMaterialPreview"
        />
        <CaseDetailAnalysis
          v-else-if="activeView === 'analysis'"
          ref="analysisRef"
          :results="analysisResults"
        />
        <!-- 其他视图占位 -->
        <div v-else class="flex items-center justify-center h-full text-muted-foreground">
          当前视图：{{ activeView }}
        </div>

        <!-- 小索助手 -->
        <CaseDetailXiaosuo v-model="xiaosuoOpen" />
      </main>
    </div>

    <!-- 底部 Tab 栏 - 仅移动端 -->
    <div class="md:hidden shrink-0">
      <CaseDetailBottomTabs v-model="activeView" />
    </div>
  </div>

  <!-- 文档/图片预览弹窗 -->
  <CaseAnalysisDocPreviewDialog
    v-if="previewMaterial?.type === CaseMaterialType.DOCUMENT || previewMaterial?.type === CaseMaterialType.IMAGE"
    v-model:open="showPreview"
    :oss-file-id="previewMaterial!.ossFileId!"
    :file-name="previewMaterial!.name"
    :file-type="previewMaterial!.fileType || 'document'"
  />

  <!-- 音频预览弹窗 -->
  <CaseAnalysisAudioPreviewDialog
    v-if="previewMaterial?.type === CaseMaterialType.AUDIO"
    v-model:open="showPreview"
    :oss-file-id="previewMaterial!.ossFileId!"
    :file-name="previewMaterial!.name"
  />

  <!-- 文本内容预览弹窗 -->
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
