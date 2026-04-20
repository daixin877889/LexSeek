<script setup lang="ts">
/**
 * 案件详情 - 案件文书 Tab
 *
 * 布局对齐 CaseDetailMaterials：
 * - 顶部栏：标题徽章 + 数量 Badge + 「+ 新建文书」按钮
 * - 下方：DraftHistory（受控模式，items 由父级传入）
 *
 * Sheet 不在本组件内持有，而是由 cases/[id].vue 父级统一管理（与 overview 板块共享）。
 */
import { FileEditIcon, PlusIcon } from 'lucide-vue-next'
import type { DraftRow } from '#shared/types/document'

defineProps<{
    caseId: number
    drafts: DraftRow[]
    loading?: boolean
}>()

const emit = defineEmits<{
    /** 点击「+ 新建文书」— 由父级打开 Sheet */
    createDocument: []
    /** DraftHistory 内部删除完成，父级据此刷新 */
    refresh: []
}>()
</script>

<template>
    <div class="h-full overflow-y-auto p-4 md:p-6 space-y-4">
        <!-- 顶部栏 -->
        <header class="flex items-center justify-between gap-2">
            <h2 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
                <FileEditIcon class="size-4" />
                案件文书
                <Badge
                    v-if="drafts.length"
                    variant="secondary"
                    class="font-normal px-1.5 py-0 h-4 text-[10px]"
                >
                    {{ drafts.length }}
                </Badge>
            </h2>
            <button
                class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                title="新建文书"
                @click="emit('createDocument')"
            >
                <PlusIcon class="size-3" />
                <span class="hidden lg:inline">新建文书</span>
            </button>
        </header>

        <!-- 列表 -->
        <AssistantDocumentDraftHistory
            :case-id="caseId"
            :items="drafts"
            :loading="loading"
            hide-case-column
            @changed="emit('refresh')"
        />
    </div>
</template>
