<template>
  <div class="flex flex-col" style="height: calc(100vh - 48px)">
    <!-- 阶段一：模块选择 -->
    <InitAnalysisModuleSelector
      v-if="phase === 'select'"
      v-model="selectedModules"
      @start="startAnalysis"
      @skip="navigateTo(`/dashboard/cases/${caseId}`)"
    />

    <!-- 阶段二/三：Pipeline 进度 + 模块结果（带自动滚动） -->
    <template v-else>
      <InitAnalysisPipelineProgress
        :modules="activeModules"
        :module-states="moduleStates"
        class="shrink-0"
      />

      <div class="flex-1 min-h-0">
        <ClientOnly>
          <AiElementsConversation>
            <AiElementsConversationContent class="max-w-4xl mx-auto px-4 py-6 space-y-6">
              <!-- 积分不足中断卡片：没有模块启动时直接显示在顶部 -->
              <InitAnalysisInsufficientPointsCard
                v-if="interrupt && !interruptTargetModule"
                :is-member="interrupt.isMember ?? false"
                :available-points="interrupt.availablePoints"
                :required-points="interrupt.requiredPoints"
                :reason="interrupt.reason"
                @resume="resumeWorkflow"
              />

              <!-- 模块列表 -->
              <template v-for="mod in activeModules" :key="mod.name">
                <InitAnalysisModuleResult
                  :module="mod"
                  :state="getModuleState(mod.name)"
                  :messages="getModuleMessageList(mod.name)"
                  @retry="retryModule"
                />

                <!-- 积分不足中断卡片：紧跟在当前模块后面 -->
                <InitAnalysisInsufficientPointsCard
                  v-if="interrupt && mod.name === interruptTargetModule"
                  :is-member="interrupt.isMember ?? false"
                  :available-points="interrupt.availablePoints"
                  :required-points="interrupt.requiredPoints"
                  :reason="interrupt.reason"
                  @resume="resumeWorkflow"
                />
              </template>

              <!-- 完成后操作 -->
              <div v-if="phase === 'complete'" class="flex justify-center pt-4 pb-8">
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
  interrupt,
  currentModule,
  getModuleState,
  getModuleMessageList,
  loadStatus,
  startAnalysis,
  resumeWorkflow,
  retryModule,
} = useInitAnalysis(sessionId)

/** 中断卡片应插入在哪个模块之后 */
const interruptTargetModule = computed<string | null>(() => {
  const modules = activeModules.value
  for (let i = modules.length - 1; i >= 0; i--) {
    const status = getModuleState(modules[i]!.name).status
    if (status === 'streaming') return modules[i]!.name
  }
  for (let i = modules.length - 1; i >= 0; i--) {
    const status = getModuleState(modules[i]!.name).status
    if (status === 'complete' || status === 'failed') return modules[i]!.name
  }
  return null
})

onMounted(() => {
  loadStatus()
})
</script>
