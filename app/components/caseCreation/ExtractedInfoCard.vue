<template>
  <div class="rounded-xl border bg-card p-5 space-y-4">
    <h4 class="text-sm font-semibold text-muted-foreground">提取的案件信息</h4>

    <!-- 案件类型 -->
    <div class="space-y-1.5">
      <label class="text-sm font-medium">案件类型 <span class="text-destructive">*</span></label>
      <Select v-model="form.caseTypeId">
        <SelectTrigger>
          <SelectValue placeholder="请选择案件类型" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="ct in caseTypes" :key="ct.id" :value="String(ct.id)">
            {{ ct.name }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- 案件标题 -->
    <div class="space-y-1.5">
      <label class="text-sm font-medium">案件标题</label>
      <Input v-model="form.title" />
    </div>

    <!-- 原告 -->
    <CaseCreationPartyInput v-model="form.plaintiff" label="原告" />

    <!-- 被告 -->
    <CaseCreationPartyInput v-model="form.defendant" label="被告" />

    <!-- 案件摘要 -->
    <div class="space-y-1.5">
      <label class="text-sm font-medium">案件摘要</label>
      <Textarea v-model="form.summary" :rows="3" />
    </div>

    <!-- 确认按钮 -->
    <div class="flex justify-end pt-2">
      <Button :disabled="!canSubmit || isSubmitting" @click="handleConfirm">
        <Loader2Icon v-if="isSubmitting" class="size-4 mr-2 animate-spin" />
        确认并创建案件
      </Button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { Loader2Icon } from 'lucide-vue-next'
import type { ExtractedCaseInfo } from '#shared/types/case'
import type { CaseTypeOption } from '#shared/types/case'

const props = defineProps<{
  extractedInfo: ExtractedCaseInfo
  caseTypes: CaseTypeOption[]
  isSubmitting: boolean
}>()

const emit = defineEmits<{
  confirm: [params: {
    caseTypeId: number
    title?: string
    plaintiff?: Array<{ name: string }>
    defendant?: Array<{ name: string }>
    content?: string
  }]
}>()

const form = reactive({
  caseTypeId: '',
  title: props.extractedInfo.title || '',
  plaintiff: props.extractedInfo.plaintiff?.length > 0
    ? [...props.extractedInfo.plaintiff]
    : [''],
  defendant: props.extractedInfo.defendant?.length > 0
    ? [...props.extractedInfo.defendant]
    : [''],
  summary: props.extractedInfo.summary || '',
})

watch(() => props.extractedInfo, (info) => {
  form.title = info.title || ''
  form.plaintiff = info.plaintiff?.length > 0 ? [...info.plaintiff] : ['']
  form.defendant = info.defendant?.length > 0 ? [...info.defendant] : ['']
  form.summary = info.summary || ''
  form.caseTypeId = ''
})

// 尝试匹配案件类型名称到 ID
watchEffect(() => {
  if (props.extractedInfo.caseType && props.caseTypes.length > 0 && !form.caseTypeId) {
    const matched = props.caseTypes.find(
      ct => ct.name === props.extractedInfo.caseType || ct.name.includes(props.extractedInfo.caseType),
    )
    if (matched) {
      form.caseTypeId = String(matched.id)
    }
  }
})

const canSubmit = computed(() => !!form.caseTypeId)

function handleConfirm() {
  const plaintiffList = form.plaintiff.filter(p => p.trim())
  const defendantList = form.defendant.filter(d => d.trim())

  emit('confirm', {
    caseTypeId: Number(form.caseTypeId),
    title: form.title.trim() || undefined,
    plaintiff: plaintiffList.length > 0 ? plaintiffList.map(name => ({ name })) : undefined,
    defendant: defendantList.length > 0 ? defendantList.map(name => ({ name })) : undefined,
    content: form.summary.trim() || undefined,
  })
}
</script>
