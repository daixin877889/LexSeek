<script setup lang="ts">
/**
 * 文书模板卡片（展示单条）
 *
 * 用于 TemplateBrowser 的分类分组网格。
 * 模板来源通过图标颜色区分：
 * - 系统模板（global）：品牌色（primary）调 FileText
 * - 我的模板（user）：琥珀色 FileUser，带"个人上传"语义
 */
import { FileTextIcon, FileUserIcon } from 'lucide-vue-next'

interface TemplateItem {
    id: number
    name: string
    description?: string | null
    scope: 'global' | 'user'
}

defineProps<{ template: TemplateItem }>()
</script>

<template>
    <button
        type="button"
        class="group relative flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all overflow-hidden hover:border-primary/60 hover:shadow-lg hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :title="template.scope === 'user' ? '我上传的模板' : '系统预置模板'"
    >
        <!-- 图标：按来源区分颜色 -->
        <div
            :class="[
                'flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors',
                template.scope === 'user'
                    ? 'bg-amber-100 text-amber-600 group-hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'bg-primary/10 text-primary group-hover:bg-primary/20',
            ]"
        >
            <FileUserIcon v-if="template.scope === 'user'" class="size-5" />
            <FileTextIcon v-else class="size-5" />
        </div>

        <div class="flex-1 min-w-0 space-y-1">
            <span class="block text-sm font-medium leading-tight line-clamp-2">{{ template.name }}</span>
            <p v-if="template.description" class="text-xs text-muted-foreground line-clamp-1">
                {{ template.description }}
            </p>
        </div>
    </button>
</template>
