<script lang="ts" setup>
import type { ActiveView } from '~/composables/useCaseDetail'
import { ArrowLeftIcon, BotIcon } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
})

const route = useRoute()
const caseId = computed(() => Number(route.params.id))

const activeView = ref<ActiveView>('overview')
const selectedMaterialId = ref<number | null>(null)
const xiaosuoOpen = ref(false)

const { caseInfo, materials, analysisResults } = useCaseDetail(caseId)

const pageTitle = computed(() => caseInfo.value?.title ?? '案件详情')

function navigateToView(view: ActiveView) {
  activeView.value = view
}

function navigateToMaterial(materialId: number) {
  activeView.value = 'materials'
  selectedMaterialId.value = materialId
}
</script>

<template>
  <div class="flex flex-col h-full">
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
      <aside class="hidden md:block w-56 shrink-0 border-r bg-muted/30">
        <CaseDetailSidebar v-model="activeView" />
      </aside>

      <!-- 内容区 -->
      <main class="flex-1 min-w-0 overflow-hidden relative">
        <CaseDetailOverview
          v-if="activeView === 'overview'"
          :case-id="caseId"
          :analysis-results="analysisResults"
          @navigate-view="navigateToView"
        />
        <CaseDetailMaterials
          v-else-if="activeView === 'materials'"
          :materials="materials ?? []"
          v-model:selected-id="selectedMaterialId"
        />
        <CaseDetailAnalysis
          v-else-if="activeView === 'analysis'"
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
</template>
