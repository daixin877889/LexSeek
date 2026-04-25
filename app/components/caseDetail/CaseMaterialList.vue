<template>
    <Transition name="view-fade" mode="out-in">
        <!-- 网格视图 -->
        <div v-if="viewMode === 'grid'" key="grid"
            class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
            <div v-for="m in materials" :key="m.id"
                class="group relative flex flex-col items-center p-2.5 rounded-xl bg-muted/40 hover:bg-muted/60 transition-all border text-center cursor-pointer"
                :class="cardBorderClass(m)"
                @click="handleClick(m)">
                <div v-if="isSelectMode" class="absolute top-1.5 left-1.5">
                    <Checkbox :model-value="isSelected(m.id)" class="size-4" />
                </div>
                <button v-if="canDelete"
                    class="absolute top-1 right-1 size-6 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="删除"
                    @click.stop="emit('deleteMaterial', m.id)">
                    <Trash2Icon class="size-3" />
                </button>
                <div :class="['flex items-center justify-center size-11 rounded-xl shrink-0 transition-transform group-hover:scale-105 mb-1.5', getMaterialBgColor(m.type)]">
                    <component :is="getMaterialIcon(m.type)" :class="['size-6', getMaterialIconColor(m.type)]" />
                </div>
                <div class="flex-1 min-w-0 w-full">
                    <div class="text-[12px] font-medium line-clamp-1 leading-tight mb-1 group-hover:text-primary transition-colors px-1">
                        {{ m.name }}
                    </div>
                    <div class="text-[10px] text-muted-foreground/60 flex items-center justify-center gap-1">
                        <span v-if="m.fileSize" class="shrink-0">{{ formatByteSize(m.fileSize, 0) }}</span>
                        <template v-if="statusOf(m)">
                            <span class="size-0.5 rounded-full bg-muted-foreground/30"></span>
                            <span v-if="!showRetryFor(m)" :class="statusOf(m)!.color" class="flex items-center gap-0.5">
                                <Loader2Icon v-if="statusOf(m)!.spinning" class="size-2.5 animate-spin" />
                                {{ statusOf(m)!.text }}
                            </span>
                            <button v-else
                                class="text-destructive hover:text-primary transition-colors flex items-center gap-0.5"
                                @click.stop="m.ossFileId && emit('retryMaterial', m.id, m.ossFileId)">
                                {{ statusOf(m)!.text }}
                                <RefreshCwIcon class="size-2.5" />
                            </button>
                        </template>
                    </div>
                </div>
            </div>
        </div>

        <!-- 列表视图 -->
        <div v-else key="list" class="space-y-1">
            <div v-for="m in materials" :key="m.id"
                class="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors group border cursor-pointer"
                :class="rowBorderClass(m)"
                @click="handleClick(m)">
                <Checkbox v-if="isSelectMode" :model-value="isSelected(m.id)" class="size-4 shrink-0" />
                <div :class="['flex items-center justify-center size-9 rounded-lg shrink-0', getMaterialBgColor(m.type)]">
                    <component :is="getMaterialIcon(m.type)" :class="['size-5', getMaterialIconColor(m.type)]" />
                </div>
                <div class="flex-1 min-w-0 text-left">
                    <div class="text-sm font-medium truncate group-hover:text-primary transition-colors">
                        {{ m.name }}
                    </div>
                    <div class="text-[11px] text-muted-foreground/60 flex items-center gap-2">
                        <span>{{ m.typeText }}</span>
                        <span v-if="m.fileSize" class="size-0.5 rounded-full bg-muted-foreground/30"></span>
                        <span v-if="m.fileSize">{{ formatByteSize(m.fileSize, 0) }}</span>
                        <template v-if="statusOf(m)">
                            <span class="size-0.5 rounded-full bg-muted-foreground/30"></span>
                            <span v-if="!showRetryFor(m)" :class="statusOf(m)!.color" class="flex items-center gap-0.5">
                                <Loader2Icon v-if="statusOf(m)!.spinning" class="size-2.5 animate-spin" />
                                {{ statusOf(m)!.text }}
                            </span>
                            <button v-else
                                class="text-destructive hover:text-primary transition-colors flex items-center gap-0.5"
                                @click.stop="m.ossFileId && emit('retryMaterial', m.id, m.ossFileId)">
                                {{ statusOf(m)!.text }}
                                <RefreshCwIcon class="size-2.5" />
                            </button>
                        </template>
                    </div>
                </div>
                <button v-if="canDelete"
                    class="size-8 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                    title="删除"
                    @click.stop="emit('deleteMaterial', m.id)">
                    <Trash2Icon class="size-3.5" />
                </button>
            </div>
        </div>
    </Transition>
</template>

<script lang="ts" setup>
import { Trash2Icon, Loader2Icon, RefreshCwIcon } from 'lucide-vue-next'
import { formatByteSize } from '#shared/utils/unitConverision'
import {
    getMaterialIcon,
    getMaterialBgColor,
    getMaterialIconColor,
    getMaterialDisplayStatus,
} from '~/utils/caseMaterial'
import type { CaseDetailMaterialItem } from '~/composables/useCaseDetail'
import type { RecognitionStatus } from '~/composables/useFileRecognition'

const props = withDefaults(defineProps<{
    materials: CaseDetailMaterialItem[]
    viewMode: 'grid' | 'list'
    /** Overview 用：归档案件只读，隐藏删除/重试 */
    readonly?: boolean
    /** Materials 用：批量管理模式 */
    isSelectMode?: boolean
    selectedIds?: number[]
    getRecognitionStatus?: (ossFileId?: number) => RecognitionStatus | null
}>(), {
    readonly: false,
    isSelectMode: false,
    selectedIds: () => [],
})

const emit = defineEmits<{
    /** 非选择模式下点击材料：父组件去打开预览 */
    previewMaterial: [material: CaseDetailMaterialItem]
    /** 选择模式下点击材料：切换勾选 */
    toggleSelect: [materialId: number]
    /** 单条删除：父组件弹确认框 */
    deleteMaterial: [materialId: number]
    /** 识别失败 → 重试 */
    retryMaterial: [materialId: number, ossFileId: number]
}>()

// 删除按钮在选择模式下不显示，只读时也不显示
const canDelete = computed(() => !props.readonly && !props.isSelectMode)

function isSelected(id: number): boolean {
    return props.selectedIds?.includes(id) ?? false
}

function statusOf(m: CaseDetailMaterialItem) {
    return getMaterialDisplayStatus(m, props.getRecognitionStatus)
}

// 只读时隐藏重试按钮（Overview 场景），正常显示重试入口（Materials 场景）
function showRetryFor(m: CaseDetailMaterialItem): boolean {
    const s = statusOf(m)
    return !!s?.showRetry && !props.readonly
}

function handleClick(m: CaseDetailMaterialItem) {
    if (props.isSelectMode) emit('toggleSelect', m.id)
    else emit('previewMaterial', m)
}

function cardBorderClass(m: CaseDetailMaterialItem): string {
    if (props.isSelectMode && isSelected(m.id)) return 'border-primary bg-primary/5'
    return 'border-transparent hover:border-primary/10'
}

function rowBorderClass(m: CaseDetailMaterialItem): string {
    if (props.isSelectMode && isSelected(m.id)) return 'border-primary bg-primary/5'
    return 'border-transparent hover:border-border/50'
}
</script>

<style scoped>
.view-fade-enter-active,
.view-fade-leave-active {
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.view-fade-enter-from {
    opacity: 0;
    transform: translateY(8px) scale(0.99);
}

.view-fade-leave-to {
    opacity: 0;
    transform: translateY(-8px) scale(0.99);
}
</style>
