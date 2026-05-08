<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'
import { useMediaQuery } from '@vueuse/core'
import {
    ChevronDown,
    FileText,
    Wrench,
} from 'lucide-vue-next'
import { Markdown } from 'vue-stream-markdown'
import 'vue-stream-markdown/index.css'
import { useApiFetch } from '~/composables/useApiFetch'
import { stripMarkdown } from '~/utils/stripMarkdown'

interface MaterialSearchResult {
    index: number
    source?: {
        sourceId?: number
        sourceName?: string
        chunkIndex?: number
        [key: string]: any
    }
    content?: string
    relevanceScore?: number
    [key: string]: any
}

const props = defineProps<{
    toolName: string
    input?: { query?: string } | any
    output?: any
    state: ExtendedToolState
}>()

const isOpen = ref(false)

// 区分输入设备能力：true=有鼠标 hover（桌面），false=触屏（移动）
// SSR 期间为 false，水合后客户端重新计算；对话流为客户端渲染，无视觉抖动
const canHover = useMediaQuery('(hover: hover)')

// markdown 内 OSS 图片占位符 → 签名 URL
// 占位符格式 {{OSS_IMAGE:bucket:ossFileId}}（ossFileId 为正整数）
// 服务端规范见 server/services/material/imageProcessor.ts
const OSS_IMAGE_REGEX = /\{\{OSS_IMAGE:([^:}]+):(\d+)\}\}/g
// 已解析后的 content：key=result.index
const resolvedContents = ref<Map<number, string>>(new Map())

// 移动端点击查看全文用的 Sheet 状态
const mobileSheetOpen = ref(false)
const activeResult = ref<MaterialSearchResult | null>(null)

function openMobileDetail(r: MaterialSearchResult) {
    activeResult.value = r
    mobileSheetOpen.value = true
}

const query = computed<string>(() => {
    const q = props.input?.query
    return typeof q === 'string' && q.trim() ? q.trim() : ''
})

const results = computed<MaterialSearchResult[]>(() => {
    try {
        const data = typeof props.output === 'string' ? JSON.parse(props.output) : props.output
        return Array.isArray(data) ? data : []
    } catch {
        return []
    }
})

const isDone = computed(() => props.state === 'output-available')

// 监听 results 变化，批量解析其中的 OSS 图片占位符为签名 URL
// 多条结果可能引用同一张图片，按 "bucket:id" 去重；一次 API 拿全部签名后再回填
watch(results, async (list) => {
    if (!list.length) {
        resolvedContents.value = new Map()
        return
    }

    const seen = new Set<string>()
    const allImages: Array<{ bucket: string, ossFileId: number }> = []
    for (const r of list) {
        if (!r.content) continue
        for (const m of r.content.matchAll(OSS_IMAGE_REGEX)) {
            const bucket = m[1]!
            const id = Number(m[2])
            const key = `${bucket}:${id}`
            if (seen.has(key)) continue
            seen.add(key)
            allImages.push({ bucket, ossFileId: id })
        }
    }

    // 没有占位符直接缓存原文，避免空请求
    if (!allImages.length) {
        const map = new Map<number, string>()
        for (const r of list) map.set(r.index, r.content || '')
        resolvedContents.value = map
        return
    }

    let urls: Record<string, string> = {}
    try {
        // 单次 API 上限 100 张；超出分批
        const chunks: typeof allImages[] = []
        for (let i = 0; i < allImages.length; i += 100) chunks.push(allImages.slice(i, i + 100))
        for (const chunk of chunks) {
            const resp = await useApiFetch<{ urls?: Record<string, string> }>(
                '/api/v1/oss/image-signed-urls',
                { method: 'POST', body: { images: chunk } },
            )
            if (resp?.urls) urls = { ...urls, ...resp.urls }
        }
    }
    catch {
        // 签名失败时保留占位符原文，UI 至少能看到文字部分
    }

    const map = new Map<number, string>()
    for (const r of list) {
        if (!r.content) {
            map.set(r.index, '')
            continue
        }
        const replaced = r.content.replace(OSS_IMAGE_REGEX, (raw, b, id) => urls[`${b}:${id}`] ?? raw)
        map.set(r.index, replaced)
    }
    resolvedContents.value = map
}, { immediate: true })

// 渲染用：优先 resolved，未就绪时回落到原始 content
function renderContent(r: MaterialSearchResult): string {
    return resolvedContents.value.get(r.index) ?? r.content ?? ''
}

// 仅完成态时显示结果数摘要；其它状态由 ToolStatusBadge 自己表达，避免颜色/语义重复
const resultSummary = computed(() => {
    if (!isDone.value) return ''
    return results.value.length === 0
        ? '未找到相关材料'
        : `${results.value.length} 条结果`
})

// 有查询关键词或结果时即可展开，避免 0 结果时整个面板消失看不到查询条件
const hasExpandableContent = computed(() => !!query.value || results.value.length > 0)
</script>

<template>
    <Collapsible v-model:open="isOpen" class="group not-prose mb-4 w-full rounded-md border">
        <!-- 折叠态触发器：与 ai-elements ToolHeader 视觉一致（扳手图标 + 标题 + 状态徽章） -->
        <CollapsibleTrigger class="flex w-full items-center justify-between gap-4 p-3">
            <div class="flex min-w-0 items-center gap-2">
                <Wrench class="size-4 shrink-0 text-muted-foreground" />
                <span class="shrink-0 text-sm font-medium">材料检索</span>
                <ToolStatusBadge :state="state" />
            </div>
            <div class="flex items-center gap-2">
                <span v-if="resultSummary" class="text-xs text-muted-foreground">
                    {{ resultSummary }}
                </span>
                <ChevronDown
                    v-if="hasExpandableContent"
                    class="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                />
            </div>
        </CollapsibleTrigger>

        <!-- 展开态：结果列表 -->
        <CollapsibleContent
            v-if="hasExpandableContent"
            class="overflow-hidden data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2"
        >
            <!-- 展开态嵌在外层卡片 border 内，无需再嵌套 border：用 border-t 接续视觉 -->
            <div class="border-t border-border">
                <!-- 关键词区 -->
                <div
                    v-if="query"
                    class="flex items-center gap-2 border-b border-border px-3 py-2"
                >
                    <span class="shrink-0 text-xs text-muted-foreground">关键词</span>
                    <!-- 关键词 chip：跟随主题 primary 色（Violet/Rose/Blue/Green/... 每套主题自动适配） -->
                    <span
                        class="inline-flex items-center rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
                    >
                        {{ query }}
                    </span>
                </div>
                <!-- 空态：完成且 0 条结果时也展开看到查询条件 -->
                <div
                    v-if="results.length === 0 && isDone"
                    class="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                    未找到相关材料
                </div>
                <div v-else-if="results.length > 0" class="space-y-2 p-3">
                <template v-for="r in results" :key="r.index">
                    <!-- 桌面端：HoverCard 悬停预览 -->
                    <HoverCard v-if="canHover" :open-delay="200" :close-delay="100">
                        <HoverCardTrigger as-child>
                            <div
                                class="cursor-default rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 transition-colors hover:border-border hover:bg-muted/50"
                            >
                                <div class="mb-1.5 flex items-center gap-2">
                                    <FileText class="size-3.5 shrink-0 text-primary" />
                                    <span class="truncate text-xs font-medium text-foreground">
                                        {{ r.source?.sourceName || '未知材料' }}
                                    </span>
                                    <span class="ml-auto shrink-0 text-[11px] text-muted-foreground">
                                        #{{ r.index }}
                                    </span>
                                </div>
                                <div class="flex gap-2 pl-1">
                                    <div class="w-0.5 shrink-0 rounded-full bg-primary/70" />
                                    <p class="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                        {{ stripMarkdown(r.content || '').substring(0, 200) }}
                                    </p>
                                </div>
                            </div>
                        </HoverCardTrigger>

                        <HoverCardContent
                            v-if="r.content"
                            side="top"
                            align="start"
                            class="z-[200] flex max-h-[400px] w-[420px] flex-col overflow-hidden p-0"
                        >
                            <!-- 固定标题 -->
                            <div class="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
                                <FileText class="size-4 shrink-0 text-primary" />
                                <span class="truncate text-sm font-semibold text-foreground">
                                    {{ r.source?.sourceName || '未知材料' }}
                                </span>
                                <span class="ml-auto shrink-0 text-xs text-muted-foreground">
                                    #{{ r.index }}
                                </span>
                            </div>
                            <!-- 可滚动内容 -->
                            <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                                <!-- 局部缩小两号：prose-sm 基础 14px → 强制压到 12px；保留 prose 的列表/引用等结构样式
                                     全局 markdown 渲染样式不动，只影响此预览容器 -->
                                <div class="prose prose-sm dark:prose-invert max-w-none text-foreground/90 [&_*]:!text-xs [&_*]:!leading-snug [&_p]:!my-1.5 [&_ul]:!my-1.5 [&_ol]:!my-1.5 [&_blockquote]:!my-1.5 [&_pre]:!my-1.5 [&_h1]:!my-2 [&_h2]:!my-2 [&_h3]:!my-1.5 [&_h4]:!my-1.5">
                                    <Markdown :content="renderContent(r)" />
                                </div>
                            </div>
                        </HoverCardContent>
                    </HoverCard>

                    <!-- 移动端：点击触发底部 Sheet -->
                    <button
                        v-else
                        type="button"
                        class="block w-full rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 text-left transition-colors active:bg-muted/60"
                        @click="openMobileDetail(r)"
                    >
                        <div class="mb-1.5 flex items-center gap-2">
                            <FileText class="size-3.5 shrink-0 text-primary" />
                            <span class="truncate text-xs font-medium text-foreground">
                                {{ r.source?.sourceName || '未知材料' }}
                            </span>
                            <span class="ml-auto shrink-0 text-[11px] text-muted-foreground">
                                #{{ r.index }}
                            </span>
                        </div>
                        <div class="flex gap-2 pl-1">
                            <div class="w-0.5 shrink-0 rounded-full bg-primary/70" />
                            <p class="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                {{ stripMarkdown(r.content || '').substring(0, 200) }}
                            </p>
                        </div>
                    </button>
                </template>
                </div>
            </div>
        </CollapsibleContent>

        <!-- 移动端全文查看 Sheet（顶层渲染，z-[200] 防止被对话面板挡住） -->
        <Sheet v-model:open="mobileSheetOpen">
            <SheetContent
                side="bottom"
                class="z-[200] flex max-h-[80vh] flex-col gap-0 p-0"
            >
                <SheetHeader class="border-b border-border px-4 py-3 pr-12">
                    <SheetTitle class="flex items-center gap-2 text-sm">
                        <FileText class="size-4 shrink-0 text-primary" />
                        <span class="truncate">
                            {{ activeResult?.source?.sourceName || '未知材料' }}
                        </span>
                    </SheetTitle>
                    <SheetDescription class="text-xs">
                        第 {{ activeResult?.index }} 条结果
                    </SheetDescription>
                </SheetHeader>
                <div class="flex-1 overflow-y-auto px-4 py-3">
                    <div class="prose prose-sm dark:prose-invert max-w-none text-foreground/90">
                        <Markdown :content="activeResult ? renderContent(activeResult) : ''" />
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    </Collapsible>
</template>
