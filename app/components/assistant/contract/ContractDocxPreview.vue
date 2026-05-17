<script setup lang="ts">
/**
 * 合同预览组件（M6.1 版本）
 *
 * - 用 docx-preview 的 renderAsync 渲染已注入批注的 .docx
 * - 优先加载 reviewedFileId；为空则 fallback 到 originalFileId（审查进行中先看原始合同）
 * - 两个都为空 → 显示"等待合同上传..."
 * - fetchSeq 机制避免快速切换时过期请求覆盖最新渲染（参照 DocumentPreview）
 * - M6.1：renderAsync 完成后 walk DOM，注入 data-risk-id + 彩色底；支持聚焦/钉/悬停态联动
 */
import { renderAsync } from 'docx-preview'
import { toast } from 'vue-sonner'
import { PlusIcon } from 'lucide-vue-next'
import { locateClauseElement, paragraphIndexOfElement, isBodyParagraph } from '#shared/utils/clauseLocator'
import type { Risk, RiskDisplayPhaseB, RiskLevel } from '#shared/types/contract'
// UI-L1：从 app/utils/contractRiskLevelStyle.ts 单一数据源 import，
// 与 RiskListPanel 的徽章配色统一维护。
import {
    RISK_LEVEL_DOCX_BG_CLASS as LEVEL_BG,
    RISK_LEVEL_DOCX_FOCUS_CLASS,
    RISK_LEVEL_DOCX_HOVER_BG,
} from '~/utils/contractRiskLevelStyle'
import { useApiFetch } from '~/composables/useApiFetch'
import {
    decorateQuoteRanges,
    clearAllQuoteHighlights,
    computeQuoteRange,
} from '~/utils/quoteHighlight'

const props = withDefaults(defineProps<{
    reviewedFileId: number | null
    originalFileId: number | null
    /**
     * PR 5：升级到 RiskDisplayPhaseB[]，新增 problematicQuote / quoteCharStart /
     * quoteCharEnd 用于 quote 字符级高亮（CSS Custom Highlight API）。
     */
    risks?: RiskDisplayPhaseB[]
    focusedRiskId?: string | null
    hoveredRiskId?: string | null
    /**
     * PR 5：从 useContractRiskHighlight.pinnedRiskIds 直接传入（不含 focused）。
     * 替代旧 highlightedRiskIds（pinned ∪ focused 合集）的内部反推。
     */
    pinnedRiskIds?: Set<string>
}>(), {
    risks: () => [],
    focusedRiskId: null,
    hoveredRiskId: null,
    pinnedRiskIds: () => new Set<string>(),
})

const emit = defineEmits<{
    focusRisk: [riskId: string]
    hoverClause: [riskId: string | null]
    locateResult: [notLocatedIds: Set<string>]
    addRiskFromParagraph: [payload: { clauseParagraphIndex: number, clauseText: string }]
}>()

const containerRef = ref<HTMLElement | null>(null)
const loading = ref(false)
const empty = computed(() => !props.reviewedFileId && !props.originalFileId)

// hover 新增风险：当前 hover 的正文段落 + 浮动「＋」位置
const hoveredParagraph = ref<HTMLElement | null>(null)
const addBtnTop = ref(0)
const addBtnLeft = ref(0)

function syncAddBtnPos() {
    const para = hoveredParagraph.value
    const c = containerRef.value
    if (!para || !c) return
    // 用 getBoundingClientRect 取实时视口位置：offsetTop 依赖 offsetParent 链，
    // docx-preview 的 section.docx 自带定位，offsetParent 并非按钮的 relative 参照容器。
    const paraRect = para.getBoundingClientRect()
    const cRect = c.getBoundingClientRect()
    addBtnTop.value = paraRect.top - cRect.top
    // 水平跟随段落左缘——按钮恒定置于段落左缘外侧 6px 的 gutter（按钮宽 20px），
    // 始终随段落走，不随页面宽度 / 白纸居中位置漂移。
    addBtnLeft.value = paraRect.left - cRect.left - 26
}

function onContainerMouseOver(e: MouseEvent) {
    const para = (e.target as HTMLElement | null)?.closest('p') ?? null
    // 命中非正文段落（段落间空白、左侧 gutter、页眉页脚）时保持当前按钮不清空——
    // 鼠标从段落移向左侧「＋」按钮的途中必然经过非段落区，清空会让按钮闪掉无法点击。
    // 真正的隐藏交给容器 mouseleave。
    if (!isBodyParagraph(para)) return
    // 同段落内移动持续命中同一 <p>，已是当前 hover 段落则跳过重算
    if (para === hoveredParagraph.value) return
    hoveredParagraph.value = para
    syncAddBtnPos()
}

function onAddBtnClick() {
    const para = hoveredParagraph.value
    if (!para || !containerRef.value) return
    const idx = paragraphIndexOfElement(containerRef.value, para)
    if (idx < 0) return
    emit('addRiskFromParagraph', {
        clauseParagraphIndex: idx,
        clauseText: (para.textContent ?? '').trim(),
    })
}

// containerRef 跨 docx 重渲染（loadDocx 的 innerHTML=''）始终存在，scroll 监听器不会失效
onMounted(() => containerRef.value?.addEventListener('scroll', syncAddBtnPos))

// 每次 load 触发时递增；仅最新 seq 允许继续写入 DOM，防止过期请求覆盖
let fetchSeq = 0

/**
 * 风险等级对应的底色 + 左边框基础样式。
 *
 * 注：文档"纸面"保持白色（Word 预览惯例），不随全局 dark 主题翻转；
 * 因此段落高亮只用 light 变体，避免在白纸上出现暗色块的突兀对比。
 */
/** 风险等级排序：high > medium > low，同段多风险时取最高等级作段落底色 */
const LEVEL_RANK: Record<RiskLevel, number> = { high: 3, medium: 2, low: 1 }

/**
 * 定位一条风险应高亮的段落。
 *
 * 优先用 problematicQuote 精确定位到「问题语句所在的段落」——clauseText 跨多段时
 * （如"特殊限制"块含生育限制 / 隐私监控两个子条款），clauseParagraphIndex 只指向
 * 块起始段，problematicQuote 才指向真正的问题段落。无 quote 锚点时回退到
 * clauseParagraphIndex / clauseText（locateClauseElement 的四级兜底）。
 */
function locateRiskParagraph(risk: RiskDisplayPhaseB, container: HTMLElement): HTMLElement | null {
    const range = computeQuoteRange(risk, container)
    if (range) {
        const startNode = range.startContainer
        const startEl = startNode.nodeType === Node.TEXT_NODE
            ? startNode.parentElement
            : (startNode as Element)
        const p = startEl?.closest('p')
        if (p instanceof HTMLElement) return p
    }
    const el = locateClauseElement(container, risk.clauseText, risk.clauseParagraphIndex)
    return el instanceof HTMLElement ? el : null
}

/**
 * 内部函数：在 DOM 里跑一次定位，返回没匹配到的 riskId 集合（不发 emit）。
 *
 * 先按段落 DOM 聚合——同一段落可定位到多条风险（AI 单条款多 risk / 律师手动追加）。
 * 段落用多值 data-risk-ids（空格分隔）标记，配合 [data-risk-ids~="X"] 选择器，
 * 使右侧任一条风险卡片都能联动到左侧同一段落。
 */
function runDecorateOnce(): Set<string> {
    const container = containerRef.value
    if (!container) return new Set(props.risks.map(r => r.id))
    const notLocatedIds = new Set<string>()
    const paraToRisks = new Map<HTMLElement, RiskDisplayPhaseB[]>()
    for (const risk of props.risks) {
        const el = locateRiskParagraph(risk, container)
        if (!el) {
            notLocatedIds.add(risk.id)
            continue
        }
        const arr = paraToRisks.get(el)
        if (arr) arr.push(risk)
        else paraToRisks.set(el, [risk])
    }
    for (const [el, risks] of paraToRisks) {
        // 多值标记：该段全部风险 id（空格分隔）
        el.dataset.riskIds = risks.map(r => r.id).join(' ')
        // 底色取该段最高风险等级；先清旧底色再加，避免重复 decorate 叠加 / 等级变化残留
        const topLevel = risks.reduce<RiskLevel>(
            (top, r) => (LEVEL_RANK[r.level] > LEVEL_RANK[top] ? r.level : top), 'low')
        el.dataset.riskLevel = topLevel
        for (const lv of Object.keys(LEVEL_RANK) as RiskLevel[]) el.classList.remove(...LEVEL_BG[lv])
        el.classList.add(...LEVEL_BG[topLevel])
        // 幂等：只挂一次事件；hover/click 联动到该段第一条风险（其余风险经右侧卡片点选定位）
        if (!el.dataset.hoverHooked) {
            const firstId = risks[0]!.id
            el.addEventListener('mouseenter', () => emit('hoverClause', firstId))
            el.addEventListener('mouseleave', () => emit('hoverClause', null))
            el.addEventListener('click', () => emit('focusRisk', firstId))
            el.dataset.hoverHooked = '1'
        }
    }
    return notLocatedIds
}

/** 等一帧浏览器 paint + 可选延迟 */
function nextFrame(ms = 0): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => {
            if (ms > 0) setTimeout(resolve, ms)
            else resolve()
        })
    })
}

/**
 * renderAsync 完成后遍历 risks 定位段落并注入样式。
 *
 * 为什么要重试：docx-preview 的 renderAsync 在某些场景下 Promise resolve 时
 * DOM 并未真的稳定（字体/图片异步 load、段落 layout 异步计算），立即跑
 * querySelectorAll('p') 可能返回空或元素 textContent 为空，所有风险都被
 * 误判为"未定位"。用户表现：分析完立刻全部显示"未定位"，刷新页面后恢复。
 *
 * 策略：decorate 一次后检查"全未命中且 risks 非空"，若是说明 DOM 还没准备好，
 * 等一帧（最多 rAF + 100ms）再跑，最多 3 次。一旦某次有命中就 emit 停止。
 */
async function decorateRisks(): Promise<void> {
    if (!containerRef.value || props.risks.length === 0) {
        paintQuoteHighlights()
        emit('locateResult', runDecorateOnce())
        return
    }
    let notLocated = runDecorateOnce()
    if (notLocated.size < props.risks.length) {
        paintQuoteHighlights()
        emit('locateResult', notLocated)
        return
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
        await nextFrame(attempt * 80)
        notLocated = runDecorateOnce()
        if (notLocated.size < props.risks.length) break
    }
    paintQuoteHighlights()
    emit('locateResult', notLocated)
}

/**
 * PR 5 · § 7.5 焦点 1 秒衰减窗口。
 * focusedRiskId 变化时由 watch 置 true + 启动 1 秒 setTimeout 关闭；
 * pickHighlightState 在窗口关闭后把 quote-focused 衰减为 quote-default。
 */
const flashWindowActive = ref(false)
let flashWindowTimer: ReturnType<typeof setTimeout> | null = null

function paintQuoteHighlights(): void {
    if (!containerRef.value) return
    decorateQuoteRanges(props.risks, containerRef.value, {
        focusedRiskId: props.focusedRiskId ?? null,
        pinnedRiskIds: props.pinnedRiskIds,
        flashWindowActive: flashWindowActive.value,
    })
}

function startFlashWindow(): void {
    flashWindowActive.value = true
    if (flashWindowTimer) clearTimeout(flashWindowTimer)
    flashWindowTimer = setTimeout(() => {
        flashWindowActive.value = false
        flashWindowTimer = null
        paintQuoteHighlights()
    }, 1000)
}

onBeforeUnmount(() => {
    if (flashWindowTimer) {
        clearTimeout(flashWindowTimer)
        flashWindowTimer = null
    }
    containerRef.value?.removeEventListener('scroll', syncAddBtnPos)
})

async function loadDocx(fileId: number) {
    const seq = ++fetchSeq
    loading.value = true
    try {
        const urlResp = await useApiFetch<Array<{ ossFileId: number; downloadUrl: string }>>(
            '/api/v1/files/oss/download-url',
            { method: 'POST', body: { ossFileIds: [fileId] }, showError: false } as any,
        )
        const downloadUrl = urlResp?.[0]?.downloadUrl
        if (seq !== fetchSeq || !downloadUrl) return
        const resp = await fetch(downloadUrl)
        if (seq !== fetchSeq) return
        if (!resp.ok) throw new Error(`下载合同失败: ${resp.status}`)
        const buffer = await resp.arrayBuffer()
        if (seq !== fetchSeq || !containerRef.value) return
        // renderAsync 可能耗时几百 ms，期间若用户切换到新文件必须整体放弃。
        // 用本地 target 捕获当前 containerRef，避免渲染到过期的 DOM 节点。
        const target = containerRef.value
        // PR 5：renderAsync 替换 target.innerHTML 后，CSS.highlights 持有的 Range
        // 引用旧 text node 失效；必须先清空全部命名 Highlight（spec § 7.4 重渲染保护）
        clearAllQuoteHighlights()
        target.innerHTML = ''
        await renderAsync(buffer, target, undefined, { inWrapper: true })
        if (seq !== fetchSeq) {
            // 新的 loadDocx 已经开始，本次渲染产物作废。
            // 不强制清空 target.innerHTML：新 loadDocx 会在它那次 renderAsync 前自行清空，
            // 贸然清空反而可能抹掉新 render 已完成的内容。
            return
        }
        // 渲染完成后注入风险标记
        decorateRisks()
    } catch (err) {
        // UI-M8：之前只 console.warn 让用户看到永久空白；改为 toast 提示，
        // 同时保留原有 DOM 内容（不强制清空），用户可刷新或重试
        console.warn('合同预览渲染失败', err)
        toast.error('合同预览加载失败，请刷新重试')
    } finally {
        if (seq === fetchSeq) loading.value = false
    }
}

watch(
    () => props.reviewedFileId ?? props.originalFileId,
    (id) => { if (id) loadDocx(id) },
    { immediate: true },
)

// risks 变化时重新 decorate（新增风险场景）
// 门控：文档加载中时跳过，loadDocx 完成后自己会调 decorateRisks。
// 不跳过会导致分析完成时（reviewedFileId 从 null 变为新值，risks 同时刷新）
// decorateRisks 跑在新文档渲染前，DOM 为空，所有风险被误报为"未定位"。
watch(() => props.risks, () => { if (!loading.value) decorateRisks() }, { deep: false })

// 聚焦/钉/悬停态样式切换（spec §7.1 段落视觉基线 + § 7.5 1 秒衰减 + § 7.6 quote 三态矩阵）
watch(
    [() => props.focusedRiskId, () => props.pinnedRiskIds, () => props.hoveredRiskId, () => props.risks],
    (newVals, oldVals) => {
        if (!containerRef.value) return
        containerRef.value.querySelectorAll('[data-risk-ids]').forEach(el => {
            const ids = ((el as HTMLElement).dataset.riskIds ?? '').split(' ').filter(Boolean)
            if (ids.length === 0) return
            const isActive = props.focusedRiskId != null && ids.includes(props.focusedRiskId)
            const isPinned = !isActive && ids.some(id => props.pinnedRiskIds.has(id))
            const isHovered = !isActive && !isPinned
                && props.hoveredRiskId != null && ids.includes(props.hoveredRiskId)

            const level = ((el as HTMLElement).dataset.riskLevel ?? 'low') as RiskLevel
            for (const lv of Object.keys(LEVEL_RANK) as RiskLevel[]) {
                el.classList.remove(...RISK_LEVEL_DOCX_FOCUS_CLASS[lv], RISK_LEVEL_DOCX_HOVER_BG[lv])
            }
            if (isActive || isPinned) {
                el.classList.add(...RISK_LEVEL_DOCX_FOCUS_CLASS[level])
            } else if (isHovered) {
                el.classList.add(RISK_LEVEL_DOCX_HOVER_BG[level])
            }
        })
        // focused 切到新 risk → 滚动定位 + 启动 1 秒衰减窗口（spec § 7.5）
        const prevFocused = (oldVals?.[0] ?? null) as string | null
        const newFocused = (newVals[0] ?? null) as string | null
        if (newFocused && newFocused !== prevFocused) {
            // 仅在 focusedRiskId 真正切换时滚动定位——watch 同时监听 hovered/pinned/risks，
            // 每次触发都滚会把预览区反复拽回 focused 段落，用户无法手动滚动。
            // 且只滚容器自身：scrollIntoView 会连带滚动外层页面容器造成"跳屏"。
            const c = containerRef.value
            const el = c.querySelector(`[data-risk-ids~="${newFocused}"]`)
            if (el instanceof HTMLElement) {
                const elRect = el.getBoundingClientRect()
                const cRect = c.getBoundingClientRect()
                const top = c.scrollTop + (elRect.top - cRect.top) - (c.clientHeight - elRect.height) / 2
                c.scrollTo({ top, behavior: 'smooth' })
            }
            startFlashWindow()
        }

        // quote 高亮三态只取决于 focused / pinned / risks（pickHighlightState 不看 hovered）；
        // 仅 hovered 变化时跳过重算，避免鼠标在风险卡片间移动反复 clear + 重建 Highlight。
        if (newVals[0] !== oldVals?.[0] || newVals[1] !== oldVals?.[1] || newVals[3] !== oldVals?.[3]) {
            paintQuoteHighlights()
        }
    },
)
</script>

<template>
    <div class="relative h-full flex flex-col">
        <div v-if="empty" class="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            等待合同上传...
        </div>
        <template v-else>
            <div v-if="loading" class="absolute top-2 left-1/2 -translate-x-1/2 text-xs text-muted-foreground z-10">
                合同加载中...
            </div>
            <!-- 文档容器：bg-card 作纸面托盘，.docx 原生白纸由 wrapper 居中陈列 -->
            <div class="relative flex-1 min-h-0" @mouseleave="hoveredParagraph = null">
                <div
                    ref="containerRef"
                    class="docx-preview-container h-full overflow-y-auto rounded-md bg-card p-4"
                    @mouseover="onContainerMouseOver"
                />
                <button
                    v-if="hoveredParagraph"
                    type="button"
                    class="absolute z-20 flex size-[22px] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md hover:scale-110 transition"
                    :style="{ top: addBtnTop + 'px', left: addBtnLeft + 'px' }"
                    title="在此段落新增风险"
                    @click.stop="onAddBtnClick"
                >
                    <PlusIcon class="size-3" />
                </button>
            </div>
        </template>
    </div>
</template>

<!--
  纸面约定（对齐设计稿）：
  - .docx-wrapper 透明 + 无阴影（外层容器已提供背景）
  - section.docx 保留 docx-preview 默认白色纸面，去 margin/阴影、补页边距
  - 正文行距 1.95
-->
<style scoped>
.docx-preview-container :deep(.docx-wrapper) {
    background: transparent;
    padding: 0;
    box-shadow: none;
}
.docx-preview-container :deep(.docx) {
    box-shadow: none !important;
    margin: 0 !important;
    /* 纸面内页边距：docx-preview 对纯文本粘贴场景默认 padding=0，正文会贴纸面边，
       这里补回页边距（对齐设计稿 40/56/64）。 */
    padding: 40px 56px 64px !important;
}
.docx-preview-container :deep(p),
.docx-preview-container :deep(li),
.docx-preview-container :deep(h1),
.docx-preview-container :deep(h2),
.docx-preview-container :deep(h3),
.docx-preview-container :deep(h4),
.docx-preview-container :deep(h5),
.docx-preview-container :deep(h6) {
    line-height: 1.95 !important;
}
</style>
