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
      <p class="text-sm">暂无模板</p>
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
        <!-- 已选标记 -->
        <span
          v-if="selectedTemplateId === tpl.id"
          class="absolute top-2 right-2 flex items-center gap-1 text-xs font-medium text-primary"
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
import { CheckIcon, FileTextIcon } from 'lucide-vue-next'
import { DOCUMENT_CATEGORIES, type DocumentCategoryKey } from '#shared/types/document'

interface TemplateItem {
  id: number
  name: string
  description?: string | null
  category: string
  scope: string
  ossFileId?: number | null
}

interface ListTemplatesResponse {
  list: TemplateItem[]
  total: number
  skip: number
  take: number
}

const props = defineProps<{
  /** 可预选分类 */
  category?: DocumentCategoryKey
  /** 作用域 */
  scope?: 'global' | 'user'
}>()

const emit = defineEmits<{
  select: [templateId: number]
}>()

// 当前选中的模板 ID（通过 v-model:template-id）
const selectedTemplateId = defineModel<number | null>('templateId', { default: null })

const currentCategory = ref<string>(props.category ?? DOCUMENT_CATEGORIES[0].key)

// 拉取模板列表
const queryParams = computed(() => {
  const q: Record<string, string> = { category: currentCategory.value }
  if (props.scope) q.scope = props.scope
  return q
})

const { data: listData, status, refresh } = useApi<ListTemplatesResponse>(
  '/api/v1/assistant/document/templates',
  { query: queryParams },
)

const templates = computed(() => listData.value?.list ?? [])

const selectedTemplateName = computed(
  () => templates.value.find((t: TemplateItem) => t.id === selectedTemplateId.value)?.name ?? '',
)

function onCategoryChange(val: string | number) {
  currentCategory.value = String(val)
  // 切换分类后清除已选（避免选了别的分类的模板）
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

// 分类变化时重新拉取（useApi query 是响应式的，无需手动 refresh）
watch(currentCategory, () => refresh())
</script>
