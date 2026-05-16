<template>
    <!-- 桌面端卡片视图 -->
    <div class="hidden grid-cols-1 gap-4 md:grid lg:grid-cols-2 xl:grid-cols-3">
        <div v-for="item in list" :key="item.id"
            class="group flex flex-col rounded-xl border bg-card shadow-sm transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-md">
            <!-- 内容区 -->
            <div class="flex flex-1 flex-col gap-3 p-[18px]">
                <NuxtLink :to="`/dashboard/cases/${item.id}`"
                    class="line-clamp-2 text-[15.5px] font-semibold leading-snug text-foreground transition-colors hover:text-primary">
                    {{ item.title }}
                </NuxtLink>
                <div class="flex flex-wrap items-center gap-1.5">
                    <CasesCaseStatusBadge :status="item.status" />
                    <Badge v-if="item.isDemo" variant="outline"
                        class="rounded border-amber-500/30 bg-[image:var(--tint-amber-bg)] px-1.5 py-0 text-[10px] font-semibold text-[color:var(--tint-amber-fg)]">
                        演示
                    </Badge>
                </div>
                <div class="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span class="font-mono">#{{ item.id }}</span>
                    <span>{{ getCaseTypeName(item.caseTypeId) }}</span>
                    <span>创建于 {{ formatDate(item.createdAt, 'YYYY-MM-DD') }}</span>
                </div>
            </div>
            <!-- 操作栏 -->
            <div class="flex items-center justify-between gap-2 border-t border-border px-[18px] py-3">
                <div class="flex items-center gap-1">
                    <Button v-if="!isCaseReadOnly(item.status)" variant="ghost" size="icon"
                        class="size-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="归档案件" @click="openArchive(item)">
                        <Archive class="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" :disabled="isCaseReadOnly(item.status)"
                        :title="isCaseReadOnly(item.status) ? '归档案件不可删除' : '删除案件'"
                        class="size-8 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        @click="emit('delete', item.id)">
                        <Trash2 class="size-4" />
                    </Button>
                </div>
                <NuxtLink :to="`/dashboard/cases/${item.id}`">
                    <Button variant="outline" size="sm" class="h-8 gap-1.5 hover:border-primary hover:text-primary">
                        <Eye class="size-3.5" />
                        查看详情
                    </Button>
                </NuxtLink>
            </div>
        </div>

        <CasesArchiveDialog v-model:open="dialogOpen" :loading="archiving" @confirm="confirmArchive" />
    </div>
</template>

<script lang="ts" setup>
import { Eye, Trash2, Archive } from 'lucide-vue-next'
import { isCaseReadOnly } from '#shared/types/case'
import type { CaseListItem, CaseTypeOption } from '#shared/types/case'
import CasesCaseStatusBadge from '~/components/cases/CaseStatusBadge.vue'
import CasesArchiveDialog from '~/components/cases/CasesArchiveDialog.vue'
import { useArchiveCase } from '~/composables/useArchiveCase'
import { useFormatters } from '~/composables/useFormatters'

const props = defineProps<{
    list: CaseListItem[]
    caseTypes: CaseTypeOption[]
}>()

const emit = defineEmits<{
    delete: [id: number]
    archived: [id: number]
}>()

const { formatDate } = useFormatters()
const { dialogOpen, archiving, openArchive, confirmArchive } = useArchiveCase(id => emit('archived', id))

function getCaseTypeName(typeId: number | null): string {
    if (typeId === null) return '未知类型'
    return props.caseTypes.find(t => t.id === typeId)?.name ?? '未知类型'
}
</script>
