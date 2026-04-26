<script setup lang="ts">
import InitAnalysisInsufficientPointsCard from '~/components/initAnalysis/InsufficientPointsCard.vue'
/**
 * 统一中断处理调度器
 *
 * 按 interruptData.type 分发到对应的中断处理 UI：
 * - insufficient_points → Dialog + InitAnalysisInsufficientPointsCard（立即实现）
 * - case_info_check → TODO: 复用 case/interrupt/CaseInfoCheckHandler
 * - basic_info_confirm → TODO: 复用 case/interrupt/BasicInfoConfirmHandler
 * - module_select → TODO: 复用 case/interrupt/ModuleSelectHandler
 *
 * 积分不足使用 InitAnalysisInsufficientPointsCard（含完整支付流程：
 * 会员套餐展示、积分购买、二维码支付），而非 case/interrupt/InsufficientPointsHandler
 * （旧系统简陋版本，仅文字提示）。
 */
defineProps<{
  interruptData: any
}>()

const emit = defineEmits<{
  resume: [data: any]
}>()
</script>

<template>
  <!-- content + overlay 都是 z-[70]，与小索/模块对话浮窗内中断 Dialog 保持一致。 -->
  <Dialog :open="!!interruptData" @update:open="() => {}">
    <DialogContent
      class="sm:max-w-2xl max-h-[95vh] overflow-y-auto p-0 z-[70]"
      overlay-class="z-[70]"
      :show-close-button="false"
      @pointer-down-outside.prevent
      @escape-key-down.prevent
      @open-auto-focus.prevent
    >
      <DialogHeader class="sr-only">
        <DialogTitle>操作确认</DialogTitle>
        <DialogDescription>请处理中断请求</DialogDescription>
      </DialogHeader>

      <!-- 积分不足 -->
      <InitAnalysisInsufficientPointsCard
        v-if="interruptData?.type === 'insufficient_points'"
        :is-member="interruptData.data?.isMember ?? false"
        :available-points="interruptData.data?.availablePoints"
        :required-points="interruptData.data?.requiredPoints"
        :reason="interruptData.data?.reason"
        @resume="emit('resume', { action: 'continue' })"
      />

      <!-- 其他中断类型预留 -->
      <!-- case_info_check: 复用 case/interrupt/CaseInfoCheckHandler -->
      <!-- basic_info_confirm: 复用 case/interrupt/BasicInfoConfirmHandler -->
      <!-- module_select: 复用 case/interrupt/ModuleSelectHandler -->
    </DialogContent>
  </Dialog>
</template>
