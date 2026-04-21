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
import { locateClauseElement } from '#shared/utils/clauseLocator'
import type { Risk, RiskLevel } from '#shared/types/contract'

const props = withDefaults(defineProps<{
    reviewedFileId: number | null
    originalFileId: number | null
    risks?: Risk[]
    focusedRiskId?: string | null
    hoveredRiskId?: string | null
    /** pinned + focused，不含 hovered */
    highlightedRiskIds?: Set<string>
}>(), {
    risks: () => [],
    focusedRiskId: null,
    hoveredRiskId: null,
    highlightedRiskIds: () => new Set<string>(),
})

const emit = defineEmits<{
    focusRisk: [riskId: string]
    hoverClause: [riskId: string | null]
    locateResult: [notLocatedIds: Set<string>]
}>()

const containerRef = ref<HTMLElement | null>(null)
const loading = ref(false)
const empty = computed(() => !props.reviewedFileId && !props.originalFileId)

// 每次 load 触发时递增；仅最新 seq 允许继续写入 DOM，防止过期请求覆盖
let fetchSeq = 0

/**
 * 风险等级对应的底色 + 左边框基础样式。
 *
 * 注：文档"纸面"保持白色（Word 预览惯例），不随全局 dark 主题翻转；
 * 因此段落高亮只用 light 变体，避免在白纸上出现暗色块的突兀对比。
 */
const LEVEL_BG: Record<RiskLevel, string[]> = {
    high: ['bg-red-50', 'border-l-4', 'border-red-400'],
    medium: ['bg-orange-50', 'border-l-4', 'border-orange-400'],
    low: ['bg-slate-50', 'border-l-4', 'border-slate-400'],
}

/** renderAsync 完成后遍历 risks，用 clauseLocator 找到对应段落，注入属性和事件 */
function decorateRisks() {
    if (!containerRef.value) return
    const notLocatedIds = new Set<string>()
    for (const risk of props.risks) {
        const el = locateClauseElement(containerRef.value, risk.clauseText)
        if (!el || !(el instanceof HTMLElement)) {
            notLocatedIds.add(risk.id)
            continue
        }
        // 幂等：已装饰（由 dataset.riskId 标记）直接跳过，避免 LEVEL_BG class 叠加
        // 叠加 border-l-4 会和 focused 态的 border-l-[5px] 冲突，CSS 优先级不确定
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
    emit('locateResult', notLocatedIds)
}

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
        console.warn('合同预览渲染失败', err)
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
watch(() => props.risks, () => { decorateRisks() }, { deep: false })

// 聚焦/钉/悬停态样式切换（spec §7.1 视觉基线）
watch(
    [() => props.focusedRiskId, () => props.highlightedRiskIds, () => props.hoveredRiskId, () => props.risks],
    () => {
        if (!containerRef.value) return
        containerRef.value.querySelectorAll('[data-risk-id]').forEach(el => {
            const id = (el as HTMLElement).dataset.riskId
            if (!id) return
            const isActive = id === props.focusedRiskId
            const isPinned = props.highlightedRiskIds.has(id) && !isActive
            const isHovered = id === props.hoveredRiskId && !isActive && !isPinned

            // 幂等清理所有聚焦/钉/悬停样式
            el.classList.remove(
                'bg-yellow-200', 'border-l-[5px]', 'border-red-700',
                '[box-shadow:0_0_0_1px_#b91c1c]',
                'bg-yellow-50',
            )
            // active + pinned 同视觉（spec §7.1）
            if (isActive || isPinned) {
                el.classList.add(
                    'bg-yellow-200', 'border-l-[5px]', 'border-red-700',
                    '[box-shadow:0_0_0_1px_#b91c1c]',
                )
            }
            // hovered：淡黄底短暂提示，不加边框/光晕
            if (isHovered) {
                el.classList.add('bg-yellow-50')
            }
        })
        // 聚焦时滚到可视区（hover 不滚，避免鼠标划过文档时文档自己乱跳）
        if (props.focusedRiskId) {
            const el = containerRef.value.querySelector(`[data-risk-id="${props.focusedRiskId}"]`)
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
            <!-- 白纸：bg-background 浅色=白 / 暗色=深主题色；.docx 原生白纸居中陈列 -->
            <div
                ref="containerRef"
                class="docx-preview-container flex-1 min-h-0 overflow-y-auto rounded-md bg-background p-6 w-full max-w-5xl self-center"
            />
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
