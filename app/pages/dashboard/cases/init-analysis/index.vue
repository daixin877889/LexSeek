<template>
  <div class="flex flex-col items-center justify-center h-screen gap-4">
    <template v-if="error">
      <div class="text-destructive flex items-center gap-2">
        <AlertCircleIcon class="size-5" />
        <span class="text-sm">{{ error }}</span>
      </div>
      <Button variant="outline" size="sm" @click="goBack">返回案件详情</Button>
    </template>
    <template v-else>
      <Loader2Icon class="size-6 animate-spin text-muted-foreground" />
      <span class="text-sm text-muted-foreground">正在准备分析环境...</span>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { Loader2Icon, AlertCircleIcon } from 'lucide-vue-next'

definePageMeta({
  title: '初始化分析',
  layout: 'dashboard-layout',
})

const route = useRoute()
const caseId = route.query.caseId ? Number(route.query.caseId) : null
const error = ref<string | null>(null)

function goBack() {
  if (caseId) {
    navigateTo(`/dashboard/cases/${caseId}`, { replace: true })
  } else {
    navigateTo('/dashboard/cases', { replace: true })
  }
}

async function createSessionAndNavigate() {
  if (!caseId) {
    error.value = '缺少案件参数'
    setTimeout(() => navigateTo('/dashboard/cases', { replace: true }), 1500)
    return
  }

  // 超时控制（10 秒）
  const timeoutId = setTimeout(() => {
    if (!error.value) {
      error.value = '创建分析会话超时，请稍后重试'
    }
  }, 10000)

  try {
    const result = await useApiFetch<{ sessionId: string }>('/api/v1/case/analysis/init-session', {
      method: 'POST',
      body: { caseId },
    })
    clearTimeout(timeoutId)
    if (result?.sessionId) {
      await navigateTo(`/dashboard/cases/init-analysis/${result.sessionId}`, { replace: true })
    } else {
      error.value = '创建分析会话失败'
    }
  } catch (e: any) {
    clearTimeout(timeoutId)
    error.value = e?.message || '创建分析会话失败'
  }
}

onMounted(() => {
  createSessionAndNavigate()
})
</script>
