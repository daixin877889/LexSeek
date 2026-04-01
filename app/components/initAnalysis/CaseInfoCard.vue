<template>
  <div class="p-4 space-y-4">
    <div v-if="caseInfo" class="space-y-3">
      <h3 v-if="!hideHeader" class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
        <InfoIcon class="size-4" />
        案件基本信息
        <Button v-if="editable && !isEditing" variant="ghost" size="icon" class="size-5 ml-auto" @click="startEditing">
          <PencilIcon class="size-3" />
        </Button>
      </h3>
      <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm items-baseline">
        <!-- 标题 -->
        <span class="text-muted-foreground shrink-0">标题</span>
        <Input v-if="isEditing" v-model="editForm.title" class="h-7 text-sm" />
        <span v-else class="font-bold text-foreground">{{ caseInfo.title }}</span>

        <!-- 类型 -->
        <template v-if="caseInfo.caseType">
          <span class="text-muted-foreground shrink-0">类型</span>
          <span class="text-foreground">{{ caseInfo.caseType.name }}</span>
        </template>

        <!-- 原告 -->
        <template v-if="isEditing || plaintiffNames.length > 0">
          <span class="text-muted-foreground shrink-0">原告</span>
          <div v-if="isEditing" class="flex flex-wrap gap-1.5 items-center">
            <Badge v-for="(name, i) in editForm.plaintiff" :key="name" variant="outline"
              class="font-normal px-2 py-0 h-5 text-[11px] border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400 gap-1">
              {{ name }}
              <button class="hover:text-destructive" @click="removeParty('plaintiff', i)">
                <XIcon class="size-3" />
              </button>
            </Badge>
            <div v-if="partyInput.plaintiff.show" class="flex items-center gap-1">
              <Input v-model="partyInput.plaintiff.value" class="h-5 w-24 text-[11px]" placeholder="输入名称"
                @keydown.enter="addParty('plaintiff')" @blur="addParty('plaintiff')" />
            </div>
            <button v-else class="text-[11px] text-muted-foreground hover:text-primary flex items-center gap-0.5"
              @click="partyInput.plaintiff.show = true">
              <PlusIcon class="size-3" /> 添加
            </button>
          </div>
          <div v-else class="flex flex-wrap gap-1.5">
            <Badge v-for="name in plaintiffNames" :key="name" variant="outline"
              class="font-normal px-2 py-0 h-5 text-[11px] border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400">
              {{ name }}
            </Badge>
          </div>
        </template>

        <!-- 被告 -->
        <template v-if="isEditing || defendantNames.length > 0">
          <span class="text-muted-foreground shrink-0">被告</span>
          <div v-if="isEditing" class="flex flex-wrap gap-1.5 items-center">
            <Badge v-for="(name, i) in editForm.defendant" :key="name" variant="outline"
              class="font-normal px-2 py-0 h-5 text-[11px] border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-400 gap-1">
              {{ name }}
              <button class="hover:text-destructive" @click="removeParty('defendant', i)">
                <XIcon class="size-3" />
              </button>
            </Badge>
            <div v-if="partyInput.defendant.show" class="flex items-center gap-1">
              <Input v-model="partyInput.defendant.value" class="h-5 w-24 text-[11px]" placeholder="输入名称"
                @keydown.enter="addParty('defendant')" @blur="addParty('defendant')" />
            </div>
            <button v-else class="text-[11px] text-muted-foreground hover:text-primary flex items-center gap-0.5"
              @click="partyInput.defendant.show = true">
              <PlusIcon class="size-3" /> 添加
            </button>
          </div>
          <div v-else class="flex flex-wrap gap-1.5">
            <Badge v-for="name in defendantNames" :key="name" variant="outline"
              class="font-normal px-2 py-0 h-5 text-[11px] border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-400">
              {{ name }}
            </Badge>
          </div>
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
import { InfoIcon, PencilIcon, XIcon, PlusIcon, Loader2Icon } from 'lucide-vue-next'

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

const props = withDefaults(defineProps<{
  caseId: number
  editable?: boolean
  hideHeader?: boolean
}>(), {
  editable: false,
  hideHeader: false,
})

const emit = defineEmits<{
  updated: []
  'update:isEditing': [val: boolean]
}>()

defineExpose({
  startEditing,
  saveChanges,
  cancelEditing,
})

const caseInfo = ref<CaseInfoData | null>(null)

// 编辑状态
const isEditing = ref(false)
const isSaving = ref(false)

watch(isEditing, (val) => {
  emit('update:isEditing', val)
})
const editForm = ref({
  title: '',
  plaintiff: [] as string[],
  defendant: [] as string[],
})
const partyInput = ref<Record<'plaintiff' | 'defendant', { show: boolean, value: string }>>({
  plaintiff: { show: false, value: '' },
  defendant: { show: false, value: '' },
})

function parsePartyNames(party?: string[] | Array<{ name: string }>): string[] {
  if (!party || party.length === 0) return []
  return party.map(p => typeof p === 'string' ? p : p.name)
}

const plaintiffNames = computed(() => parsePartyNames(caseInfo.value?.plaintiff))
const defendantNames = computed(() => parsePartyNames(caseInfo.value?.defendant))

async function loadCaseInfo() {
  const data = await useApiFetch<CaseInfoData>(`/api/v1/case/${props.caseId}`)
  if (data) caseInfo.value = data
}

watch(() => props.caseId, (id) => {
  if (id > 0) loadCaseInfo()
}, { immediate: true })

// --- 编辑功能 ---

function startEditing() {
  editForm.value = {
    title: caseInfo.value?.title ?? '',
    plaintiff: [...plaintiffNames.value],
    defendant: [...defendantNames.value],
  }
  isEditing.value = true
}

function cancelEditing() {
  isEditing.value = false
  partyInput.value = {
    plaintiff: { show: false, value: '' },
    defendant: { show: false, value: '' },
  }
}

function addParty(type: 'plaintiff' | 'defendant') {
  const name = partyInput.value[type].value.trim()
  if (!name) return
  if (!editForm.value[type].includes(name)) {
    editForm.value = {
      ...editForm.value,
      [type]: [...editForm.value[type], name],
    }
  }
  partyInput.value[type] = { show: false, value: '' }
}

function removeParty(type: 'plaintiff' | 'defendant', index: number) {
  editForm.value = {
    ...editForm.value,
    [type]: editForm.value[type].filter((_, i) => i !== index),
  }
}

async function saveChanges() {
  if (!editForm.value.title.trim()) {
    toast.error('标题不能为空')
    return
  }
  isSaving.value = true
  const result = await useApiFetch(`/api/v1/case/${props.caseId}`, {
    method: 'PUT',
    body: {
      title: editForm.value.title.trim(),
      plaintiff: editForm.value.plaintiff,
      defendant: editForm.value.defendant,
    },
  })
  isSaving.value = false
  if (result !== null) {
    // 直接用编辑数据更新本地状态，避免额外 GET 请求
    if (caseInfo.value) {
      caseInfo.value = {
        ...caseInfo.value,
        title: editForm.value.title.trim(),
        plaintiff: [...editForm.value.plaintiff],
        defendant: [...editForm.value.defendant],
      }
    }
    isEditing.value = false
    emit('updated')
  }
}
</script>
