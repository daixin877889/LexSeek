<template>
  <div class="flex flex-col" style="height: calc(100vh - 48px)">
    <!-- 阶段一：模块选择 -->
    <InitAnalysisModuleSelector
      v-if="phase === 'select'"
      v-model="selectedModules"
      @start="startAnalysis"
      @skip="navigateTo(`/dashboard/cases/${caseId}`)"
    />

    <!-- 阶段二/三：分析进度 -->
    <template v-else>
      <InitAnalysisPipelineProgress
        :modules="activeModules"
        :module-states="moduleStates"
        class="shrink-0"
      />

      <div class="flex-1 min-h-0">
        <ClientOnly>
          <AiElementsConversation class="h-full">
            <AiElementsConversationContent class="max-w-4xl mx-auto px-4 py-6 space-y-6">
              <!-- 积分不足中断卡片 -->
              <InitAnalysisInsufficientPointsCard
                v-if="interruptData"
                :is-member="interruptData.data?.isMember ?? false"
                :available-points="interruptData.data?.availablePoints"
                :required-points="interruptData.data?.requiredPoints"
                :reason="interruptData.data?.reason"
                @resume="resumeWorkflow"
              />

              <!-- 按模块分组渲染 -->
              <template v-for="mod in activeModules" :key="mod.name">
                <InitAnalysisModuleResult
                  :module="mod"
                  :state="getModuleState(mod.name)"
                  :messages="getModuleMessages(mod.name)"
                  @retry="retryModule"
                />
              </template>

              <!-- 完成后操作 -->
              <div v-if="phase === 'complete'" class="flex justify-center py-8">
                <Button size="lg" @click="navigateTo(`/dashboard/cases/${caseId}`)">
                  进入案件详情
                </Button>
              </div>
            </AiElementsConversationContent>
            <AiElementsConversationScrollButton />
          </AiElementsConversation>

          <template #fallback>
            <div class="flex size-full items-center justify-center">
              <Loader2Icon class="size-6 animate-spin text-muted-foreground" />
            </div>
          </template>
        </ClientOnly>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { Loader2Icon } from 'lucide-vue-next'

definePageMeta({
  title: '初始化分析',
  layout: 'dashboard-layout',
})

const route = useRoute()
const sessionId = computed(() => route.params.sessionId as string)

const {
  phase,
  caseId,
  selectedModules,
  moduleStates,
  activeModules,
  isLoading,
  interrupt,
  getModuleState,
  getModuleMessages,
  loadStatus,
  startAnalysis,
  resumeWorkflow,
  retryModule,
} = useInitAnalysis(sessionId)

// LangGraph interrupt 数据
const interruptData = computed(() => {
  const raw = interrupt.value
  if (!raw) return null
  const first = Array.isArray(raw) ? raw[0] : raw
  const val = first?.value ?? first
  if (val?.type === 'insufficient_points') return val
  return null
})

onMounted(() => {
  loadStatus()
})
</script>
