<template>
  <AiChat
    title="初始化分析"
    :messages="streamMessages"
    :loading="isLoading"
    :show-prompt="false"
    :show-task-queue="false"
    class="h-full"
    @back="goBack"
  >
    <template #message-list="{ messages: parsedMessages, loading: msgLoading }">
      <!-- 固定状态栏 -->
      <InitAnalysisPipelineProgress
        v-if="phase !== 'select'"
        :modules="activeModules"
        :module-states="moduleStates"
        class="sticky top-0 z-10 bg-background border-b"
      />

      <!-- 阶段一：模块选择 -->
      <div v-if="phase === 'select'" class="p-4">
        <InitAnalysisModuleSelector
          v-model="selectedModules"
          @start="startAnalysis"
          @skip="navigateTo(`/dashboard/cases/${caseId}`)"
        />
      </div>

      <!-- 阶段二/三：AiChat 默认消息渲染 + 额外内容 -->
      <template v-else>
        <!-- 积分不足中断卡片 -->
        <InitAnalysisInsufficientPointsCard
          v-if="interruptData"
          class="mx-4 mt-4"
          :is-member="interruptData.data?.isMember ?? false"
          :available-points="interruptData.data?.availablePoints"
          :required-points="interruptData.data?.requiredPoints"
          :reason="interruptData.data?.reason"
          @resume="resumeWorkflow"
        />

        <!-- 使用 AiChat 默认的消息列表渲染 -->
        <AiMessageList :messages="parsedMessages" :loading="msgLoading" />

        <!-- 完成后操作 -->
        <div v-if="phase === 'complete'" class="flex justify-center py-8">
          <Button size="lg" @click="navigateTo(`/dashboard/cases/${caseId}`)">
            进入案件详情
          </Button>
        </div>
      </template>
    </template>

    <template #right-panel>
      <!-- 案件信息卡片 -->
      <InitAnalysisCaseInfoCard v-if="caseId > 0" :case-id="caseId" />

      <!-- 分析结果（从 values.result 实时获取） -->
      <div v-if="completedResults.length > 0" class="p-4 space-y-3">
        <h3 class="text-sm font-medium text-muted-foreground">分析结果</h3>
        <CaseAnalysisResults :results="completedResults" />
      </div>
    </template>
  </AiChat>
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
  streamMessages,
  loadStatus,
  startAnalysis,
  resumeWorkflow,
  retryModule,
} = useInitAnalysis(sessionId)

// 从 values.result 转换为 AnalysisResult[] 供右侧面板显示
const completedResults = computed<AnalysisResult[]>(() => {
  const result = values.value?.result
  if (!result) return []
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
