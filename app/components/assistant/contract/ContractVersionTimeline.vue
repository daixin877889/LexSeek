<script setup lang="ts">
// 自动导入：ref/computed 不要显式 import
import { useLocalStorage } from '@vueuse/core'
import { ChevronLeft, ChevronRight, Pencil, Check, X } from 'lucide-vue-next'
import type { ContractReviewVersionEntity } from '#shared/types/contract'
import { VERSION_SYSTEM_LABEL_DISPLAY } from '#shared/types/contract'
import { useFormatters } from '~/composables/useFormatters'

const { formatDate } = useFormatters()

const props = defineProps<{
    versions: ContractReviewVersionEntity[]
    currentVersionId: number | null
    /** null = 工作区；number = 只读历史版本 */
    previewVersionId: number | null
}>()
const emit = defineEmits<{
    'select-version': [versionId: number]
    'exit-preview': []
    'update-note': [versionId: number, note: string | null]
}>()

// 时间线里实际被选中的节点：
// - 预览态（previewVersionId 非 null）→ 高亮预览的那条
// - 非预览态 → 高亮 currentVersionId（= 工作区所对应的最新版本）
// 这样页面加载时默认就有一条被高亮的节点（工作区），无需额外"返回工作区"按钮
const selectedId = computed(() => props.previewVersionId ?? props.currentVersionId)

/**
 * 点击版本节点：
 * - 点到 currentVersionId → 退出预览态（回到工作区，可编辑）
 * - 点到其他版本 → 进入只读预览态
 */
function handleClick(v: ContractReviewVersionEntity) {
    if (v.id === props.currentVersionId) {
        emit('exit-preview')
    } else {
        emit('select-version', v.id)
    }
}

const collapsed = useLocalStorage('contract-timeline-collapsed', false)

// 备注编辑态（本地，不影响服务端直到保存）
const editingNoteId = ref<number | null>(null)
const noteBuffer = ref('')

function beginEditNote(v: ContractReviewVersionEntity) {
    editingNoteId.value = v.id
    noteBuffer.value = v.lawyerNote ?? ''
}

function saveEditNote(v: ContractReviewVersionEntity) {
    emit('update-note', v.id, noteBuffer.value.trim() || null)
    editingNoteId.value = null
}

function cancelEditNote() {
    editingNoteId.value = null
}

</script>

<template>
    <aside
        :class="[
            'border-r bg-muted/30 transition-all duration-200 flex flex-col',
            collapsed ? 'w-[48px] py-3 items-center' : 'w-[220px] p-3',
        ]"
    >
        <!-- 折叠切换按钮 -->
        <button
            class="size-6 rounded border bg-background hover:border-primary flex items-center justify-center shrink-0"
            :title="collapsed ? '展开时间线' : '收起时间线'"
            @click="collapsed = !collapsed"
        >
            <ChevronRight v-if="collapsed" class="size-3" />
            <ChevronLeft v-else class="size-3" />
        </button>

        <!-- 标题（展开态） -->
        <div v-if="!collapsed" class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide my-2">
            版本时间线
        </div>

        <!-- 节点列表（节点结构内联，不拆子组件）-->
        <div
            class="flex-1 overflow-y-auto mt-2 flex flex-col"
            :class="collapsed ? 'items-center gap-3' : 'gap-0'"
        >
            <template v-for="(v, idx) in versions" :key="v.id">
                <!-- 收缩态节点 -->
                <button
                    v-if="collapsed"
                    class="flex flex-col items-center relative"
                    :title="`v${v.versionNumber} · ${VERSION_SYSTEM_LABEL_DISPLAY[v.systemLabel]} · ${formatDate(v.createdAt, 'YYYY-MM-DD')}`"
                    @click="handleClick(v)"
                >
                    <div
                        class="size-3 rounded-full"
                        :class="selectedId === v.id ? 'bg-primary ring-4 ring-primary/20' : 'bg-muted-foreground/40'"
                    />
                    <span class="text-[10px] mt-0.5" :class="selectedId === v.id ? 'font-semibold' : ''">
                        v{{ v.versionNumber }}
                    </span>
                    <div v-if="idx !== versions.length - 1" class="w-px h-4 bg-muted-foreground/30 mt-1" />
                </button>

                <!-- 展开态节点 -->
                <div
                    v-else
                    class="relative pl-5 pb-3"
                    :class="selectedId === v.id ? 'border-l-2 border-primary' : 'border-l-2 border-muted-foreground/30'"
                >
                    <div
                        class="absolute -left-[9px] top-0.5 size-4 rounded-full"
                        :class="selectedId === v.id ? 'bg-primary ring-4 ring-primary/20' : 'bg-muted-foreground/40'"
                    />
                    <div
                        class="rounded p-2 cursor-pointer"
                        :class="selectedId === v.id ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted'"
                        @click="handleClick(v)"
                    >
                        <div class="text-xs font-medium" :class="selectedId === v.id ? 'text-primary' : ''">
                            v{{ v.versionNumber }} · {{ VERSION_SYSTEM_LABEL_DISPLAY[v.systemLabel] }}
                        </div>
                        <div class="text-[11px] text-muted-foreground">{{ formatDate(v.createdAt, 'YYYY-MM-DD') }}</div>

                        <!-- 律师备注区域 -->
                        <div v-if="editingNoteId !== v.id" class="mt-1 text-[11px] text-muted-foreground">
                            <template v-if="v.lawyerNote">
                                <span class="italic">{{ v.lawyerNote }}</span>
                                <button class="ml-1 text-primary" @click.stop="beginEditNote(v)">
                                    <Pencil class="inline size-3" />
                                </button>
                            </template>
                            <button v-else class="text-primary underline text-[10px]" @click.stop="beginEditNote(v)">
                                + 加备注
                            </button>
                        </div>
                        <div v-else class="mt-1" @click.stop>
                            <Textarea
                                v-model="noteBuffer"
                                :rows="2"
                                :maxlength="200"
                                class="text-[11px]"
                            />
                            <div class="flex gap-1 mt-1">
                                <Button
                                    size="icon"
                                    class="size-6"
                                    aria-label="保存备注"
                                    data-testid="save-note"
                                    @click="saveEditNote(v)"
                                >
                                    <Check class="size-3" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    class="size-6"
                                    aria-label="取消编辑"
                                    data-testid="cancel-note"
                                    @click="cancelEditNote"
                                >
                                    <X class="size-3" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </template>
        </div>

    </aside>
</template>
