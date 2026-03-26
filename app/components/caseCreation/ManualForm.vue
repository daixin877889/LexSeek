<template>
  <form class="mx-auto max-w-2xl space-y-6 py-8 px-4" @submit.prevent="handleSubmit">
    <!-- 案件类型 -->
    <div class="space-y-2">
      <label class="text-sm font-medium leading-none">
        案件类型 <span class="text-destructive">*</span>
      </label>
      <Select v-model="form.caseTypeId">
        <SelectTrigger>
          <SelectValue placeholder="请选择案件类型" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="ct in caseTypes"
            :key="ct.id"
            :value="String(ct.id)"
          >
            {{ ct.name }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- 案件标题 -->
    <div class="space-y-2">
      <label class="text-sm font-medium leading-none">案件标题</label>
      <Input v-model="form.title" placeholder="请输入案件标题（选填）" />
    </div>

    <!-- 原告 -->
    <CaseCreationPartyInput
      v-model="form.plaintiff"
      label="原告"
      placeholder="请输入原告姓名或名称"
    />

    <!-- 被告 -->
    <CaseCreationPartyInput
      v-model="form.defendant"
      label="被告"
      placeholder="请输入被告姓名或名称"
    />

    <!-- 案件描述 -->
    <div class="space-y-2">
      <label class="text-sm font-medium leading-none">案件描述</label>
      <Textarea
        v-model="form.content"
        placeholder="请输入案件描述（选填）"
        :rows="4"
      />
    </div>

    <!-- 材料上传 -->
    <div class="space-y-2">
      <label class="text-sm font-medium leading-none">案件材料</label>
      <CaseCreationMaterialUploader v-model="form.materials" />
    </div>

    <!-- 提交 -->
    <div class="flex justify-end pt-4">
      <Button type="submit" :disabled="!canSubmit || isSubmitting" class="min-w-[120px]">
        <Loader2Icon v-if="isSubmitting" class="size-4 mr-2 animate-spin" />
        创建案件
      </Button>
    </div>
  </form>
</template>

<script lang="ts" setup>
import { Loader2Icon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { OssFileItem } from '~/store/file'
import { CaseMaterialType } from '#shared/types/case'

interface CaseType {
  id: number
  name: string
}

const props = defineProps<{
  caseTypes: CaseType[]
  isSubmitting: boolean
}>()

const emit = defineEmits<{
  submit: [params: {
    caseTypeId: number
    title?: string
    plaintiff?: Array<{ name: string }>
    defendant?: Array<{ name: string }>
    content?: string
    materials?: Array<{ type: number; name?: string; ossFileId?: number }>
  }]
}>()

const form = reactive({
  caseTypeId: '',
  title: '',
  plaintiff: [''],
  defendant: [''],
  content: '',
  materials: [] as OssFileItem[],
})

const canSubmit = computed(() => !!form.caseTypeId)

function handleSubmit() {
  if (!form.caseTypeId) {
    toast.warning('请选择案件类型')
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
  })
}
</script>
