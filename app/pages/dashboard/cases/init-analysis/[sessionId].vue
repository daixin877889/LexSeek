<template>
  <AiChat
    title="初始化分析"
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
      <div class="h-full overflow-y-auto">
        <!-- 案件信息卡片 -->
        <InitAnalysisCaseInfoCard v-if="caseId > 0" :case-id="caseId" />

        <!-- 分析结果（从 mergedResult 实时获取，合并 DB 和流式结果） -->
        <div v-if="completedResults.length > 0" class="p-4 space-y-3">
          <h3 class="text-sm font-medium text-muted-foreground">分析结果</h3>
          <CaseAnalysisResults
            :results="completedResults"
            v-model:active-index="activeIndex"
            :is-analyzing="phase === 'running'"
          />
        </div>
      </div>
    </template>
  </AiChat>

  <!-- 积分不足覆盖层 -->
  <Dialog :open="!!interruptData" @update:open="() => {}">
    <DialogContent class="sm:max-w-2xl" :show-close="false" @pointer-down-outside.prevent @escape-key-down.prevent @open-auto-focus.prevent>
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
</template>

<script lang="ts" setup>
import type { AnalysisResult } from '#shared/types/case'

definePageMeta({
  title: "初始化分析",
  layout: "dashboard-layout",
})

const route = useRoute()
const router = useRouter()
const sessionId = computed(() => route.params.sessionId as string)

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
