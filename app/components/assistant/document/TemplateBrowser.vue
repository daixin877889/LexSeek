<script setup lang="ts">
/**
 * 文书生成首页 - 文书模板 Tab 内容
 *
 * - 顶部工具栏：关键词搜索（来源筛选/管理入口由父组件放在页面 header）
 * - 下方按分类全部摊开，每个分类一个分组；有命中才展示
 * - 点击卡片触发 @select(templateId)，由上层创建草稿并跳转
 */
import { FileTextIcon, SearchIcon, XIcon } from 'lucide-vue-next'
import { refDebounced } from '@vueuse/core'
import {
    DOCUMENT_CATEGORIES,
    type TemplateScopeFilter,
} from '#shared/types/document'
import AssistantDocumentTemplateCard from '~/components/assistant/document/TemplateCard.vue'
import { useApi } from '~/composables/useApi'

interface TemplateItem {
    id: number
    name: string
    description?: string | null
    category: string
    scope: 'global' | 'user'
}

interface ListResp {
    list: TemplateItem[]
    total: number
    skip: number
    take: number
}

const emit = defineEmits<{ select: [templateId: number] }>()

// 来源筛选由父组件 v-model:scope 控制；默认 all
const scope = defineModel<TemplateScopeFilter>('scope', { default: 'all' })

const keyword = ref('')
const debouncedKeyword = refDebounced(keyword, 300)

const queryParams = computed(() => {
    // 后端 take 上限 100；当前模板总量远低于此阈值，足够一次性拉完
    const q: Record<string, string | number> = { take: 100 }
    if (scope.value !== 'all') q.scope = scope.value
    const kw = debouncedKeyword.value.trim()
    if (kw) q.q = kw
    return q
})

const { data, status } = useApi<ListResp>(
    '/api/v1/assistant/document/templates',
    { query: queryParams },
)

const groups = computed(() => {
    const all = data.value?.list ?? []
    return DOCUMENT_CATEGORIES
        .map(cat => ({ cat, items: all.filter((t: TemplateItem) => t.category === cat.key) }))
        .filter(g => g.items.length > 0)
})

const isEmpty = computed(
    () => status.value !== 'pending' && groups.value.length === 0,
)
</script>

<template>
    <div class="space-y-5">
        <!-- 工具栏：仅搜索（scope/管理按钮已上提到 index.vue 页面 header） -->
        <div class="flex flex-wrap items-center gap-3">
            <div class="relative flex-1 min-w-[160px] max-w-md">
                <SearchIcon
                    class="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                    v-model="keyword"
                    placeholder="搜索模板名称"
                    class="h-8 pl-8 pr-7 text-xs"
                />
                <button
                    v-if="keyword"
                    type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="清空搜索"
                    @click="keyword = ''"
                >
                    <XIcon class="size-3.5" />
                </button>
            </div>
        </div>

        <!-- 加载态 -->
        <div
            v-if="status === 'pending'"
            class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
        >
            <div
                v-for="i in 6"
                :key="i"
                class="h-20 rounded-xl border bg-muted/30 animate-pulse"
            />
        </div>

        <!-- 空态 -->
        <div
            v-else-if="isEmpty"
            class="flex flex-col items-center justify-center py-10 text-muted-foreground"
        >
            <FileTextIcon class="size-10 mb-2 opacity-40" />
            <p class="text-sm">
                {{ debouncedKeyword.trim() ? '没有匹配的模板，试试其他关键词' : '暂无模板' }}
            </p>
        </div>

        <!-- 分类分组 -->
        <section
            v-for="g in groups"
            :key="g.cat.key"
            class="space-y-2"
        >
            <h3 class="text-sm font-semibold text-foreground/80 flex items-baseline gap-1.5">
                {{ g.cat.label }}
                <span class="text-xs text-muted-foreground font-normal">{{ g.items.length }}</span>
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <AssistantDocumentTemplateCard
                    v-for="tpl in g.items"
                    :key="tpl.id"
                    :template="tpl"
                    @click="emit('select', tpl.id)"
                />
            </div>
        </section>
    </div>
</template>
