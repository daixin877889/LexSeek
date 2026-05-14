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

        <!-- 分析立场 -->
        <div class="space-y-2">
          <label class="text-sm font-medium leading-none">分析立场</label>
          <StanceToggleGroup v-model="form.stance" class="mt-1" />
        </div>

        <!-- 原告 -->
        <CaseCreationPartyInput v-model="form.plaintiff" label="原告" placeholder="请输入原告姓名或名称" />

        <!-- 被告 -->
        <CaseCreationPartyInput v-model="form.defendant" label="被告" placeholder="请输入被告姓名或名称" />

        <!-- 案件状态 -->
        <div class="space-y-2">
          <label class="text-sm font-medium leading-none">案件状态</label>
          <Select
            :model-value="String(form.status)"
            @update:model-value="(v: any) => form.status = Number(v)"
            class="mt-1"
          >
            <SelectTrigger class="w-full">
              <SelectValue placeholder="选择案件状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">咨询阶段</SelectItem>
              <SelectItem value="2">准备阶段</SelectItem>
              <SelectItem value="3">一审阶段</SelectItem>
              <SelectItem value="4">二审阶段</SelectItem>
              <SelectItem value="99">结案</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 诉讼信息（选填） -->
        <div class="space-y-3">
          <h3 class="text-sm font-semibold text-foreground pb-1 border-b border-border">诉讼信息（选填）</h3>
          <div class="space-y-3">
            <div>
              <label class="text-xs font-medium text-muted-foreground mb-1 block">法院名称</label>
              <Input v-model="form.courtName" placeholder="如：北京市朝阳区人民法院" />
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-medium text-muted-foreground mb-1 block">一审案号</label>
                <Input v-model="form.firstInstanceCaseNo" placeholder="如：(2023)京0105民初12345号" />
              </div>
              <div>
                <label class="text-xs font-medium text-muted-foreground mb-1 block">二审案号</label>
                <Input v-model="form.secondInstanceCaseNo" placeholder="如：(2024)京03民终6789号" />
              </div>
              <div>
                <label class="text-xs font-medium text-muted-foreground mb-1 block">一审法官</label>
                <Input v-model="form.firstInstanceJudge" placeholder="承办法官姓名" />
              </div>
              <div>
                <label class="text-xs font-medium text-muted-foreground mb-1 block">二审法官</label>
                <Input v-model="form.secondInstanceJudge" placeholder="承办法官姓名" />
              </div>
            </div>
          </div>
        </div>

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
import { CaseMaterialType, CaseStance } from '#shared/types/case'
import type { CaseTypeOption, ExtraField } from '#shared/types/case'
import type { ExtractedFormData, CreateCaseParams } from '~/composables/useCaseCreation'
import { mergeAutofillPreservingUserInput } from '~/composables/useCaseCreation'
import { getMaterialType } from '~/utils/caseMaterial'
import CaseCreationMaterialUploader from '~/components/caseCreation/MaterialUploader.vue'
import CaseCreationPartyInput from '~/components/caseCreation/PartyInput.vue'
import StanceToggleGroup from '~/components/caseCreation/StanceToggleGroup.vue'
import type { caseTypes } from '~~/generated/prisma/client'

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
  status: 1,
  stance: CaseStance.PLAINTIFF,
  courtName: '',
  firstInstanceCaseNo: '',
  secondInstanceCaseNo: '',
  firstInstanceJudge: '',
  secondInstanceJudge: '',
})

const touched = reactive({
  title: false,
  caseTypeId: false,
  content: false,
})

// 使用 initialData 预填充表单：AI 抽取结果只填空字段，不覆盖用户已输入内容
watch(() => props.initialData, (data) => {
  if (!data) return

  const scalarMerged = mergeAutofillPreservingUserInput(
    {
      title: form.title,
      caseTypeId: form.caseTypeId,
      content: form.content,
      courtName: form.courtName,
      firstInstanceCaseNo: form.firstInstanceCaseNo,
      secondInstanceCaseNo: form.secondInstanceCaseNo,
      firstInstanceJudge: form.firstInstanceJudge,
      secondInstanceJudge: form.secondInstanceJudge,
    },
    {
      title: data.title,
      caseTypeId: data.caseTypeId !== undefined ? String(data.caseTypeId) : undefined,
      content: data.content,
      courtName: data.courtName,
      firstInstanceCaseNo: data.firstInstanceCaseNo,
      secondInstanceCaseNo: data.secondInstanceCaseNo,
      firstInstanceJudge: data.firstInstanceJudge,
      secondInstanceJudge: data.secondInstanceJudge,
    },
  )
  form.title = scalarMerged.title
  form.caseTypeId = scalarMerged.caseTypeId
  form.content = scalarMerged.content
  form.courtName = scalarMerged.courtName
  form.firstInstanceCaseNo = scalarMerged.firstInstanceCaseNo
  form.secondInstanceCaseNo = scalarMerged.secondInstanceCaseNo
  form.firstInstanceJudge = scalarMerged.firstInstanceJudge
  form.secondInstanceJudge = scalarMerged.secondInstanceJudge

  // 数组字段：仅当用户尚未填过（当前只有一个空串占位）时接受 AI 结果
  const userHasPlaintiff = form.plaintiff.some(p => p.trim() !== '')
  if (!userHasPlaintiff && data.plaintiff?.length) form.plaintiff = [...data.plaintiff]
  const userHasDefendant = form.defendant.some(d => d.trim() !== '')
  if (!userHasDefendant && data.defendant?.length) form.defendant = [...data.defendant]

  // 状态只有当 AI 显式给出有效值时才覆盖默认
  if (data.status !== undefined && data.status !== null) form.status = data.status

  // 立场（AI / 外部预填）：仅在显式给出有效枚举值时覆盖默认（plaintiff）
  if (data.stance !== undefined && data.stance !== null) form.stance = data.stance

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
        type: getMaterialType(f.fileType),
        name: f.fileName,
        ossFileId: f.id,
      }))
      : undefined,
    summary: props.initialData?.summary || undefined,
    extractedInfo: props.initialData?.extractedInfo || undefined,
    status: form.status,
    stance: form.stance,
    courtName: form.courtName.trim() || undefined,
    firstInstanceCaseNo: form.firstInstanceCaseNo.trim() || undefined,
    secondInstanceCaseNo: form.secondInstanceCaseNo.trim() || undefined,
    firstInstanceJudge: form.firstInstanceJudge.trim() || undefined,
    secondInstanceJudge: form.secondInstanceJudge.trim() || undefined,
  })
}

function getCurrentValues() {
  return {
    title: form.title,
    plaintiff: [...form.plaintiff],
    defendant: [...form.defendant],
    status: form.status,
    stance: form.stance,
    courtName: form.courtName,
    firstInstanceCaseNo: form.firstInstanceCaseNo,
    secondInstanceCaseNo: form.secondInstanceCaseNo,
    firstInstanceJudge: form.firstInstanceJudge,
    secondInstanceJudge: form.secondInstanceJudge,
  }
}

defineExpose({
  canSubmit,
  submit: handleSubmit,
  getCurrentValues,
})
</script>
