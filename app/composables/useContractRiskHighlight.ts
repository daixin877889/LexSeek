/**
 * 合同审查风险卡片 / 文档段高亮态：focused / hovered / pinned 三态独立、可叠加。
 *
 * 抽出自 useContractReview，让主 composable 专注于流程编排（onStart/mountReview/
 * onDownload/onRebuildDocx 等），UI 高亮三态作为独立子 composable 复用。
 *
 * spec §6.2：
 *   - focused：点击进入，与 pinned 共同决定"持续高亮"集合
 *   - hovered：鼠标悬停 3s 内的临时高亮，独立态、不进 highlightedRiskIds
 *   - pinned：钉住多条，可叠加于 focused 之上
 */
export function useContractRiskHighlight() {
    const focusedRiskId = ref<string | null>(null)
    const hoveredRiskId = ref<string | null>(null)
    const pinnedRiskIds = ref<Set<string>>(new Set())

    let hoverTimer: ReturnType<typeof setTimeout> | null = null

    /** 文档/卡片需要持续高亮的 riskId 集合 = focused + pinned（hover 不进来，视觉另一档） */
    const highlightedRiskIds = computed(() => {
        const s = new Set(pinnedRiskIds.value)
        if (focusedRiskId.value) s.add(focusedRiskId.value)
        return s
    })

    function focusRisk(riskId: string | null) {
        focusedRiskId.value = riskId
    }

    function setHoveredRisk(riskId: string | null) {
        if (hoverTimer) {
            clearTimeout(hoverTimer)
            hoverTimer = null
        }
        hoveredRiskId.value = riskId
        if (riskId) {
            // 3 秒后自动清零；鼠标再次离开也会传 null 立即清零
            hoverTimer = setTimeout(() => {
                hoveredRiskId.value = null
                hoverTimer = null
            }, 3000)
        }
    }

    function togglePin(riskId: string) {
        const s = new Set(pinnedRiskIds.value)
        if (s.has(riskId)) s.delete(riskId); else s.add(riskId)
        pinnedRiskIds.value = s
    }

    function clearAllPins() {
        pinnedRiskIds.value = new Set()
    }

    // UI-H1：组件销毁时清掉 hoverTimer 防泄漏
    onScopeDispose(() => {
        if (hoverTimer) {
            clearTimeout(hoverTimer)
            hoverTimer = null
        }
    })

    return {
        focusedRiskId,
        hoveredRiskId,
        pinnedRiskIds,
        highlightedRiskIds,
        focusRisk,
        setHoveredRisk,
        togglePin,
        clearAllPins,
    }
}
