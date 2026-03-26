<template>
  <div class="min-h-screen">
    <!-- 阶段一：模块选择 -->
    <InitAnalysisModuleSelector
      v-if="phase === 'select'"
      v-model="selectedModules"
      @start="startAnalysis"
      @skip="navigateTo(`/dashboard/cases/${caseId}`)"
    />

    <!-- 阶段二/三：Pipeline 进度 + 模块结果 -->
    <template v-else>
      <InitAnalysisPipelineProgress
        :modules="activeModules"
        :module-states="moduleStates"
      />

      <div class="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <!-- 积分不足中断卡片：没有模块启动时直接显示在顶部 -->
        <InitAnalysisInsufficientPointsCard
          v-if="interruptData && !interruptTargetModule"
          :is-member="interruptData.data?.isMember ?? false"
          :available-points="interruptData.data?.availablePoints"
          :required-points="interruptData.data?.requiredPoints"
          :reason="interruptData.data?.reason"
          @resume="resumeWorkflow"
        />

        <!-- 只渲染已启动（非 idle）的模块，并在当前执行模块后插入积分不足卡片 -->
        <template v-for="mod in activeModules" :key="mod.name">
          <InitAnalysisModuleResult
            :module="mod"
            :state="getModuleState(mod.name)"
            @retry="retryModule"
          />

          <InitAnalysisInsufficientPointsCard
            v-if="interruptData && mod.name === interruptTargetModule"
            :is-member="interruptData.data?.isMember ?? false"
            :available-points="interruptData.data?.availablePoints"
            :required-points="interruptData.data?.requiredPoints"
            :reason="interruptData.data?.reason"
            @resume="resumeWorkflow"
          />
        </template>

        <!-- 完成后操作 -->
        <div v-if="phase === 'complete'" class="flex justify-center pt-4">
          <Button size="lg" @click="navigateTo(`/dashboard/cases/${caseId}`)">
            进入案件详情
          </Button>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
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
  getModuleState,
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

const interruptTargetModule = computed<string | null>(() => {
  const modules = activeModules.value
  for (let i = modules.length - 1; i >= 0; i--) {
    const status = getModuleState(modules[i]!.name).status
    if (status === 'streaming' || status === 'interrupted') return modules[i]!.name
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
