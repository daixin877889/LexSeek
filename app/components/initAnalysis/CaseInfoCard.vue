<template>
  <div class="space-y-4 p-4">
    <div v-if="caseInfo" class="space-y-3">
      <h3 class="text-sm font-medium text-muted-foreground">案件信息</h3>
      <div class="space-y-2 text-sm">
        <div class="flex gap-2">
          <span class="shrink-0 text-muted-foreground">标题</span>
          <span class="font-medium">{{ caseInfo.title }}</span>
        </div>
        <div v-if="caseInfo.caseType" class="flex gap-2">
          <span class="shrink-0 text-muted-foreground">类型</span>
          <Badge variant="secondary">{{ caseInfo.caseType.name }}</Badge>
        </div>
        <div v-if="plaintiffText" class="flex gap-2">
          <span class="shrink-0 text-muted-foreground">原告</span>
          <span>{{ plaintiffText }}</span>
        </div>
        <div v-if="defendantText" class="flex gap-2">
          <span class="shrink-0 text-muted-foreground">被告</span>
          <span>{{ defendantText }}</span>
        </div>
        <div v-if="caseInfo.summary" class="flex gap-2">
          <span class="shrink-0 text-muted-foreground">概述</span>
          <span class="line-clamp-3">{{ caseInfo.summary }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
const props = defineProps<{
  caseId: number
}>()

interface CaseInfoData {
  title: string
  caseType?: { name: string }
  plaintiff?: string[] | Array<{ name: string }>
  defendant?: string[] | Array<{ name: string }>
  summary?: string
}

const caseInfo = ref<CaseInfoData | null>(null)

function parsePartyNames(party?: string[] | Array<{ name: string }>): string {
  if (!party || party.length === 0) return ''
  return party.map(p => typeof p === 'string' ? p : p.name).join('、')
}

const plaintiffText = computed(() => parsePartyNames(caseInfo.value?.plaintiff))
const defendantText = computed(() => parsePartyNames(caseInfo.value?.defendant))

async function loadCaseInfo() {
  const data = await useApiFetch<CaseInfoData>(`/api/v1/case/${props.caseId}`)
  if (data) caseInfo.value = data
}

watch(() => props.caseId, (id) => {
  if (id > 0) loadCaseInfo()
}, { immediate: true })
</script>
