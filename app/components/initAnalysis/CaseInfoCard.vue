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
      <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm items-baseline lg:grid-cols-[auto_1fr_auto_1fr] lg:gap-x-6">
        <!-- 标题（跨列） -->
        <span class="text-muted-foreground shrink-0">标题</span>
        <Input v-if="isEditing" v-model="editForm.title" class="h-7 text-sm lg:col-span-3" />
        <span v-else class="font-bold text-foreground lg:col-span-3">{{ caseInfo.title }}</span>

        <!-- 类型 -->
        <template v-if="caseInfo.caseType">
          <span class="text-muted-foreground shrink-0">类型</span>
          <span class="text-foreground">{{ caseInfo.caseType.name }}</span>
        </template>

        <!-- 原告（跨列） -->
        <template v-if="isEditing || plaintiffNames.length > 0">
          <span class="text-muted-foreground shrink-0">原告</span>
          <div v-if="isEditing" class="flex flex-wrap gap-1.5 items-center lg:col-span-3">
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
          <div v-else class="flex flex-wrap gap-1.5 lg:col-span-3">
            <Badge v-for="name in plaintiffNames" :key="name" variant="outline"
              class="font-normal px-2 py-0 h-5 text-[11px] border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400">
              {{ name }}
            </Badge>
          </div>
        </template>

        <!-- 被告（跨列） -->
        <template v-if="isEditing || defendantNames.length > 0">
          <span class="text-muted-foreground shrink-0">被告</span>
          <div v-if="isEditing" class="flex flex-wrap gap-1.5 items-center lg:col-span-3">
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
          <div v-else class="flex flex-wrap gap-1.5 lg:col-span-3">
            <Badge v-for="name in defendantNames" :key="name" variant="outline"
              class="font-normal px-2 py-0 h-5 text-[11px] border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-400">
              {{ name }}
            </Badge>
          </div>
        </template>

        <!-- 案件状态（编辑态） -->
        <template v-if="isEditing">
          <span class="text-muted-foreground shrink-0">状态</span>
          <Select
            :model-value="String(editForm.status)"
            @update:model-value="(v: any) => editForm.status = Number(v)"
          >
            <SelectTrigger class="h-7 text-sm w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">咨询阶段</SelectItem>
              <SelectItem value="2">准备阶段</SelectItem>
              <SelectItem value="3">一审阶段</SelectItem>
              <SelectItem value="4">二审阶段</SelectItem>
              <SelectItem value="99">结案</SelectItem>
            </SelectContent>
          </Select>
        </template>

        <!-- 分析立场（编辑态） -->
        <template v-if="isEditing">
          <span class="text-muted-foreground shrink-0">分析立场</span>
          <StanceToggleGroup v-model="editForm.stance" />
        </template>

        <!-- 法院（编辑态） -->
        <template v-if="isEditing">
          <span class="text-muted-foreground shrink-0">法院</span>
          <Input v-model="editForm.courtName" class="h-7 text-sm lg:col-span-3" placeholder="如：北京市朝阳区人民法院" />
        </template>

        <!-- 一审案号（编辑态） -->
        <template v-if="isEditing">
          <span class="text-muted-foreground shrink-0">一审案号</span>
          <Input v-model="editForm.firstInstanceCaseNo" class="h-7 text-sm" />
        </template>

        <!-- 一审法官（编辑态） -->
        <template v-if="isEditing">
          <span class="text-muted-foreground shrink-0">一审法官</span>
          <Input v-model="editForm.firstInstanceJudge" class="h-7 text-sm" />
        </template>

        <!-- 二审案号（编辑态） -->
        <template v-if="isEditing">
          <span class="text-muted-foreground shrink-0">二审案号</span>
          <Input v-model="editForm.secondInstanceCaseNo" class="h-7 text-sm" />
        </template>

        <!-- 二审法官（编辑态） -->
        <template v-if="isEditing">
          <span class="text-muted-foreground shrink-0">二审法官</span>
          <Input v-model="editForm.secondInstanceJudge" class="h-7 text-sm" />
        </template>


        <!-- 案件状态（展示态） -->
        <template v-if="!isEditing && caseInfo.status">
          <span class="text-muted-foreground shrink-0">状态</span>
          <Badge variant="outline" class="font-normal px-2 py-0 h-5 text-[11px] w-fit">
            {{ CaseStatusText[caseInfo.status as CaseStatus] ?? '未知' }}
          </Badge>
        </template>

        <!-- 分析立场（展示态） -->
        <template v-if="!isEditing && caseInfo.stance">
          <span class="text-muted-foreground shrink-0">分析立场</span>
          <Badge variant="outline" class="font-normal px-2 py-0 h-5 text-[11px] w-fit border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-400">
            {{ CaseStanceText[caseInfo.stance] }}
          </Badge>
        </template>

        <!-- 法院名称（展示态） -->
        <template v-if="!isEditing && caseInfo.courtName">
          <span class="text-muted-foreground shrink-0">法院</span>
          <span class="text-foreground">{{ caseInfo.courtName }}</span>
        </template>

        <!-- 一审案号 -->
        <template v-if="!isEditing && caseInfo.firstInstanceCaseNo">
          <span class="text-muted-foreground shrink-0">一审案号</span>
          <span class="text-foreground">{{ caseInfo.firstInstanceCaseNo }}</span>
        </template>

        <!-- 一审法官 -->
        <template v-if="!isEditing && caseInfo.firstInstanceJudge">
          <span class="text-muted-foreground shrink-0">一审法官</span>
          <span class="text-foreground">{{ caseInfo.firstInstanceJudge }}</span>
        </template>

        <!-- 二审案号 -->
        <template v-if="!isEditing && caseInfo.secondInstanceCaseNo">
          <span class="text-muted-foreground shrink-0">二审案号</span>
          <span class="text-foreground">{{ caseInfo.secondInstanceCaseNo }}</span>
        </template>

        <!-- 二审法官 -->
        <template v-if="!isEditing && caseInfo.secondInstanceJudge">
          <span class="text-muted-foreground shrink-0">二审法官</span>
          <span class="text-foreground">{{ caseInfo.secondInstanceJudge }}</span>
        </template>

        <!-- 额外字段 -->
        <template v-for="field in caseInfo.extraFields" :key="field.name">
          <span class="text-muted-foreground shrink-0">{{ field.title }}</span>
          <span class="font-bold text-foreground">{{ field.value }}</span>
        </template>
      </div>

      <!-- 案件描述（编辑态） -->
      <div v-if="isEditing" class="space-y-1 pt-2 border-t border-border/50">
        <label class="text-xs text-muted-foreground">案件描述</label>
        <Textarea v-model="editForm.content" :rows="4" />
      </div>

      <!-- 案件描述（折叠） -->
      <div v-if="!isEditing && caseInfo.content" class="space-y-1 pt-2 border-t border-border/50">
        <div class="flex items-center justify-between">
          <span class="text-xs text-muted-foreground">案件描述</span>
          <button class="text-xs text-primary hover:underline" @click="contentExpanded = !contentExpanded">
            {{ contentExpanded ? '收起' : '展开' }}
          </button>
        </div>
        <p
          class="text-sm text-foreground whitespace-pre-wrap"
          :class="{ 'line-clamp-3': !contentExpanded }"
        >
          {{ caseInfo.content }}
        </p>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { InfoIcon, PencilIcon, XIcon, PlusIcon, Loader2Icon } from 'lucide-vue-next'
import toast from '#shared/utils/toast'
import { useApiFetch } from '~/composables/useApiFetch'
import { CaseStatus, CaseStatusText, CaseStance, CaseStanceText } from '#shared/types/case'
import StanceToggleGroup from '~/components/caseCreation/StanceToggleGroup.vue'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Textarea } from '~/components/ui/textarea'

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
  // 基础信息补全（spec §3.2 / Task B3）
  status?: number
  content?: string
  courtName?: string
  firstInstanceCaseNo?: string
  firstInstanceJudge?: string
  secondInstanceCaseNo?: string
  secondInstanceJudge?: string
  stance?: CaseStance
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

// 案件描述展开/收起
const contentExpanded = ref(false)

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
  status: 1,
  stance: CaseStance.PLAINTIFF,
  courtName: '',
  firstInstanceCaseNo: '',
  firstInstanceJudge: '',
  secondInstanceCaseNo: '',
  secondInstanceJudge: '',
  content: '',
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
  const data = await useApiFetch<CaseInfoData>(`/api/v1/cases/${props.caseId}`)
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
    status: caseInfo.value?.status ?? 1,
    stance: (caseInfo.value?.stance as CaseStance) ?? CaseStance.PLAINTIFF,
    courtName: caseInfo.value?.courtName ?? '',
    firstInstanceCaseNo: caseInfo.value?.firstInstanceCaseNo ?? '',
    firstInstanceJudge: caseInfo.value?.firstInstanceJudge ?? '',
    secondInstanceCaseNo: caseInfo.value?.secondInstanceCaseNo ?? '',
    secondInstanceJudge: caseInfo.value?.secondInstanceJudge ?? '',
    content: caseInfo.value?.content ?? '',
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
  const result = await useApiFetch(`/api/v1/cases/${props.caseId}`, {
    method: 'PUT',
    body: {
      title: editForm.value.title.trim(),
      plaintiff: editForm.value.plaintiff,
      defendant: editForm.value.defendant,
      status: editForm.value.status,
      stance: editForm.value.stance,
      courtName: editForm.value.courtName.trim() || undefined,
      firstInstanceCaseNo: editForm.value.firstInstanceCaseNo.trim() || undefined,
      firstInstanceJudge: editForm.value.firstInstanceJudge.trim() || undefined,
      secondInstanceCaseNo: editForm.value.secondInstanceCaseNo.trim() || undefined,
      secondInstanceJudge: editForm.value.secondInstanceJudge.trim() || undefined,
      content: editForm.value.content,
    },
  })
  isSaving.value = false
  if (result !== null) {
    // 直接用编辑数据更新本地状态，避免额外 GET 请求
    if (caseInfo.value) {
      caseInfo.value = {
        ...caseInfo.value,
        ...editForm.value,
        plaintiff: [...editForm.value.plaintiff],
        defendant: [...editForm.value.defendant],
      }
    }
    isEditing.value = false
    emit('updated')
  }
}
</script>
