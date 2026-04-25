/**
 * 合同审查风险高亮 + 定位状态 composable。
 *
 * 三态高亮（spec §6.2）：
 * - focused：点击进入，与 pinned 共同进入"持续高亮" highlightedRiskIds
 * - hovered：鼠标悬停 3s 内的临时高亮，独立态、不进 highlightedRiskIds
 * - pinned：钉住多条，可叠加于 focused 之上
 *
 * 定位状态（原 ContractReviewPanel.vue 的本地 state，UI-R8 合并）：
 * - notLocatedIds：DocxPreview decorate 完成后上报的"未定位 risk id 集合"
 * - hasLocated：首次 decorate 完成前置 false，避免空 set 让 UI 把所有 risk
 *   误判为"已定位"再瞬间翻回"未定位"造成视觉闪烁（参见 UI-M3）
 *
 * focusRisk 内置"未定位 risk 不跳转"拦截层，调用方不必再额外包一层 handler。
 *
 * @example
 * const focus = useContractRiskHighlight()
 * // 切文档/版本时：
 * watch(...) => focus.reset()
 * // DocxPreview decorate 完成时：
 * <DocxPreview @locate-result="focus.markLocated" />
 */

/** Set 内容相等比较；引用相同或元素一致返回 true（避免不必要的 ref 写入与下游 watcher） */
function setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a === b) return true
    if (a.size !== b.size) return false
    for (const v of a) if (!b.has(v)) return false
    return true
}

export function useContractRiskHighlight() {
    // === 三态高亮（focused / hovered / pinned）===
    const focusedRiskId = ref<string | null>(null)
    const hoveredRiskId = ref<string | null>(null)
    const pinnedRiskIds = ref<Set<string>>(new Set())

    // === 定位状态 ===
    const notLocatedIds = ref<Set<string>>(new Set())
    const hasLocated = ref(false)

    let hoverTimer: ReturnType<typeof setTimeout> | null = null

    /** 文档/卡片需要持续高亮的 riskId 集合 = focused + pinned（hover 不进来，视觉另一档） */
    const highlightedRiskIds = computed(() => {
        const s = new Set(pinnedRiskIds.value)
        if (focusedRiskId.value) s.add(focusedRiskId.value)
        return s
    })

    /**
     * 聚焦某条风险。
     * 内置拦截：未定位的 risk 不跳转文档（DOM 元素不存在），仅 RiskListPanel 内部
     * 维护展开/收起状态。
     */
    function focusRisk(riskId: string | null) {
        if (riskId && notLocatedIds.value.has(riskId)) return
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

    /**
     * 由 ContractDocxPreview 在 decorateRisks 完成后回调。
     * 入参为本次没匹配到段落的 riskId 集合（可能为空，全命中时也要传空 Set）。
     *
     * - 首次调用同时把 hasLocated 置 true（首次定位完成后 UI 才允许据此判 "未定位"）
     * - 内容等价性短路写入：避免 DocxPreview 的 watch(props.risks) 重复 emit 与下游
     *   ContractReviewPanel 重渲产生死循环（参见原 ContractReviewPanel 中的注释）
     */
    function markLocated(notLocated: Set<string>) {
        hasLocated.value = true
        if (setsEqual(notLocated, notLocatedIds.value)) return
        notLocatedIds.value = notLocated
    }

    /**
     * 切文档（原件 / 批注版）或切版本预览时调用：清空所有定位状态。
     * DocxPreview 会在新一次 renderAsync 完成后通过 markLocated 把 hasLocated
     * 置回 true。
     */
    function reset() {
        hasLocated.value = false
        notLocatedIds.value = new Set()
    }

    // 组件销毁时清理 hoverTimer，防止残留 setTimeout 修改已卸载组件的 ref（沿用 UI-H1）
    onScopeDispose(() => {
        if (hoverTimer) {
            clearTimeout(hoverTimer)
            hoverTimer = null
        }
    })

    return {
        // state
        focusedRiskId,
        hoveredRiskId,
        pinnedRiskIds,
        highlightedRiskIds,
        notLocatedIds,
        hasLocated,
        // actions
        focusRisk,
        setHoveredRisk,
        togglePin,
        clearAllPins,
        markLocated,
        reset,
    }
}
