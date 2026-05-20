<script setup lang="ts">
/**
 * 文书生成首页
 *
 * 两个 Tab：
 * - 文书模板（TemplateBrowser）：按分类摊开 + 搜索；来源筛选/管理入口由本页 header 承接
 * - 历史文书（DraftHistory）：响应式的历史草稿列表（桌面表格/移动卡片）
 *
 * URL query.tab 持久化当前 Tab，刷新后保持在原 Tab。
 */
import { FileUserIcon } from 'lucide-vue-next'
import {
    TEMPLATE_SCOPE_OPTIONS,
    type TemplateScopeFilter,
} from '#shared/types/document'
import AssistantDocumentDraftHistory from '~/components/assistant/document/DraftHistory.vue'
import AssistantDocumentTemplateBrowser from '~/components/assistant/document/TemplateBrowser.vue'
import { useApiFetch } from '~/composables/useApiFetch'

definePageMeta({
    layout: 'dashboard-layout',
    title: '文书模板',
    icon: 'FileText',
})

type DocTab = 'new' | 'history'

const route = useRoute()
const router = useRouter()

const initialTab: DocTab = route.query.tab === 'history' ? 'history' : 'new'
const activeTab = ref<DocTab>(initialTab)
const scope = ref<TemplateScopeFilter>('all')

watch(activeTab, (v) => {
    // 同步 URL：用 replace 避免产生多余历史记录
    router.replace({ query: { ...route.query, tab: v } })
})

async function handleTemplateSelect(templateId: number) {
    const result = await useApiFetch<{ draftId: number; sessionId: string }>(
        '/api/v1/assistant/document/drafts',
        { method: 'POST', body: { templateId } },
    )
    if (!result) return
    navigateTo(`/dashboard/document/drafts/${result.draftId}`)
}

function goManageTemplates() {
    navigateTo('/dashboard/document/templates')
}
</script>

<template>
    <div class="p-4 md:p-6 space-y-4">
        <!-- 页面标题行：标题 + 右上角 管理我的模板（移动端也保持右上角） -->
        <header class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
                <h1 class="text-2xl md:text-3xl font-bold mb-1">文书模板</h1>
                <p class="text-muted-foreground text-sm">
                    根据模板生成标准的法律文书
                </p>
            </div>
            <Button v-if="activeTab === 'new'" variant="outline" size="sm" class="h-8 text-xs shrink-0"
                @click="goManageTemplates">
                <FileUserIcon class="size-3.5 mr-1" />
                我的模板
            </Button>
        </header>

        <Tabs v-model="activeTab" class="w-full">
            <!-- Tab 切换 + 来源筛选 同行 -->
            <div class="flex items-center justify-between gap-3 flex-wrap">
                <TabsList>
                    <TabsTrigger value="new">文书模板</TabsTrigger>
                    <TabsTrigger value="history">历史文书</TabsTrigger>
                </TabsList>

                <div v-if="activeTab === 'new'"
                    class="inline-flex items-center rounded-full border bg-muted/40 p-0.5 text-xs">
                    <button v-for="opt in TEMPLATE_SCOPE_OPTIONS" :key="opt.value" type="button" :class="[
                        'px-3 h-7 rounded-full transition-colors',
                        scope === opt.value
                            ? 'bg-background text-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                    ]" @click="scope = opt.value">
                        {{ opt.label }}
                    </button>
                </div>
            </div>

            <TabsContent value="new" class="mt-4">
                <AssistantDocumentTemplateBrowser v-model:scope="scope" @select="handleTemplateSelect" />
            </TabsContent>

            <TabsContent value="history" class="mt-4">
                <AssistantDocumentDraftHistory />
            </TabsContent>
        </Tabs>
    </div>
</template>
