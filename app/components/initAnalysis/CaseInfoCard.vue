<template>
  <div class="space-y-4 p-4">
    <div v-if="caseInfo" class="space-y-3">
      <h3 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
        案件基本信息
      </h3>
      <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm items-baseline">
        <!-- 标题 -->
        <span class="text-muted-foreground shrink-0">标题</span>
        <span class="font-bold text-foreground">{{ caseInfo.title }}</span>

        <!-- 类型 -->
        <template v-if="caseInfo.caseType">
          <span class="text-muted-foreground shrink-0">类型</span>
          <div class="flex">
            <Badge variant="secondary" class="font-normal px-2 py-0 h-5 text-[10px]">
              {{ caseInfo.caseType.name }}
            </Badge>
          </div>
        </template>

        <!-- 原告 -->
        <template v-if="plaintiffText">
          <span class="text-muted-foreground shrink-0">原告</span>
          <span class="font-bold text-foreground">{{ plaintiffText }}</span>
        </template>

        <!-- 被告 -->
        <template v-if="defendantText">
          <span class="text-muted-foreground shrink-0">被告</span>
          <span class="font-bold text-foreground">{{ defendantText }}</span>
        </template>

        <!-- 额外字段 -->
        <template v-for="field in caseInfo.extraFields" :key="field.name">
          <span class="text-muted-foreground shrink-0">{{ field.title }}</span>
          <span class="font-bold text-foreground">{{ field.value }}</span>
        </template>

        <!-- 概述 -->
        <template v-if="caseInfo.summary">
          <span class="text-muted-foreground shrink-0 self-start mt-0.5">概述</span>
          <span class="text-foreground leading-relaxed line-clamp-3 font-bold">{{ caseInfo.summary }}</span>
        </template>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
export interface ExtraField {
  name: string
  title: string
  value: string
}

export interface CaseInfoData {
  title: string
  caseType?: { name: string }
  plaintiff?: string[] | Array<{ name: string }>
  defendant?: string[] | Array<{ name: string }>
  summary?: string
  extraFields?: ExtraField[]
}

const props = defineProps<{
  caseId: number
}>()

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
