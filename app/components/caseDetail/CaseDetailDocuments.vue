<script setup lang="ts">
/**
 * 案件详情 - 案件文书 Tab
 *
 * 布局对齐 CaseDetailMaterials：
 * - 顶部栏：标题 + 数量 Badge + 「+ 新建文书」+ grid/list 视图切换
 * - 下方：AssistantDocumentDraftCardList（与 overview 板块共用，删除逻辑内置）
 */
import { FileEditIcon, LayoutGridIcon, ListIcon, Loader2Icon, PlusIcon } from 'lucide-vue-next'
import type { DraftRow } from '#shared/types/document'

const props = defineProps<{
    caseId: number
    drafts: DraftRow[]
    loading?: boolean
}>()

const emit = defineEmits<{
    /** 点击「+ 新建文书」— 由父级打开 Sheet */
    createDocument: []
    /** 删除完成后父级据此刷新 */
    refresh: []
}>()

const viewMode = ref<'grid' | 'list'>('grid')
const hasDrafts = computed(() => props.drafts.length > 0)
</script>

<template>
    <div class="h-full overflow-y-auto p-4 md:p-6 space-y-4">
        <!-- 顶部栏 -->
        <header class="flex items-center justify-between gap-2">
            <h2 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
                <FileEditIcon class="size-4" />
                案件文书
                <Badge v-if="drafts.length" variant="secondary" class="font-normal px-1.5 py-0 h-4 text-[10px]">
                    {{ drafts.length }}
                </Badge>
            </h2>
            <div class="flex items-center gap-2 lg:gap-4">
                <button class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                    title="新建文书" @click="emit('createDocument')">
                    <PlusIcon class="size-3" />
                    <span class="hidden lg:inline">新建文书</span>
                </button>
                <div v-if="hasDrafts" class="w-px h-3 bg-border" />
                <!-- 视图切换 -->
                <div v-if="hasDrafts" class="flex items-center bg-muted/50 rounded-lg p-0.5">
                    <button class="size-7 flex items-center justify-center rounded-md transition-all"
                        :class="viewMode === 'grid' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'"
                        @click="viewMode = 'grid'">
                        <LayoutGridIcon class="size-3.5" />
                    </button>
                    <button class="size-7 flex items-center justify-center rounded-md transition-all"
                        :class="viewMode === 'list' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'"
                        @click="viewMode = 'list'">
                        <ListIcon class="size-3.5" />
                    </button>
                </div>
            </div>
        </header>

        <!-- 加载 -->
        <div v-if="loading" class="flex justify-center py-10">
            <Loader2Icon class="size-6 animate-spin text-muted-foreground" />
        </div>

        <!-- 空态 -->
        <div v-else-if="!hasDrafts" class="flex flex-col items-center justify-center py-14 text-muted-foreground">
            <FileEditIcon class="size-10 mb-2 opacity-40" />
            <p class="text-sm mb-4">本案件还没有文书，开始生成第一份吧</p>
            <Button size="sm" class="gap-1" @click="emit('createDocument')">
                <PlusIcon class="size-4" />
                新建文书
            </Button>
        </div>

        <!-- 列表 -->
        <AssistantDocumentDraftCardList v-else :items="drafts" :view-mode="viewMode" show-delete
            @changed="emit('refresh')" />
    </div>
</template>
