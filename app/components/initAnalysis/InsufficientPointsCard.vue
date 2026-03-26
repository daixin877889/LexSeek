<template>
  <div class="rounded-xl border bg-card p-6 space-y-4">
    <div class="flex items-center gap-3">
      <div class="rounded-full bg-amber-500/10 p-2">
        <AlertTriangleIcon class="size-5 text-amber-500" />
      </div>
      <h3 class="text-base font-semibold">积分不足</h3>
    </div>

    <Alert>
      <AlertDescription>
        <p>积分不足，无法继续执行分析。</p>
        <p v-if="availablePoints !== undefined" class="mt-1 text-sm text-muted-foreground">
          当前可用积分：{{ availablePoints }}
        </p>
      </AlertDescription>
    </Alert>

    <div class="flex flex-wrap gap-3">
      <Button variant="outline" @click="navigateTo('/membership')">
        升级会员
      </Button>
      <Button variant="outline" @click="navigateTo('/dashboard/points')">
        购买积分
      </Button>
      <Button :disabled="isResuming" @click="handleResume">
        <Loader2Icon v-if="isResuming" class="size-4 mr-2 animate-spin" />
        已充值，继续分析
      </Button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { AlertTriangleIcon, Loader2Icon } from 'lucide-vue-next'

defineProps<{
  availablePoints?: number
}>()

const emit = defineEmits<{
  resume: []
}>()

const isResuming = ref(false)

function handleResume() {
  isResuming.value = true
  emit('resume')
  // 超时重置，防止 resume 失败后按钮永久 loading
  setTimeout(() => {
    isResuming.value = false
  }, 15000)
}
</script>
