<template>
  <div class="space-y-4">
    <!-- 分类 Tab -->
    <Tabs :default-value="currentCategory" @update:model-value="onCategoryChange">
      <TabsList class="flex flex-wrap h-auto gap-1 p-1">
        <TabsTrigger
          v-for="cat in DOCUMENT_CATEGORIES"
          :key="cat.key"
          :value="cat.key"
          class="text-xs px-2 py-1 h-7"
        >
          {{ cat.label }}
        </TabsTrigger>
      </TabsList>
    </Tabs>

    <!-- 来源筛选 + 管理入口 -->
    <div class="flex items-center justify-between flex-wrap gap-2">
      <Tabs :model-value="currentScope" @update:model-value="onScopeChange">
        <TabsList class="h-8 p-0.5">
          <TabsTrigger value="all" class="text-xs px-3 h-7">全部</TabsTrigger>
          <TabsTrigger value="user" class="text-xs px-3 h-7">我的</TabsTrigger>
          <TabsTrigger value="global" class="text-xs px-3 h-7">公共</TabsTrigger>
        </TabsList>
      </Tabs>
      <Button
        variant="outline"
        size="sm"
        class="h-7 text-xs"
        @click="goManageTemplates"
      >
        <SettingsIcon class="size-3.5 mr-1" />
        管理我的模板
      </Button>
    </div>

    <!-- 加载状态 -->
    <div v-if="status === 'pending'" class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div
        v-for="i in 6"
        :key="i"
        class="h-20 rounded-lg border bg-muted/30 animate-pulse"
      />
    </div>

    <!-- 空状态 -->
    <div
      v-else-if="!templates.length"
      class="flex flex-col items-center justify-center py-10 text-muted-foreground"
    >
      <FileTextIcon class="size-10 mb-2 opacity-40" />
      <p class="text-sm">{{ emptyText }}</p>
      <Button
        v-if="currentScope === 'user'"
        variant="link"
        size="sm"
        class="h-auto mt-1 p-0 text-xs"
        @click="goManageTemplates"
      >
        去上传 →
      </Button>
    </div>

    <!-- 模板卡片网格 -->
    <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <button
        v-for="tpl in templates"
        :key="tpl.id"
        type="button"
        :class="[
          'relative flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm transition-all',
          'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          selectedTemplateId === tpl.id
            ? 'border-primary bg-primary/5 text-primary'
            : 'border-border bg-card',
        ]"
        @click="selectTemplate(tpl.id)"
      >
        <!-- 作用域标识 -->
        <span
          v-if="tpl.scope === 'user'"
          class="absolute top-2 right-2 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200 px-1.5 py-0.5 text-[10px] font-medium"
        >
          我的
        </span>

        <!-- 已选标记（用户模板场景下位置让给"我的"标签） -->
        <span
          v-if="selectedTemplateId === tpl.id"
          :class="[
            'absolute flex items-center gap-1 text-xs font-medium text-primary',
            tpl.scope === 'user' ? 'top-2 right-11' : 'top-2 right-2',
          ]"
        >
          <CheckIcon class="size-3" />
          已选
        </span>

        <FileTextIcon class="size-5 shrink-0 text-muted-foreground" />
        <span class="font-medium leading-tight line-clamp-2">{{ tpl.name }}</span>
        <span v-if="tpl.description" class="text-xs text-muted-foreground line-clamp-1">
          {{ tpl.description }}
        </span>
      </button>
    </div>

    <!-- 更换按钮（已选时显示） -->
    <div v-if="selectedTemplateId" class="flex items-center gap-2 pt-1">
      <span class="text-xs text-muted-foreground">
        已选模板：{{ selectedTemplateName }}
      </span>
      <Button variant="ghost" size="sm" class="h-6 text-xs px-2" @click="clearTemplate">
        更换
      </Button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { CheckIcon, FileTextIcon, SettingsIcon } from 'lucide-vue-next'
import { DOCUMENT_CATEGORIES, type DocumentCategoryKey } from '#shared/types/document'

interface TemplateItem {
  id: number
  name: string
  description?: string | null
  category: string
  scope: 'global' | 'user'
  ossFileId?: number | null
}

interface ListTemplatesResponse {
  list: TemplateItem[]
  total: number
  skip: number
  take: number
}

type ScopeFilter = 'all' | 'user' | 'global'

const props = defineProps<{
  /** 可预选分类 */
  category?: DocumentCategoryKey
  /** 初始来源筛选，默认 'all'（混合显示） */
  initialScope?: ScopeFilter
}>()

const emit = defineEmits<{
  select: [templateId: number]
}>()

// 当前选中的模板 ID（通过 v-model:template-id）
const selectedTemplateId = defineModel<number | null>('templateId', { default: null })

const currentCategory = ref<string>(props.category ?? DOCUMENT_CATEGORIES[0]!.key)
const currentScope = ref<ScopeFilter>(props.initialScope ?? 'all')

// 拉取模板列表（scope=all 时不传 scope，让 API 返回 global + 自己的 user 模板）
const queryParams = computed(() => {
  const q: Record<string, string> = { category: currentCategory.value }
  if (currentScope.value !== 'all') q.scope = currentScope.value
  return q
})

const { data: listData, status, refresh } = useApi<ListTemplatesResponse>(
  '/api/v1/assistant/document/templates',
  { query: queryParams },
)

const templates = computed(() => listData.value?.list ?? [])

const emptyText = computed(() => {
  if (currentScope.value === 'user') return '你还没有上传过这一分类下的模板'
  if (currentScope.value === 'global') return '该分类暂无公共模板'
  return '暂无模板'
})

const selectedTemplateName = computed(
  () => templates.value.find((t: TemplateItem) => t.id === selectedTemplateId.value)?.name ?? '',
)

function onCategoryChange(val: string | number) {
  currentCategory.value = String(val)
  // 切换分类后清除已选（避免选了别的分类的模板）
  selectedTemplateId.value = null
}

function onScopeChange(val: string | number) {
  currentScope.value = String(val) as ScopeFilter
  selectedTemplateId.value = null
}

function selectTemplate(id: number) {
  if (selectedTemplateId.value === id) return
  selectedTemplateId.value = id
  emit('select', id)
}

function clearTemplate() {
  selectedTemplateId.value = null
}

function goManageTemplates() {
  navigateTo('/dashboard/document/templates')
}

// 分类/来源变化时 useApi 的 query 响应式会自动重拉，无需手动 refresh
// 保留 refresh 引用避免未使用告警
void refresh
</script>
