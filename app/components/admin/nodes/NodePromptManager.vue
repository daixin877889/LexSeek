<template>
    <!-- 节点弹框「提示词」tab：按 type 分组 + 同组内拖拽排序 + 底部按钮 -->
    <div class="flex flex-col gap-3 h-full min-h-0">
        <!-- 顶部说明 -->
        <p class="text-xs text-muted-foreground shrink-0">
            已挂载 {{ localPrompts.length }} 段提示词，按分组装配到 LLM 调用的不同位置；只能在同一分组内拖拽。
        </p>

        <!-- 空态 -->
        <div v-if="localPrompts.length === 0"
            class="flex-1 min-h-0 flex flex-col items-center justify-center border rounded-md py-10 text-center text-sm text-muted-foreground">
            <FileText class="h-8 w-8 mb-2 text-muted-foreground/50" />
            <p>该节点尚未挂载提示词</p>
            <p class="text-xs mt-1">可点击下方「+ 添加」从提示词库挂载，或「+ 新建」创建一段新的</p>
        </div>

        <!-- 分组列表（仅渲染有挂载的分组） -->
        <div v-else class="flex-1 min-h-0 border rounded-md overflow-y-auto bg-card">
            <template v-for="group in visibleGroups" :key="group.type">
                <!-- 分组标题（sticky） -->
                <div
                    class="sticky top-0 z-[1] flex flex-wrap items-center gap-x-2 gap-y-1 bg-muted/80 backdrop-blur px-3 py-1.5 border-b text-xs"
                >
                    <span class="font-semibold text-foreground">{{ group.label }}</span>
                    <span class="text-muted-foreground">· {{ groupRefs[group.type].length }} 段</span>
                    <span class="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-[10px]">
                        {{ group.position }}
                    </span>
                </div>

                <!-- 该组拖拽列表（每组独立 group name，互不连通） -->
                <VueDraggable
                    v-model="groupRefs[group.type]"
                    :animation="200"
                    handle=".drag-handle"
                    ghost-class="opacity-50"
                    :group="`prompt-${group.type}`"
                    class="divide-y"
                    @end="onReorder(group.type)"
                >
                    <div
                        v-for="p in groupRefs[group.type]"
                        :key="p.id"
                        class="flex items-center gap-3 p-3 bg-card"
                    >
                        <!-- 拖拽手柄 -->
                        <div class="drag-handle cursor-grab active:cursor-grabbing shrink-0 text-muted-foreground">
                            <GripVertical class="size-4" />
                        </div>

                        <!-- 序号 -->
                        <span class="w-12 shrink-0 text-center font-mono text-xs text-muted-foreground">
                            {{ p.displayOrder }}
                        </span>

                        <!-- 名称 / 副标题 -->
                        <div class="flex-1 min-w-0">
                            <div class="font-medium text-sm truncate">{{ p.title || p.name }}</div>
                            <div class="text-xs text-muted-foreground font-mono truncate">
                                {{ p.name }} · {{ p.version }} · 被 {{ p.referencedByCount }} 个节点引用
                            </div>
                        </div>

                        <!-- 类型 Badge -->
                        <Badge variant="outline" class="shrink-0">
                            {{ getPromptTypeLabel(p.type) }}
                        </Badge>

                        <!-- 状态 Badge -->
                        <Badge :variant="p.status === 1 ? 'default' : 'secondary'" class="shrink-0">
                            {{ p.status === 1 ? '生效' : '未生效' }}
                        </Badge>

                        <!-- 操作按钮 -->
                        <Button
                            variant="ghost"
                            size="sm"
                            class="shrink-0"
                            title="在新窗口查看 / 编辑该提示词"
                            @click="openPromptDetail(p.id)"
                        >
                            <Pencil class="size-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            class="shrink-0 text-destructive hover:text-destructive"
                            title="从该节点移除"
                            @click="onRemove(p)"
                        >
                            <Trash2 class="size-4" />
                        </Button>
                    </div>
                </VueDraggable>
            </template>
        </div>

        <!-- 底部按钮 -->
        <div class="flex flex-wrap items-center gap-2 shrink-0">
            <Button size="sm" @click="showSelector = true">
                <Plus class="size-4 mr-1" />
                添加
            </Button>
            <Button
                ref="createBtnRef"
                variant="outline"
                size="sm"
                @click="onClickCreate"
            >
                <FilePlus class="size-4 mr-1" />
                新建
            </Button>
            <Button
                variant="outline"
                size="sm"
                class="ml-auto"
                @click="openPreview"
            >
                <Eye class="size-4 mr-1" />
                查看完整 prompt 预览
            </Button>
        </div>

        <!-- 「+ 添加」嵌套对话框 -->
        <NodePromptSelector
            v-model:open="showSelector"
            :exclude-prompt-ids="excludePromptIds"
            :nested-z-index="200"
            @confirmed="onSelectorConfirmed"
        />

        <!-- 「+ 新建」嵌套对话框 -->
        <PromptFormDialog
            ref="createDialogRef"
            v-model:open="showCreate"
            :nested-z-index="200"
            @created="onCreated"
        />

        <!-- 完整 system prompt 预览 Sheet -->
        <Sheet v-model:open="showPreview">
            <SheetContent
                class="w-full sm:max-w-[800px] flex flex-col gap-0 z-[200]"
                overlay-class="z-[200]"
            >
                <SheetHeader class="border-b pb-4">
                    <SheetTitle>System prompt 拼装预览</SheetTitle>
                    <SheetDescription>
                        共 {{ preview?.promptCount ?? 0 }} 段 prompt，按 displayOrder 升序拼接。模板变量（如 {{ VARIABLE_PLACEHOLDER_HINT }}）用占位值预览。
                    </SheetDescription>
                </SheetHeader>
                <div class="flex-1 overflow-y-auto py-4 px-4">
                    <div v-if="previewLoading"
                        class="flex items-center justify-center py-8 text-sm text-muted-foreground">
                        <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                        加载中...
                    </div>
                    <pre v-else
                        class="text-xs whitespace-pre-wrap break-words bg-muted/50 rounded p-4 font-mono">{{ preview?.systemPromptPreview || '（暂无可预览的 system prompt）' }}</pre>
                </div>
            </SheetContent>
        </Sheet>
    </div>
</template>

<script setup lang="ts">
import { Eye, FilePlus, FileText, GripVertical, Loader2, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import { VueDraggable } from 'vue-draggable-plus'
import { toast } from 'vue-sonner'
import type { NodePromptRef, PromptType } from '#shared/types/node'
import NodePromptSelector from '~/components/admin/nodes/NodePromptSelector.vue'
import PromptFormDialog from '~/components/admin/prompts/PromptFormDialog.vue'
import { useApiFetch } from '~/composables/useApiFetch'

const props = defineProps<{
    /** 当前节点 ID（用于预览接口、嵌套对话框上下文） */
    nodeId: number
    /** 父组件传入的初始已挂提示词列表（来自 GET /admin/nodes/:id 返回的 prompts 字段） */
    prompts: NodePromptRef[]
}>()

const emit = defineEmits<{
    /** 列表本地变更（add / remove / reorder）→ 父组件保存时统一提交 PATCH */
    'update:staged-changes': [changes: { promptId: number; displayOrder: number }[]]
}>()

/** 模板变量占位提示文案（拼成字符串避开 Vue 模板对 \{\{xxx\}\} 的二次解释） */
const VARIABLE_PLACEHOLDER_HINT = `${'{{'}caseId${'}}'}`

/**
 * 分组定义：决定渲染顺序、分组标题、装配位置说明。
 * 顺序与后端拼装顺序一致：system → user_injection → user → assistant。
 */
const PROMPT_TYPE_GROUPS: Array<{
    type: PromptType
    label: string
    position: string
}> = [
    { type: 'system', label: '系统提示词', position: '→ 装配到 system message' },
    { type: 'user_injection', label: '每轮隐藏注入', position: '→ 每轮紧贴最新用户消息前注入' },
    { type: 'user', label: '用户触发消息', position: '→ UI 触发时模拟用户发送' },
    { type: 'assistant', label: '预设助手消息', position: '→ 罕用，预设 AI 回复' },
]

/** 类型 → 行内 Badge 短标签 */
const PROMPT_TYPE_LABELS: Record<string, string> = {
    system: '系统',
    user: '用户',
    user_injection: '每轮注入',
    assistant: '助手',
}
function getPromptTypeLabel(type: string) {
    return PROMPT_TYPE_LABELS[type] ?? type
}

/**
 * 按 type 分桶的本地列表。每个 type 一个独立数组，VueDraggable 各自绑定一个，
 * 用 unique group name（`prompt-<type>`）阻止跨组拖拽。
 */
const groupRefs = reactive<Record<PromptType, NodePromptRef[]>>({
    system: [],
    user_injection: [],
    user: [],
    assistant: [],
})

/** 全部 localPrompts 派生（用于排除集合 / 计数 / 空态判断） */
const localPrompts = computed<NodePromptRef[]>(() => [
    ...groupRefs.system,
    ...groupRefs.user_injection,
    ...groupRefs.user,
    ...groupRefs.assistant,
])

/** 仅渲染有挂载的分组 */
const visibleGroups = computed(() =>
    PROMPT_TYPE_GROUPS.filter(g => groupRefs[g.type].length > 0),
)

/** 父组件 prompts 变更时同步进各 type 桶（按 displayOrder 升序排好） */
watch(
    () => props.prompts,
    (next) => {
        const buckets: Record<PromptType, NodePromptRef[]> = {
            system: [],
            user_injection: [],
            user: [],
            assistant: [],
        }
        for (const p of next) {
            const t = p.type as PromptType
            if (t in buckets) {
                buckets[t].push({ ...p })
            }
        }
        for (const t of Object.keys(buckets) as PromptType[]) {
            buckets[t].sort((a, b) => a.displayOrder - b.displayOrder)
            groupRefs[t] = buckets[t]
        }
    },
    { immediate: true, deep: false },
)

/** 把所有 type 桶 flat 后通知父组件 */
function notifyStaged() {
    const flat: { promptId: number; displayOrder: number }[] = []
    for (const t of Object.keys(groupRefs) as PromptType[]) {
        for (const p of groupRefs[t]) {
            flat.push({ promptId: p.id, displayOrder: p.displayOrder })
        }
    }
    emit('update:staged-changes', flat)
}

/**
 * 拖拽结束（同组）：仅重新分配该组的 displayOrder（100, 200, 300...），
 * 不动其他组。VueDraggable 已经在 v-model 上 in-place 调整了顺序。
 */
function onReorder(type: PromptType) {
    groupRefs[type] = groupRefs[type].map((p, idx) => ({
        ...p,
        displayOrder: (idx + 1) * 100,
    }))
    notifyStaged()
}

/** 移除某行 */
function onRemove(p: NodePromptRef) {
    const t = p.type as PromptType
    if (t in groupRefs) {
        groupRefs[t] = groupRefs[t].filter(x => x.id !== p.id)
        notifyStaged()
    }
}

/** 跳转到提示词详情（新窗口） */
function openPromptDetail(promptId: number) {
    window.open(`/admin/prompts/${promptId}`, '_blank')
}

// ==================== 「+ 添加」嵌套对话框 ====================

const showSelector = ref(false)

/** 已挂 prompt id 集合（传给 selector 用作排除） */
const excludePromptIds = computed(() => localPrompts.value.map(p => p.id))

/**
 * 选择器确认：把选中的 prompts 追加到对应 type 桶，
 * displayOrder 从该桶当前最大值递增 100。
 */
function onSelectorConfirmed(items: NodePromptRef[]) {
    if (items.length === 0) return
    let added = false
    for (const p of items) {
        const t = p.type as PromptType
        if (!(t in groupRefs)) continue
        const maxOrder = groupRefs[t].reduce((m, x) => Math.max(m, x.displayOrder), 0)
        groupRefs[t] = [...groupRefs[t], { ...p, displayOrder: maxOrder + 100 }]
        added = true
    }
    if (added) notifyStaged()
}

// ==================== 「+ 新建」嵌套对话框 ====================

const showCreate = ref(false)
const createBtnRef = ref<unknown>(null)
const createDialogRef = ref<InstanceType<typeof PromptFormDialog> | null>(null)

/** 点击按钮：通过 ref 触发 openCreate，确保 isEdit=false + 表单清空 */
function onClickCreate() {
    showCreate.value = true
    nextTick(() => {
        createDialogRef.value?.openCreate?.()
    })
}

/** 嵌套保存成功 → 拉新 prompt 详情 → 加入对应 type 桶 → 关闭 + 显式恢复焦点 */
async function onCreated(newPromptId: number) {
    const resp = await useApiFetch<{
        id: number
        name: string
        title: string | null
        type: string
        status: number
        version: string
        referencedByCount: number
    }>(`/api/v1/admin/prompts/${newPromptId}`)
    if (resp) {
        const t = resp.type as PromptType
        if (t in groupRefs) {
            const maxOrder = groupRefs[t].reduce((m, x) => Math.max(m, x.displayOrder), 0)
            groupRefs[t] = [
                ...groupRefs[t],
                {
                    id: resp.id,
                    name: resp.name,
                    title: resp.title,
                    type: resp.type,
                    status: resp.status,
                    version: resp.version,
                    displayOrder: maxOrder + 100,
                    referencedByCount: resp.referencedByCount,
                },
            ]
            notifyStaged()
        }
    } else {
        toast.error('获取新提示词信息失败')
    }
    showCreate.value = false
    // 显式恢复焦点到「+ 新建」按钮，避免焦点丢到 body 后 Tab 键无法循环
    await nextTick()
    const btn = createBtnRef.value as { $el?: HTMLElement } | HTMLElement | null
    if (btn) {
        const el = (btn as { $el?: HTMLElement }).$el ?? (btn as HTMLElement)
        el?.focus?.()
    }
}

// ==================== 完整 system prompt 预览 Sheet ====================

const showPreview = ref(false)
const previewLoading = ref(false)
const preview = ref<{ systemPromptPreview: string; promptCount: number } | null>(null)

async function openPreview() {
    showPreview.value = true
    previewLoading.value = true
    preview.value = null
    try {
        let resp: { systemPromptPreview: string; promptCount: number } | null = null
        if (props.nodeId > 0) {
            // 编辑场景：调节点级 preview，由后端从 nodeConfig 拼装
            resp = await useApiFetch<{ systemPromptPreview: string; promptCount: number }>(
                `/api/v1/admin/nodes/${props.nodeId}/prompts/preview`,
            )
        } else {
            // 新建场景：还没有 nodeId，把本地暂存的 staged prompts 直接交给 preview-bundle 拼装
            resp = await useApiFetch<{ systemPromptPreview: string; promptCount: number }>(
                '/api/v1/admin/prompts/preview-bundle',
                {
                    method: 'POST',
                    body: {
                        prompts: localPrompts.value.map(p => ({
                            promptId: p.id,
                            displayOrder: p.displayOrder,
                        })),
                    },
                },
            )
        }
        if (resp) {
            preview.value = resp
        } else {
            toast.error('加载预览失败')
        }
    } finally {
        previewLoading.value = false
    }
}
</script>
