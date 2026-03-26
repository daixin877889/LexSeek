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
        <!-- 模块结果列表 -->
        <InitAnalysisModuleResult
          v-for="mod in activeModules"
          :key="mod.name"
          :module="mod"
          :state="getModuleState(mod.name)"
          @retry="retryModule"
        />

        <!-- 积分不足中断 -->
        <InitAnalysisInsufficientPointsCard
          v-if="interruptData"
          :available-points="interruptData.data?.availablePoints"
          @resume="resumeWorkflow"
        />

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
const caseId = computed(() => Number(route.params.caseId))

const {
  phase,
  selectedModules,
  moduleStates,
  activeModules,
  interrupt,
  getModuleState,
  loadStatus,
  startAnalysis,
  resumeWorkflow,
  retryModule,
} = useInitAnalysis(caseId)

// LangGraph interrupt 数据：数组中第一个元素的 value 就是 interrupt() 传入的对象
const interruptData = computed(() => {
  const raw = interrupt.value
  if (!raw) return null
  // useStream 的 interrupt 格式: [{ value: { type, message, data }, ... }]
  const first = Array.isArray(raw) ? raw[0] : raw
  const val = first?.value ?? first
  if (val?.type === 'insufficient_points') return val
  return null
})

onMounted(() => {
  loadStatus()
})
</script>
