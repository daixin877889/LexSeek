<template>
  <form class="py-6 sm:py-8 px-4 sm:px-6 md:px-12 overflow-y-auto" @submit.prevent="handleSubmit">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10">
      <!-- 左栏：案件信息 -->
      <div class="space-y-4 sm:space-y-6">
        <!-- 案件标题 -->
        <div class="space-y-2">
          <label class="text-sm font-medium leading-none">
            案件标题 <span class="text-destructive">*</span>
          </label>
          <Input v-model="form.title" placeholder="请输入案件标题" @blur="touched.title = true" class="mt-1" />
          <p v-if="touched.title && !form.title.trim()" class="text-sm text-destructive">
            请输入案件标题
          </p>
        </div>

        <!-- 案件类型 -->
        <div class="space-y-2">
          <label class="text-sm font-medium leading-none">
            案件类型 <span class="text-destructive">*</span>
          </label>
          <Select v-model="form.caseTypeId" @update:model-value="touched.caseTypeId = true" class="mt-1">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="请选择案件类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="ct in caseTypes" :key="ct.id" :value="String(ct.id)">
                {{ ct.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="touched.caseTypeId && !form.caseTypeId" class="text-sm text-destructive">
            请选择案件类型
          </p>
        </div>

        <!-- 原告 -->
        <CaseCreationPartyInput v-model="form.plaintiff" label="原告" placeholder="请输入原告姓名或名称" />

        <!-- 被告 -->
        <CaseCreationPartyInput v-model="form.defendant" label="被告" placeholder="请输入被告姓名或名称" />

        <!-- 案件描述 -->
        <div class="space-y-2">
          <label class="text-sm font-medium leading-none">案件描述</label>
          <Textarea v-model="form.content" placeholder="请输入案件描述" :rows="6" @blur="touched.content = true"
            class="mt-1" />
          <p v-if="touched.content && !form.content.trim() && form.materials.length === 0"
            class="text-sm text-destructive">
            案件描述和案件材料至少填写一项
          </p>
        </div>
      </div>

      <!-- 右栏：案件材料 -->
      <div class="space-y-2">
        <label class="text-sm font-medium leading-none">案件材料</label>
        <CaseCreationMaterialUploader v-model="form.materials" class="mt-1" />
      </div>
    </div>
  </form>
</template>

<script lang="ts" setup>
import { toast } from 'vue-sonner'
import type { OssFileItem } from '~/store/file'
import { CaseMaterialType } from '#shared/types/case'
import type { CaseTypeOption, ExtraField } from '#shared/types/case'
import type { ExtractedFormData, CreateCaseParams } from '~/composables/useCaseCreation'

type InitialData = ExtractedFormData & {
  initialFiles?: OssFileItem[]
  summary?: string
  extractedInfo?: ExtraField[]
}

const props = defineProps<{
  caseTypes: CaseTypeOption[]
  isSubmitting?: boolean
  initialData?: InitialData
}>()

const emit = defineEmits<{
  submit: [params: CreateCaseParams]
}>()

const form = reactive({
  caseTypeId: '',
  title: '',
  plaintiff: [''],
  defendant: [''],
  content: '',
  materials: [] as OssFileItem[],
})

const touched = reactive({
  title: false,
  caseTypeId: false,
  content: false,
})

// 使用 initialData 预填充表单
watch(() => props.initialData, (data) => {
  if (!data) return
  if (data.title) form.title = data.title
  if (data.caseTypeId) form.caseTypeId = String(data.caseTypeId)
  if (data.plaintiff?.length) form.plaintiff = [...data.plaintiff]
  if (data.defendant?.length) form.defendant = [...data.defendant]
  if (data.content) form.content = data.content
  if (data.initialFiles?.length) {
    const newFiles = data.initialFiles.filter(f => !form.materials.some(m => m.id === f.id))
    form.materials = [...form.materials, ...newFiles]
  }
}, { immediate: true })

const canSubmit = computed(() => {
  if (!form.title.trim()) return false
  if (!form.caseTypeId) return false
  const hasContent = !!form.content.trim()
  const hasMaterials = form.materials.length > 0
  if (!hasContent && !hasMaterials) return false
  return true
})

function handleSubmit() {
  // 标记所有字段为已触碰，显示校验提示
  touched.title = true
  touched.caseTypeId = true
  touched.content = true

  if (!canSubmit.value) {
    toast.warning('请检查必填项')
    return
  }

  const plaintiffList = form.plaintiff.filter(p => p.trim())
  const defendantList = form.defendant.filter(d => d.trim())

  emit('submit', {
    caseTypeId: Number(form.caseTypeId),
    title: form.title.trim() || undefined,
    plaintiff: plaintiffList.length > 0 ? plaintiffList.map(name => ({ name })) : undefined,
    defendant: defendantList.length > 0 ? defendantList.map(name => ({ name })) : undefined,
    content: form.content.trim() || undefined,
    materials: form.materials.length > 0
      ? form.materials.map(f => ({
        type: CaseMaterialType.DOCUMENT,
        name: f.fileName,
        ossFileId: f.id,
      }))
      : undefined,
    summary: props.initialData?.summary || undefined,
    extractedInfo: props.initialData?.extractedInfo || undefined,
  })
}

defineExpose({
  canSubmit,
  submit: handleSubmit,
})
</script>
