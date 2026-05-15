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
import { locateClauseElement, paragraphIndexOfElement } from '#shared/utils/clauseLocator'
import type { Risk, RiskDisplayPhaseB, RiskLevel } from '#shared/types/contract'
// UI-L1：从 app/utils/contractRiskLevelStyle.ts 单一数据源 import，
// 与 RiskListPanel 的徽章配色统一维护。
import { RISK_LEVEL_DOCX_BG_CLASS as LEVEL_BG } from '~/utils/contractRiskLevelStyle'
import { useApiFetch } from '~/composables/useApiFetch'
import {
    decorateQuoteRanges,
    clearAllQuoteHighlights,
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

/** 可新增段落：section.docx 直接子级、非空 <p>，排除表格内段落 */
function isAddableParagraph(el: Element | null): el is HTMLElement {
    if (!el || !(el instanceof HTMLElement) || el.tagName !== 'P') return false
    if ((el.textContent ?? '').trim().length === 0) return false
    if (el.closest('td')) return false
    if (!el.parentElement?.classList.contains('docx')) return false
    return true
}

function syncAddBtnTop() {
    const para = hoveredParagraph.value
    const c = containerRef.value
    if (!para || !c) return
    addBtnTop.value = para.offsetTop - c.scrollTop
}

function onContainerMouseOver(e: MouseEvent) {
    const para = (e.target as HTMLElement | null)?.closest('p') ?? null
    if (!isAddableParagraph(para)) {
        hoveredParagraph.value = null
        return
    }
    hoveredParagraph.value = para
    syncAddBtnTop()
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
onMounted(() => containerRef.value?.addEventListener('scroll', syncAddBtnTop))

// 每次 load 触发时递增；仅最新 seq 允许继续写入 DOM，防止过期请求覆盖
let fetchSeq = 0

/**
 * 风险等级对应的底色 + 左边框基础样式。
 *
 * 注：文档"纸面"保持白色（Word 预览惯例），不随全局 dark 主题翻转；
 * 因此段落高亮只用 light 变体，避免在白纸上出现暗色块的突兀对比。
 */
/** 内部函数：在 DOM 里跑一次定位，返回没匹配到的 riskId 集合（不发 emit） */
function runDecorateOnce(): Set<string> {
    if (!containerRef.value) return new Set(props.risks.map(r => r.id))
    const notLocatedIds = new Set<string>()
    for (const risk of props.risks) {
        // 优先级 0：clauseParagraphIndex 直定位（与后端"非空段落序号"空间一致），
        // 解决 reviewed docx 注入批注后 textContent 与原 clause_text 微差异（全角空格、
        // 标点变体）导致的"未定位"误报。详见 shared/utils/clauseLocator.ts。
        const el = locateClauseElement(containerRef.value, risk.clauseText, risk.clauseParagraphIndex)
        if (!el || !(el instanceof HTMLElement)) {
            notLocatedIds.add(risk.id)
            continue
        }
        // 幂等：已装饰（由 dataset.riskId 标记）直接跳过，避免 LEVEL_BG class 叠加
        if (el.dataset.riskId === risk.id) continue
        el.dataset.riskId = risk.id
        el.dataset.riskLevel = risk.level
        el.classList.add(...LEVEL_BG[risk.level])
        // 幂等：只挂一次事件
        if (!el.dataset.hoverHooked) {
            el.addEventListener('mouseenter', () => emit('hoverClause', risk.id))
            el.addEventListener('mouseleave', () => emit('hoverClause', null))
            el.addEventListener('click', () => emit('focusRisk', risk.id))
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
    containerRef.value?.removeEventListener('scroll', syncAddBtnTop)
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
        containerRef.value.querySelectorAll('[data-risk-id]').forEach(el => {
            const id = (el as HTMLElement).dataset.riskId
            if (!id) return
            const isActive = id === props.focusedRiskId
            const isPinned = props.pinnedRiskIds.has(id) && !isActive
            const isHovered = id === props.hoveredRiskId && !isActive && !isPinned

            el.classList.remove(
                'bg-yellow-200', 'border-l-[5px]', 'border-red-700',
                '[box-shadow:0_0_0_1px_#b91c1c]',
                'bg-yellow-50',
            )
            if (isActive || isPinned) {
                el.classList.add(
                    'bg-yellow-200', 'border-l-[5px]', 'border-red-700',
                    '[box-shadow:0_0_0_1px_#b91c1c]',
                )
            }
            if (isHovered) {
                el.classList.add('bg-yellow-50')
            }
        })
        if (props.focusedRiskId) {
            const el = containerRef.value.querySelector(`[data-risk-id="${props.focusedRiskId}"]`)
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }

        // PR 5：focused 切到新 risk → 启动 1 秒衰减窗口（spec § 7.5）
        const prevFocused = (oldVals?.[0] ?? null) as string | null
        const newFocused = (newVals[0] ?? null) as string | null
        if (newFocused && newFocused !== prevFocused) {
            startFlashWindow()
        }

        // PR 5：派系字符级 quote 高亮三态（spec § 7.6 矩阵）
        paintQuoteHighlights()
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
            <!-- 白纸：bg-background 浅色=白 / 暗色=深主题色；.docx 原生白纸居中陈列 -->
            <div class="relative flex-1 min-h-0">
                <div
                    ref="containerRef"
                    class="docx-preview-container h-full overflow-y-auto rounded-md bg-background p-6"
                    @mouseover="onContainerMouseOver"
                />
                <button
                    v-if="hoveredParagraph"
                    type="button"
                    class="absolute left-3 z-20 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow hover:scale-110 transition"
                    :style="{ top: addBtnTop + 'px' }"
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
  对齐文书编辑器 DocumentPreview 的纸面约定：
  - .docx-wrapper 透明 + 无阴影（外层容器已提供背景）
  - section.docx 保留 docx-preview 默认白色纸面，仅去 margin/阴影避免重复
  - 正文行距统一 1.8，与 DocumentPreview 一致
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
    /* Word 风格内页边距：纯文本粘贴场景下 docx-preview 给 section 默认 padding=0，
       会让正文和风险左边框直接贴纸面边。这里补回 32px 48px 页边距。 */
    padding: 32px 48px !important;
}
.docx-preview-container :deep(p),
.docx-preview-container :deep(li),
.docx-preview-container :deep(h1),
.docx-preview-container :deep(h2),
.docx-preview-container :deep(h3),
.docx-preview-container :deep(h4),
.docx-preview-container :deep(h5),
.docx-preview-container :deep(h6) {
    line-height: 1.8 !important;
}
</style>
