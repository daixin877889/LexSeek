/**
 * useContractRiskHighlight composable 测试
 *
 * 风险高亮 + 定位状态机（原 useContractReview M6.1 Task 4.2 测试搬迁过来）。
 *
 * **Feature: contract-review-risk-highlight**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { effectScope } from 'vue'
import { useContractRiskHighlight } from '~/composables/useContractRiskHighlight'

// 用 effectScope 包一层，以便 onScopeDispose 注册的清理 hook 不会报无 scope 警告
function createInScope<T>(factory: () => T) {
    const scope = effectScope()
    let api: T
    scope.run(() => {
        api = factory()
    })
    return { api: api!, scope }
}

describe('useContractRiskHighlight 聚焦/钉/悬停状态机', () => {
    beforeEach(() => {
        vi.useRealTimers()
    })

    it('focusRisk 切换 focusedRiskId', () => {
        const { api } = createInScope(() => useContractRiskHighlight())
        expect(api.focusedRiskId.value).toBeNull()
        api.focusRisk('r1')
        expect(api.focusedRiskId.value).toBe('r1')
        api.focusRisk(null)
        expect(api.focusedRiskId.value).toBeNull()
    })

    it('focusRisk 拦截未定位 risk（不改 focusedRiskId）', () => {
        const { api } = createInScope(() => useContractRiskHighlight())
        api.markLocated(new Set(['notLoc-1']))
        api.focusRisk('notLoc-1')
        expect(api.focusedRiskId.value).toBeNull()
        // 已定位的可以正常 focus
        api.focusRisk('located-1')
        expect(api.focusedRiskId.value).toBe('located-1')
    })

    it('setHoveredRisk 设置 hoveredRiskId', () => {
        const { api } = createInScope(() => useContractRiskHighlight())
        expect(api.hoveredRiskId.value).toBeNull()
        api.setHoveredRisk('r2')
        expect(api.hoveredRiskId.value).toBe('r2')
    })

    it('setHoveredRisk 3 秒后自动清零', () => {
        vi.useFakeTimers()
        const { api } = createInScope(() => useContractRiskHighlight())
        api.setHoveredRisk('r1')
        expect(api.hoveredRiskId.value).toBe('r1')
        vi.advanceTimersByTime(3000)
        expect(api.hoveredRiskId.value).toBeNull()
        vi.useRealTimers()
    })

    it('setHoveredRisk(null) 立即清零并停计时器', () => {
        vi.useFakeTimers()
        const { api } = createInScope(() => useContractRiskHighlight())
        api.setHoveredRisk('r3')
        expect(api.hoveredRiskId.value).toBe('r3')
        api.setHoveredRisk(null)
        expect(api.hoveredRiskId.value).toBeNull()
        // 3 秒后也不应有副作用（timer 已被 clear）
        vi.advanceTimersByTime(3000)
        expect(api.hoveredRiskId.value).toBeNull()
        vi.useRealTimers()
    })

    it('旧 timer 过期后不污染 hoveredRiskId（双向清理回归）', () => {
        vi.useFakeTimers()
        const { api } = createInScope(() => useContractRiskHighlight())
        // 1. 先设 r1（启动 3s 定时器 A）
        api.setHoveredRisk('r1')
        expect(api.hoveredRiskId.value).toBe('r1')
        // 2. 2s 后改为 null（应立即清零 + clear 定时器 A，hoverTimer 置 null）
        vi.advanceTimersByTime(2000)
        api.setHoveredRisk(null)
        expect(api.hoveredRiskId.value).toBeNull()
        // 3. 再等 3s：定时器 A 若未被 clear，残留回调不应误置状态
        vi.advanceTimersByTime(3000)
        expect(api.hoveredRiskId.value).toBeNull()
        // 4. 再次 setHoveredRisk('x')：不受旧 handle 干扰，新 3s 定时器正常工作
        api.setHoveredRisk('x')
        expect(api.hoveredRiskId.value).toBe('x')
        vi.advanceTimersByTime(3000)
        expect(api.hoveredRiskId.value).toBeNull()
        vi.useRealTimers()
    })

    it('hoveredRiskId 不进入 highlightedRiskIds（与 focused/pinned 独立）', () => {
        const { api } = createInScope(() => useContractRiskHighlight())
        api.setHoveredRisk('r-hover')
        expect(api.hoveredRiskId.value).toBe('r-hover')
        expect(api.highlightedRiskIds.value.has('r-hover')).toBe(false)
    })

    it('togglePin 第一次加入 / 第二次移除', () => {
        const { api } = createInScope(() => useContractRiskHighlight())
        expect(api.pinnedRiskIds.value.size).toBe(0)
        api.togglePin('r4')
        expect(api.pinnedRiskIds.value.has('r4')).toBe(true)
        api.togglePin('r4')
        expect(api.pinnedRiskIds.value.has('r4')).toBe(false)
    })

    it('highlightedRiskIds = focused + pinned 合集', () => {
        const { api } = createInScope(() => useContractRiskHighlight())
        api.focusRisk('focused-1')
        api.togglePin('pinned-1')
        api.togglePin('pinned-2')
        const ids = api.highlightedRiskIds.value
        expect(ids.has('focused-1')).toBe(true)
        expect(ids.has('pinned-1')).toBe(true)
        expect(ids.has('pinned-2')).toBe(true)
        expect(ids.size).toBe(3)
    })

    it('clearAllPins 清空 pinnedRiskIds', () => {
        const { api } = createInScope(() => useContractRiskHighlight())
        api.togglePin('r5')
        api.togglePin('r6')
        expect(api.pinnedRiskIds.value.size).toBe(2)
        api.clearAllPins()
        expect(api.pinnedRiskIds.value.size).toBe(0)
    })
})

describe('useContractRiskHighlight 定位状态（notLocatedIds + hasLocated）', () => {
    it('初始 hasLocated=false，notLocatedIds 为空 Set', () => {
        const { api } = createInScope(() => useContractRiskHighlight())
        expect(api.hasLocated.value).toBe(false)
        expect(api.notLocatedIds.value.size).toBe(0)
    })

    it('markLocated 首次调用置 hasLocated=true 并写入 notLocatedIds', () => {
        const { api } = createInScope(() => useContractRiskHighlight())
        api.markLocated(new Set(['a', 'b']))
        expect(api.hasLocated.value).toBe(true)
        expect(api.notLocatedIds.value.has('a')).toBe(true)
        expect(api.notLocatedIds.value.has('b')).toBe(true)
        expect(api.notLocatedIds.value.size).toBe(2)
    })

    it('markLocated 内容相同时短路写入（避免下游 watcher 重复触发）', () => {
        const { api } = createInScope(() => useContractRiskHighlight())
        const first = new Set(['x'])
        api.markLocated(first)
        const refBefore = api.notLocatedIds.value
        // 传入新 Set 但内容相同
        api.markLocated(new Set(['x']))
        // 引用未变（短路）
        expect(api.notLocatedIds.value).toBe(refBefore)
    })

    it('markLocated 内容变化时正常写入新 Set', () => {
        const { api } = createInScope(() => useContractRiskHighlight())
        api.markLocated(new Set(['x']))
        api.markLocated(new Set(['y']))
        expect(api.notLocatedIds.value.has('x')).toBe(false)
        expect(api.notLocatedIds.value.has('y')).toBe(true)
    })

    it('reset 清空 hasLocated + notLocatedIds（不动 focused/pinned/hover）', () => {
        const { api } = createInScope(() => useContractRiskHighlight())
        api.markLocated(new Set(['z']))
        api.focusRisk('f1')
        api.togglePin('p1')
        api.setHoveredRisk('h1')

        api.reset()
        expect(api.hasLocated.value).toBe(false)
        expect(api.notLocatedIds.value.size).toBe(0)
        // 三态高亮不应被 reset 影响
        expect(api.focusedRiskId.value).toBe('f1')
        expect(api.pinnedRiskIds.value.has('p1')).toBe(true)
        expect(api.hoveredRiskId.value).toBe('h1')
    })
})
