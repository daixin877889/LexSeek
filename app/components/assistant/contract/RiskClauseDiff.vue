<script lang="ts">
import DiffMatchPatch from 'diff-match-patch'

// dmp 实例无状态，挂到 <script>（非 setup）作模块级单例，
// 避免每个 RiskClauseDiff 卡片实例重复构造。
const dmp = new DiffMatchPatch()
// PR 4 spec § 12 风险 mitigation：长 clauseText 跨段标点变化时默认 1 秒 timeout 会卡前端线程，
// 调到 0.1 秒兜底（超时后 dmp 返回 best-effort diff 不抛错）。
dmp.Diff_Timeout = 0.1
</script>

<script setup lang="ts">
/**
 * 单条风险的条款显示组件（PR 4：双布局）
 *
 * mode='stacked'（Layout A，默认更易读）：
 *   ┌── 条款标题（clauseText 第一行 + clauseParagraphIndex 非空时追加"（第 N 段）"）
 *   ├── 完整原文（clauseText 全文 + quote 字符段深黄高亮，仅当 quoteCharStart/End 都有效）
 *   ├── 问题片段（problematicQuote 单独框；为空不渲染）
 *   └── 建议改写（suggestedClauseText 纯文本框；为空显示"无建议改写"）
 *
 * mode='inline-diff'（Layout C，行内 diff）：
 *   单栏 dmp 行内 diff：equal 段平铺、delete 段红底删除线、insert 段绿底加粗。
 *   spec § 6.4 严格降级：problematicQuote=null（quote 锚点解析失败）→ 不做 diff，
 *   显示纯 clauseText；clauseText / suggestedClauseText 任一为空也降级（防御）。
 */
import { FileText, Quote, AlertTriangle, PencilLine } from 'lucide-vue-next'

const props = defineProps<{
    /** 必填：调用方明确指定布局，避免意外漏传 */
    mode: 'stacked' | 'inline-diff'
    // clauseText 实际可能是 undefined（如上游 ContractReviewPanel.effectiveRisks fallback path
    // 直接 spread entity 时丢字段映射）；接受 undefined 防止 Vue prop 类型 warning
    // 后让模板 / computed 防御处理。
    clauseText?: string
    suggestedClauseText?: string
    /** PR 4：精确问题片段（PR 3 主路径起填值；为 null/undefined 时 stacked 模式不渲染问题片段框、inline-diff 模式不做 diff） */
    problematicQuote?: string | null
    /** PR 4：在 clauseText 内的相对 offset；与 quoteCharEnd 同时有效时 stacked 模式做字符级高亮 */
    quoteCharStart?: number | null
    /** exclusive */
    quoteCharEnd?: number | null
    /** PR 4：非空段落序号（0-based）；stacked 模式追加"（第 N 段）"徽章；为 null 不渲染徽章 */
    clauseParagraphIndex?: number | null
}>()

type DiffSegment = { kind: 'equal' | 'delete' | 'insert'; text: string }

/** stacked 模式：把 clauseText 切成 [前缀, quote, 后缀] 三段，让模板做字符级高亮 */
const stackedClauseSegments = computed<{ prefix: string; quote: string; suffix: string } | null>(() => {
    if (!props.clauseText) return null
    const start = props.quoteCharStart
    const end = props.quoteCharEnd
    // quote=null 降级：不高亮，整段当前缀（spec § 6.4）
    if (start == null || end == null || start < 0 || end <= start || end > props.clauseText.length) {
        return { prefix: props.clauseText, quote: '', suffix: '' }
    }
    return {
        prefix: props.clauseText.slice(0, start),
        quote: props.clauseText.slice(start, end),
        suffix: props.clauseText.slice(end),
    }
})

/** inline-diff 模式：dmp.diff_main 全段后渲染线性 diff segments */
const inlineDiffSegments = computed<DiffSegment[] | null>(() => {
    // 双向防御：任一字段为 falsy（undefined / null / 空串）→ 不做 diff
    // dmp.diff_main 接收 undefined 会抛 "Null input" 错误，导致 Vue 整条渲染管线崩溃
    if (!props.suggestedClauseText || !props.clauseText) return null
    // spec § 6.4 严格降级：problematicQuote=null 时 inline-diff 不 diff，
    // 显示纯 clauseText（避免 quote 锚点解析失败时的乱跨段 diff，spec § 12 风险点）
    if (props.problematicQuote == null) return null
    const raw = dmp.diff_main(props.clauseText, props.suggestedClauseText)
    dmp.diff_cleanupSemantic(raw)
    const segments: DiffSegment[] = []
    for (const [op, text] of raw) {
        if (op === 0) segments.push({ kind: 'equal', text })
        else if (op === -1) segments.push({ kind: 'delete', text })
        else if (op === 1) segments.push({ kind: 'insert', text })
    }
    return segments
})

const DIFF_CLASS_MAP: Record<DiffSegment['kind'], string> = {
    equal: '',
    delete: 'bg-red-600/15 text-red-700 dark:text-red-300 line-through',
    insert: 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 font-semibold',
}

/** 条款标题：clauseText 第一行（segmentClauses 用 \n 连多行；首行通常是"第三条 工资支付"这类标题） */
const clauseTitle = computed(() => {
    if (!props.clauseText) return ''
    const firstLine = props.clauseText.split('\n')[0]?.trim() ?? ''
    return firstLine
})
</script>

<template>
    <!-- ============================== Layout A · Stacked 三段式 ============================== -->
    <div v-if="mode === 'stacked'" class="flex flex-col gap-3">
        <!-- 条款标题（spec § 6.1 mockup："第三条 工资支付（第 5 段）"） -->
        <div v-if="clauseTitle" class="flex items-center gap-1.5 min-w-0 text-[11px] font-medium text-muted-foreground">
            <FileText class="size-3 shrink-0" />
            <span class="shrink-0">条款标题</span>
            <span class="font-semibold text-foreground truncate flex-1 min-w-0">{{ clauseTitle }}</span>
            <span v-if="clauseParagraphIndex != null" class="shrink-0 font-normal">（第 {{ clauseParagraphIndex + 1 }} 段）</span>
        </div>

        <!-- 完整原文 + quote 字符段高亮 -->
        <div class="flex flex-col gap-1.5">
            <div class="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Quote class="size-3 shrink-0" />
                <span>完整原文</span>
            </div>
            <div class="rounded-md px-3 py-2.5 bg-muted text-[12.5px] leading-relaxed whitespace-pre-wrap">
                <template v-if="stackedClauseSegments">
                    <span>{{ stackedClauseSegments.prefix }}</span>
                    <mark
                        v-if="stackedClauseSegments.quote"
                        aria-label="问题片段"
                        class="bg-amber-300/60 dark:bg-amber-300/25 text-foreground rounded-sm px-0.5"
                    >{{ stackedClauseSegments.quote }}</mark>
                    <span>{{ stackedClauseSegments.suffix }}</span>
                </template>
                <template v-else>{{ clauseText }}</template>
            </div>
        </div>

        <!-- 问题片段（quote=null 时不渲染） -->
        <div v-if="problematicQuote" class="flex flex-col gap-1.5">
            <div class="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <AlertTriangle class="size-3 shrink-0 text-amber-600" />
                <span>问题片段</span>
            </div>
            <div class="rounded-md px-3 py-2.5 bg-amber-600/8 border border-amber-600/30 text-[12.5px] italic leading-relaxed whitespace-pre-wrap">
                {{ problematicQuote }}
            </div>
        </div>

        <!-- 建议改写 -->
        <div class="flex flex-col gap-1.5">
            <div class="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <PencilLine class="size-3 shrink-0 text-emerald-600" />
                <span>建议改写</span>
            </div>
            <div
                v-if="suggestedClauseText"
                class="rounded-md px-3 py-2.5 bg-emerald-600/10 border border-emerald-600/25 text-[12.5px] leading-relaxed whitespace-pre-wrap"
            >{{ suggestedClauseText }}</div>
            <div v-else class="rounded-md px-3 py-2.5 bg-muted text-muted-foreground text-[12.5px] italic">无建议改写</div>
        </div>
    </div>

    <!-- ============================== Layout C · Inline diff 行内差异 ============================== -->
    <div v-else class="flex flex-col gap-1.5">
        <div class="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <PencilLine class="size-3 shrink-0 text-emerald-600" />
            <span>原文 → 建议（行内差异）</span>
        </div>
        <div v-if="inlineDiffSegments" class="rounded-md px-3 py-2.5 bg-muted text-[12.5px] leading-relaxed whitespace-pre-wrap">
            <span
                v-for="(seg, i) in inlineDiffSegments"
                :key="`d-${i}`"
                :class="DIFF_CLASS_MAP[seg.kind]"
            >{{ seg.text }}</span>
        </div>
        <!-- 降级：suggested / clause 任一为空 → 显示纯 clauseText -->
        <div v-else class="rounded-md px-3 py-2.5 bg-muted text-[12.5px] leading-relaxed whitespace-pre-wrap">{{ clauseText }}</div>
    </div>
</template>
