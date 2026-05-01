<script setup lang="ts">
/**
 * 文书模板选择 interrupt 卡片（Mockup A / A2）
 *
 * 来自子代理 draft_document 工具：
 * - 默认状态：上半部分显示后端推荐 3-5 个模板（第一个预选）+ "▾ 没找到？浏览全部 N 个模板"
 * - 展开状态：推荐区可折叠 + 搜索框 + 分类下拉 + 全库列表（GET /api/v1/assistant/document/templates）
 * - 零召回兜底：payload.recommendations 为空时直接进入展开状态
 *
 * onResolve({ templateId } | null) 由父级回填到 LangGraph resume。
 */
import { refDebounced } from '@vueuse/core'
import {
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    FileText,
    Loader2,
    Pause,
    Search,
    X,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '~/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Input } from '~/components/ui/input'
import { useApiFetch } from '~/composables/useApiFetch'
import {
    DOCUMENT_CATEGORIES,
    type DocumentCategoryKey,
} from '#shared/types/document'

interface RecommendedTemplate {
    id: number
    name: string
    description?: string | null
    category?: string
    scope?: 'global' | 'user'
}

/**
 * LangGraph interrupt() 在 createAgent 路径下传入的对象会被 useStreamChat
 * 通过 `__interrupt__[0].value` 暴露 — 所有字段平铺，**没有 payload 中间层**
 * （与 server/services/agent-platform/tools/draftDocument.tool.ts 的
 * `interrupt({ type, toolCallId, recommendations, total, intent, ... })` 保持一致）。
 */
interface TemplateInterrupt {
    type: 'template_select'
    toolCallId?: string
    /** 后端推荐的 3-5 个候选模板 */
    recommendations?: RecommendedTemplate[]
    /** 全库模板总数（给"浏览全部 N 个模板"显示用） */
    total?: number
    /** LLM 解析出的用户意图（卡片标题副文案） */
    intent?: string
    /** 默认分类提示（展开后预选） */
    categoryHint?: DocumentCategoryKey
    /** keyword 透传（plan 中的"LLM 提炼关键词"） */
    keywords?: string[]
    fallbackToRecency?: boolean
}

interface ResolveValue {
    templateId: number
}

interface BrowseTemplate {
    id: number
    name: string
    description?: string | null
    category: string
    scope: 'global' | 'user'
}

interface BrowseResponse {
    list: BrowseTemplate[]
    total: number
    skip: number
    take: number
}

const props = defineProps<{
    interrupt: TemplateInterrupt
    onResolve?: (value: ResolveValue | null) => Promise<void> | void
    /** snapshot 模式：传入用户之前 resolve 的值；undefined = active 模式 */
    resumeValue?: ResolveValue | null
}>()

const isSnapshot = computed(() => props.resumeValue !== undefined)

const recommendations = computed<RecommendedTemplate[]>(
    () => props.interrupt.recommendations ?? [],
)
const totalAll = computed<number>(() => props.interrupt.total ?? 0)

// 默认选中：snapshot 模式回填 resumeValue.templateId，否则第一个推荐
const selectedId = ref<number | null>(
    isSnapshot.value && props.resumeValue?.templateId !== undefined
        ? props.resumeValue.templateId
        : recommendations.value[0]?.id ?? null,
)

// 零召回兜底 → 直接进入展开状态
const expanded = ref<boolean>(recommendations.value.length === 0)
// 展开后推荐区是否折叠（参见 Mockup A2 的 "▴ 收起"）
const recoCollapsed = ref<boolean>(false)

const submitting = ref(false)
const confirmed = ref(false)

// 浏览态搜索 + 分类
const ALL_CATEGORY_KEY = '__all__'
const currentCategory = ref<string>(
    props.interrupt.categoryHint ?? ALL_CATEGORY_KEY,
)
const keyword = ref('')
const debouncedKeyword = refDebounced(keyword, 300)

const browseTemplates = ref<BrowseTemplate[]>([])
const browseLoading = ref(false)
const browseLoaded = ref(false)

const currentCategoryLabel = computed(() => {
    if (currentCategory.value === ALL_CATEGORY_KEY) return '全部'
    return (
        DOCUMENT_CATEGORIES.find((c) => c.key === currentCategory.value)?.label
        ?? '全部'
    )
})

async function fetchBrowseList() {
    browseLoading.value = true
    try {
        const query: Record<string, string> = {}
        if (currentCategory.value !== ALL_CATEGORY_KEY) {
            query.category = currentCategory.value
        }
        const kw = debouncedKeyword.value.trim()
        if (kw) query.q = kw
        // 法律助手默认混合显示 global + user 模板（不传 scope）
        const data = await useApiFetch<BrowseResponse>(
            '/api/v1/assistant/document/templates',
            { query },
        )
        if (data?.list) {
            browseTemplates.value = data.list
        } else {
            browseTemplates.value = []
        }
        browseLoaded.value = true
    } catch (err) {
        const msg = err instanceof Error ? err.message : '加载模板失败'
        toast.error(msg)
    } finally {
        browseLoading.value = false
    }
}

// 进入展开状态时拉一次列表
watch(expanded, (val) => {
    if (val && !browseLoaded.value) {
        void fetchBrowseList()
    }
})

// 分类 / 搜索变化时重拉
watch([currentCategory, debouncedKeyword], () => {
    if (expanded.value) {
        void fetchBrowseList()
    }
})

// 零召回兜底场景：组件挂载时立即拉取
onMounted(() => {
    if (expanded.value && !browseLoaded.value) {
        void fetchBrowseList()
    }
})

function selectTemplate(id: number) {
    if (submitting.value || confirmed.value) return
    selectedId.value = id
}

function onCategoryChange(key: string) {
    currentCategory.value = key
}

function clearKeyword() {
    keyword.value = ''
}

function toggleExpanded() {
    expanded.value = !expanded.value
    if (!expanded.value) {
        // 收回展开状态时把推荐区重新展开（避免上次折叠态下次再打开还是折叠）
        recoCollapsed.value = false
    }
}

function toggleRecoCollapsed() {
    recoCollapsed.value = !recoCollapsed.value
}

const selectedTemplateName = computed(() => {
    if (!selectedId.value) return ''
    const fromReco = recommendations.value.find((t) => t.id === selectedId.value)
    if (fromReco) return fromReco.name
    const fromBrowse = browseTemplates.value.find((t) => t.id === selectedId.value)
    return fromBrowse?.name ?? ''
})

async function handleSubmit() {
    if (submitting.value || confirmed.value) return
    if (!selectedId.value) {
        toast.error('请先选择一个模板')
        return
    }
    submitting.value = true
    try {
        await props.onResolve?.({ templateId: selectedId.value })
        confirmed.value = true
    } catch (err) {
        const msg = err instanceof Error ? err.message : '提交失败，请重试'
        toast.error(msg)
    } finally {
        submitting.value = false
    }
}

async function handleCancel() {
    if (submitting.value || confirmed.value) return
    submitting.value = true
    try {
        await props.onResolve?.(null)
        confirmed.value = true
    } catch (err) {
        const msg = err instanceof Error ? err.message : '取消失败'
        toast.error(msg)
    } finally {
        submitting.value = false
    }
}

// snapshot 模式：mount 时即视为 confirmed（复用现有 confirmed 视觉）。
// 用 watch + immediate 而非 setup 阶段一次性 if：避免组件先以 active mode mount
// （resumeValue 还是 undefined）后，resolved 状态到来 prop 变成 isSnapshot=true 时
// confirmed 没被同步翻成 true，按钮一直显示——即 user 反馈"使用此模板点了卡片状态没变"。
watch(isSnapshot, (snap) => {
    if (snap) confirmed.value = true
}, { immediate: true })

// active 模式首次 mount 滚到视口（snapshot 不滚——用户已在历史里）
const cardRef = ref<HTMLElement | null>(null)
onMounted(() => {
    if (isSnapshot.value) return
    nextTick(() => {
        cardRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
})
</script>

<template>
    <div
        ref="cardRef"
        :class="[
            'not-prose my-2 w-full max-w-lg rounded-lg border p-4 shadow-sm',
            isSnapshot
                ? 'border-muted bg-muted/20 opacity-70 dark:border-muted dark:bg-muted/10'
                : 'border-amber-300/60 bg-amber-50/60 dark:border-amber-700/60 dark:bg-amber-950/30',
        ]"
    >
        <!-- 标题 -->
        <div class="mb-3 flex items-center gap-2">
            <Pause class="size-4 text-amber-600 dark:text-amber-400" />
            <p class="text-sm font-medium text-foreground">请选择文书模板</p>
        </div>

        <!-- 推荐区（默认展示；展开态下可折叠） -->
        <div v-if="recommendations.length" class="mb-3">
            <div v-if="expanded && !isSnapshot" class="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>── 推荐 ──</span>
                <button
                    type="button"
                    class="inline-flex items-center gap-0.5 hover:text-foreground"
                    @click="toggleRecoCollapsed"
                >
                    <ChevronUp v-if="!recoCollapsed" class="size-3" />
                    <ChevronDown v-else class="size-3" />
                    {{ recoCollapsed ? '展开' : '收起' }}
                </button>
            </div>

            <div v-show="!recoCollapsed" class="space-y-1.5">
                <button
                    v-for="tpl in recommendations"
                    :key="tpl.id"
                    type="button"
                    :disabled="submitting || confirmed"
                    :class="[
                        'flex w-full items-start gap-2 rounded-md border p-2.5 text-left transition-colors',
                        selectedId === tpl.id
                            ? 'border-primary bg-primary/5'
                            : 'border-border bg-card hover:border-primary/40',
                        (submitting || confirmed) && 'cursor-not-allowed opacity-60',
                    ]"
                    @click="selectTemplate(tpl.id)"
                >
                    <div
                        :class="[
                            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                            selectedId === tpl.id
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-muted-foreground/40',
                        ]"
                    >
                        <Check v-if="selectedId === tpl.id" class="size-3" />
                    </div>
                    <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium text-foreground">{{ tpl.name }}</p>
                        <p
                            v-if="tpl.description"
                            class="mt-0.5 line-clamp-1 text-xs text-muted-foreground"
                        >
                            {{ tpl.description }}
                        </p>
                    </div>
                </button>
            </div>
        </div>

        <!-- "浏览全部" 切换按钮 -->
        <button
            v-if="!expanded && !isSnapshot"
            type="button"
            class="mb-3 inline-flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/40 bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            :disabled="submitting || confirmed"
            @click="toggleExpanded"
        >
            <ChevronDown class="size-3.5" />
            <span v-if="recommendations.length">没找到？浏览全部 {{ totalAll || '更多' }} 个模板</span>
            <span v-else>未找到合适推荐，浏览全部模板</span>
        </button>

        <!-- 展开状态：搜索 + 分类 + 全库列表 -->
        <div v-if="expanded && !isSnapshot" class="space-y-3">
            <div class="flex flex-wrap items-center gap-2">
                <!-- 搜索框 -->
                <div class="relative min-w-[140px] flex-1">
                    <Search class="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        v-model="keyword"
                        placeholder="搜索模板名称"
                        class="h-8 pl-8 pr-7 text-xs"
                        :disabled="submitting || confirmed"
                    />
                    <button
                        v-if="keyword"
                        type="button"
                        class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label="清空搜索"
                        @click="clearKeyword"
                    >
                        <X class="size-3.5" />
                    </button>
                </div>

                <!-- 分类下拉 -->
                <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                        <Button
                            variant="outline"
                            size="sm"
                            class="h-8 min-w-[120px] justify-between text-xs"
                            :disabled="submitting || confirmed"
                        >
                            <span class="truncate">
                                <span class="mr-1 text-muted-foreground">分类：</span>{{ currentCategoryLabel }}
                            </span>
                            <ChevronDown class="ml-1 size-3.5 shrink-0 opacity-60" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" class="max-h-[60vh] w-56 overflow-auto">
                        <DropdownMenuItem
                            :class="currentCategory === ALL_CATEGORY_KEY ? 'bg-accent' : ''"
                            @click="onCategoryChange(ALL_CATEGORY_KEY)"
                        >
                            全部
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            v-for="cat in DOCUMENT_CATEGORIES"
                            :key="cat.key"
                            :class="cat.key === currentCategory ? 'bg-accent' : ''"
                            @click="onCategoryChange(cat.key)"
                        >
                            {{ cat.label }}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                <!-- 收起浏览态（仅在有推荐时才允许收起） -->
                <Button
                    v-if="recommendations.length"
                    variant="ghost"
                    size="sm"
                    class="h-8 text-xs"
                    :disabled="submitting || confirmed"
                    @click="toggleExpanded"
                >
                    <ChevronUp class="mr-0.5 size-3.5" />
                    收起
                </Button>
            </div>

            <!-- 列表 -->
            <div class="max-h-64 overflow-auto rounded-md border bg-card">
                <div v-if="browseLoading" class="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
                    <Loader2 class="size-3.5 animate-spin" />
                    加载中...
                </div>
                <div
                    v-else-if="!browseTemplates.length"
                    class="flex flex-col items-center justify-center gap-1 p-6 text-xs text-muted-foreground"
                >
                    <FileText class="size-5 opacity-40" />
                    <span>没有匹配的模板</span>
                </div>
                <ul v-else class="divide-y">
                    <li
                        v-for="tpl in browseTemplates"
                        :key="tpl.id"
                    >
                        <button
                            type="button"
                            :disabled="submitting || confirmed"
                            :class="[
                                'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
                                selectedId === tpl.id
                                    ? 'bg-primary/5'
                                    : 'hover:bg-muted/40',
                                (submitting || confirmed) && 'cursor-not-allowed opacity-60',
                            ]"
                            @click="selectTemplate(tpl.id)"
                        >
                            <div
                                :class="[
                                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                                    selectedId === tpl.id
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'border-muted-foreground/40',
                                ]"
                            >
                                <Check v-if="selectedId === tpl.id" class="size-3" />
                            </div>
                            <div class="min-w-0 flex-1">
                                <p class="truncate text-sm text-foreground">{{ tpl.name }}</p>
                                <p
                                    v-if="tpl.description"
                                    class="mt-0.5 line-clamp-1 text-xs text-muted-foreground"
                                >
                                    {{ tpl.description }}
                                </p>
                            </div>
                            <span
                                :class="[
                                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                                    tpl.scope === 'user'
                                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
                                        : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200',
                                ]"
                            >
                                {{ tpl.scope === 'user' ? '我的' : '系统' }}
                            </span>
                        </button>
                    </li>
                </ul>
            </div>
        </div>

        <!-- 操作按钮 -->
        <div class="mt-4 flex items-center justify-between">
            <p v-if="confirmed" class="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 class="size-3.5" />
                {{ isSnapshot && resumeValue === null ? '已取消' : `已选模板：${selectedTemplateName || '已确认'}` }}
            </p>
            <p v-else-if="selectedTemplateName" class="truncate text-xs text-muted-foreground">
                已选：<span class="text-foreground">{{ selectedTemplateName }}</span>
            </p>
            <span v-else />

            <div v-if="!confirmed" class="flex items-center gap-2">
                <Button
                    size="sm"
                    variant="ghost"
                    :disabled="submitting"
                    @click="handleCancel"
                >
                    <X class="mr-1 size-3.5" />
                    取消
                </Button>
                <Button
                    size="sm"
                    :disabled="submitting || !selectedId"
                    @click="handleSubmit"
                >
                    <Loader2 v-if="submitting" class="mr-1 size-3.5 animate-spin" />
                    使用此模板
                </Button>
            </div>
        </div>
    </div>
</template>
