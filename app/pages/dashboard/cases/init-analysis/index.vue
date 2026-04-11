<template>
  <div class="flex items-center justify-center h-screen">
    <Loader2Icon class="size-6 animate-spin text-muted-foreground" />
  </div>
</template>

<script lang="ts" setup>
import { Loader2Icon } from 'lucide-vue-next'

definePageMeta({
  title: '初始化分析',
  layout: 'dashboard-layout',
})

const route = useRoute()
const caseId = route.query.caseId ? Number(route.query.caseId) : null

if (!caseId) {
  await navigateTo('/dashboard/cases', { replace: true })
} else {
  // 创建新 type=2 session 用于补充分析
  const result = await useApiFetch<{ sessionId: string }>('/api/v1/case/analysis/init-session', {
    method: 'POST',
    body: { caseId },
  })
  if (result?.sessionId) {
    await navigateTo(`/dashboard/cases/init-analysis/${result.sessionId}`, { replace: true })
  } else {
    await navigateTo(`/dashboard/cases/${caseId}`, { replace: true })
  }
}
</script>
