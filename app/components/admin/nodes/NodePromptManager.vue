<template>
    <!-- 节点弹框「提示词」tab：列表 + 拖拽排序 + 底部按钮 -->
    <div class="flex flex-col gap-3 h-full min-h-0">
        <!-- 顶部说明 -->
        <p class="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
            <span>已挂载 {{ localPrompts.length }} 段提示词，按「序号」从小到大装配为 system prompt；可拖动</span>
            <GripVertical class="inline size-3" />
            <span>调整顺序。</span>
        </p>

        <!-- 空态 -->
        <div v-if="localPrompts.length === 0"
            class="flex-1 min-h-0 flex flex-col items-center justify-center border rounded-md py-10 text-center text-sm text-muted-foreground">
            <FileText class="h-8 w-8 mb-2 text-muted-foreground/50" />
            <p>该节点尚未挂载提示词</p>
            <p class="text-xs mt-1">可点击下方按钮从提示词库添加，或新建一段提示词</p>
        </div>

        <!-- 拖拽列表 -->
        <div v-else class="flex-1 min-h-0 border rounded-md overflow-y-auto">
            <VueDraggable
                v-model="localPrompts"
                :animation="200"
                handle=".drag-handle"
                ghost-class="opacity-50"
                class="divide-y"
                @end="onReorder"
            >
                <div
                    v-for="p in localPrompts"
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
        </div>

        <!-- 底部按钮 -->
        <div class="flex flex-wrap gap-2 shrink-0">
            <Button variant="outline" size="sm" @click="showSelector = true">
                <Plus class="size-4 mr-1" />
                从提示词库添加
            </Button>
            <Button
                ref="createBtnRef"
                variant="outline"
                size="sm"
                @click="onClickCreate"
            >
                <FilePlus class="size-4 mr-1" />
                新建提示词
            </Button>
            <Button variant="outline" size="sm" @click="openPreview">
                <Eye class="size-4 mr-1" />
                查看完整 prompt 预览
            </Button>
        </div>

        <!-- 「从提示词库添加」嵌套对话框 -->
        <NodePromptSelector
            v-model:open="showSelector"
            :exclude-prompt-ids="excludePromptIds"
            :nested-z-index="200"
            @confirmed="onSelectorConfirmed"
        />

        <!-- 「新建提示词」嵌套对话框 -->
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
import type { NodePromptRef } from '#shared/types/node'
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

/** 类型 → 中文标签 */
const PROMPT_TYPE_LABELS: Record<string, string> = {
    system: '系统',
    user: '用户',
    assistant: '助手',
}
function getPromptTypeLabel(type: string) {
    return PROMPT_TYPE_LABELS[type] ?? type
}

/** 本地维护的列表（用户编辑、拖拽、增删都改这里，保存时由父组件读出） */
const localPrompts = ref<NodePromptRef[]>([])

/** 父组件 prompts 变更时同步进本地（如打开新节点 / 重新加载） */
watch(
    () => props.prompts,
    (next) => {
        localPrompts.value = next.map(p => ({ ...p }))
    },
    { immediate: true, deep: false },
)

/** 本地变更通知父组件 */
function notifyStaged() {
    emit('update:staged-changes', localPrompts.value.map(p => ({
        promptId: p.id,
        displayOrder: p.displayOrder,
    })))
}

/** 拖拽结束：重新分配 displayOrder（100, 200, 300, ...） */
function onReorder() {
    localPrompts.value = localPrompts.value.map((p, idx) => ({
        ...p,
        displayOrder: (idx + 1) * 100,
    }))
    notifyStaged()
}

/** 移除某行 */
function onRemove(p: NodePromptRef) {
    localPrompts.value = localPrompts.value.filter(x => x.id !== p.id)
    notifyStaged()
}

/** 跳转到提示词详情（新窗口） */
function openPromptDetail(promptId: number) {
    window.open(`/admin/prompts/${promptId}`, '_blank')
}

// ==================== 「从提示词库添加」嵌套对话框 ====================

const showSelector = ref(false)

/** 已挂 prompt id 集合（传给 selector 用作排除） */
const excludePromptIds = computed(() => localPrompts.value.map(p => p.id))

/** 选择器确认：把选中的 prompts 追加到 localPrompts，displayOrder 从当前最大值递增 100 */
function onSelectorConfirmed(items: NodePromptRef[]) {
    if (items.length === 0) return
    const maxOrder = localPrompts.value.reduce((m, p) => Math.max(m, p.displayOrder), 0)
    const appended = items.map((p, idx) => ({ ...p, displayOrder: maxOrder + (idx + 1) * 100 }))
    localPrompts.value = [...localPrompts.value, ...appended]
    notifyStaged()
}

// ==================== 「新建提示词」嵌套对话框 ====================

const showCreate = ref(false)
const createBtnRef = ref<unknown>(null)
const createDialogRef = ref<InstanceType<typeof PromptFormDialog> | null>(null)

/** 点击按钮：通过 ref 触发 openCreate，确保 isEdit=false + 表单清空 */
function onClickCreate() {
    showCreate.value = true
    // 等下一帧再调，确保 v-model:open 已经把 dialog 打开
    nextTick(() => {
        createDialogRef.value?.openCreate?.()
    })
}

/** 嵌套保存成功 → 拉新 prompt 详情 → 加入列表 → 关闭 + 显式恢复焦点（plan §5.4.4 第 7 条） */
async function onCreated(newPromptId: number) {
    // GET 单条详情，转成 NodePromptRef 形态（接口返回 referencedByCount + name + version 等）
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
        const maxOrder = localPrompts.value.reduce((m, p) => Math.max(m, p.displayOrder), 0)
        localPrompts.value = [
            ...localPrompts.value,
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
    } else {
        toast.error('获取新提示词信息失败')
    }
    showCreate.value = false
    // 显式恢复焦点到「+ 新建提示词」按钮，避免焦点丢到 body 后 Tab 键无法循环
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
        const resp = await useApiFetch<{ systemPromptPreview: string; promptCount: number }>(
            `/api/v1/admin/nodes/${props.nodeId}/prompts/preview`,
        )
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
