<template>
  <div class="space-y-4">
    <!-- 统一筛选工具栏：[分类▾] [来源▾] [🔍 搜索] [⚙ 管理] -->
    <div class="flex flex-wrap items-center gap-2">
      <!-- 分类下拉 -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm" class="h-8 text-xs justify-between min-w-[140px]">
            <span class="truncate">
              <span class="text-muted-foreground mr-1">分类：</span>
              {{ currentCategoryLabel }}
            </span>
            <ChevronDownIcon class="size-3.5 ml-1 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-56 max-h-[60vh] overflow-auto">
          <DropdownMenuItem v-for="cat in DOCUMENT_CATEGORIES" :key="cat.key"
            :class="cat.key === currentCategory ? 'bg-accent' : ''" @click="onCategoryChange(cat.key)">
            {{ cat.label }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- 来源下拉 -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm" class="h-8 text-xs justify-between min-w-[110px]">
            <span class="truncate">
              <span class="text-muted-foreground mr-1">来源：</span>
              {{ currentScopeLabel }}
            </span>
            <ChevronDownIcon class="size-3.5 ml-1 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-36">
          <DropdownMenuItem v-for="opt in SCOPE_OPTIONS" :key="opt.value"
            :class="opt.value === currentScope ? 'bg-accent' : ''" @click="onScopeChange(opt.value)">
            {{ opt.label }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- 搜索框（抢占剩余空间） -->
      <div class="relative flex-1 min-w-[140px]">
        <SearchIcon class="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="keyword" placeholder="搜索模板名称" class="h-8 pl-8 pr-7 text-xs" />
        <button v-if="keyword" type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="清空搜索" @click="keyword = ''">
          <XIcon class="size-3.5" />
        </button>
      </div>

      <!-- 管理入口 -->
      <Button variant="outline" size="sm" class="h-8 text-xs shrink-0" @click="goManageTemplates">
        <SettingsIcon class="size-3.5 mr-1" />
        我的模板
      </Button>
    </div>

    <!-- 加载状态 -->
    <div v-if="status === 'pending'" class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <div v-for="i in 6" :key="i" class="h-20 rounded-lg border bg-muted/30 animate-pulse" />
    </div>

    <!-- 空状态 -->
    <div v-else-if="!templates.length" class="flex flex-col items-center justify-center py-10 text-muted-foreground">
      <FileTextIcon class="size-10 mb-2 opacity-40" />
      <p class="text-sm">{{ emptyText }}</p>
      <Button v-if="currentScope === 'user'" variant="link" size="sm" class="h-auto mt-1 p-0 text-xs"
        @click="goManageTemplates">
        去上传 →
      </Button>
    </div>

    <!-- 模板卡片网格 -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <button v-for="tpl in templates" :key="tpl.id" type="button" :class="[
        'group relative flex items-start gap-3 rounded-xl border p-4 text-left transition-all overflow-hidden',
        'hover:border-primary/60 hover:shadow-md hover:-translate-y-0.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selectedTemplateId === tpl.id
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border bg-card',
      ]" @click="selectTemplate(tpl.id)">
        <!-- 右上角：来源徽标 + 已选标记 -->
        <div class="absolute top-2 right-2 flex items-center gap-1">
          <span :class="[
            'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
            tpl.scope === 'user'
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
              : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200',
          ]">
            {{ tpl.scope === 'user' ? '我的' : '系统' }}
          </span>
          <span v-if="selectedTemplateId === tpl.id" class="inline-flex items-center text-primary">
            <CheckIcon class="size-3.5" />
          </span>
        </div>

        <!-- 左侧图标容器 -->
        <div :class="[
          'flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors',
          selectedTemplateId === tpl.id
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary',
        ]">
          <FileTextIcon class="size-5" />
        </div>

        <!-- 主内容：名称 + 描述（为右上角标签预留宽度） -->
        <div class="flex-1 min-w-0 space-y-1 pr-16">
          <span class="block text-sm font-medium leading-tight line-clamp-2">{{ tpl.name }}</span>
          <p v-if="tpl.description" class="text-xs text-muted-foreground line-clamp-1">
            {{ tpl.description }}
          </p>
        </div>
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
import {
  CheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
} from 'lucide-vue-next'
import { refDebounced } from '@vueuse/core'
import { DOCUMENT_CATEGORIES, type DocumentCategoryKey } from '#shared/types/document'
import { useApi } from '~/composables/useApi'

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

const SCOPE_OPTIONS: { value: ScopeFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'user', label: '我的' },
  { value: 'global', label: '公共' },
]

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
const keyword = ref('')
const debouncedKeyword = refDebounced(keyword, 300)

// 拉取模板列表（scope=all 时不传 scope，让 API 返回 global + 自己的 user 模板）
const queryParams = computed(() => {
  const q: Record<string, string> = { category: currentCategory.value }
  if (currentScope.value !== 'all') q.scope = currentScope.value
  const kw = debouncedKeyword.value.trim()
  if (kw) q.q = kw
  return q
})

const { data: listData, status, refresh } = useApi<ListTemplatesResponse>(
  '/api/v1/assistant/document/templates',
  { query: queryParams },
)

const templates = computed(() => listData.value?.list ?? [])

const currentCategoryLabel = computed(
  () => DOCUMENT_CATEGORIES.find(c => c.key === currentCategory.value)?.label ?? '选择分类',
)

const currentScopeLabel = computed(
  () => SCOPE_OPTIONS.find(o => o.value === currentScope.value)?.label ?? '全部',
)

const emptyText = computed(() => {
  if (debouncedKeyword.value.trim()) return '没有匹配的模板，试试其他关键词'
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

function onScopeChange(val: ScopeFilter) {
  currentScope.value = val
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
