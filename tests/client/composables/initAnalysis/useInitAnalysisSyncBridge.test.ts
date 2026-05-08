/**
 * useInitAnalysisSyncBridge 跨标签广播测试
 *
 * 修复背景：分析"开始"瞬间没有广播
 * - watch syncSummary 仅在 (resultKeys/failedKeys/hasInterrupt/selectedModules) 变化时广播
 * - watch isLoading 旧实现仅在 true → false（结束）时广播
 * - 用户点"开始分析"瞬间，syncSummary 不立即变化（stream.values 还没第一帧）
 *   且 isLoading 是 false → true，所以详情页 tab 收不到通知
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, effectScope, nextTick } from 'vue'

const postCrossTabEventMock = vi.fn()
vi.mock('~/composables/useCrossTabEvents', () => ({
    postCrossTabEvent: (...args: any[]) => postCrossTabEventMock(...args),
    useCrossTabListener: () => { /* no-op：本测试只关心发送侧 */ },
}))

vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: vi.fn().mockResolvedValue(null),
}))

const { useInitAnalysisSyncBridge } = await import('~/composables/initAnalysis/useInitAnalysisSyncBridge')
import type { SyncSummary } from '~/composables/initAnalysis/types'

function defaultSummary(overrides: Partial<SyncSummary> = {}): SyncSummary {
    return {
        resultKeys: [],
        failedKeys: [],
        hasInterrupt: false,
        selectedModules: ['summary'],
        ...overrides,
    }
}

beforeEach(() => {
    postCrossTabEventMock.mockReset()
})

describe('useInitAnalysisSyncBridge · isLoading 双向广播', () => {
    it('isLoading false → true（分析开始瞬间）应立即广播 analysis:updated', async () => {
        const caseId = ref(123)
        const sessionId = ref('s1')
        const isLoading = ref(false)
        const summary = ref<SyncSummary>(defaultSummary())
        const syncSummary = computed(() => summary.value)

        const scope = effectScope()
        scope.run(() => {
            useInitAnalysisSyncBridge({
                caseId,
                sessionId,
                syncSummary,
                isLoading,
                refreshGlobalStatus: vi.fn(),
                onExternalGenerating: vi.fn(),
            })
        })

        await nextTick()
        postCrossTabEventMock.mockClear()

        // 模拟点"开始分析"：stream.submit → isLoading 变 true
        isLoading.value = true
        await nextTick()

        expect(postCrossTabEventMock).toHaveBeenCalledWith('analysis:updated', { caseId: 123 })

        scope.stop()
    })

    it('isLoading true → false（分析结束）应广播 analysis:updated', async () => {
        const caseId = ref(123)
        const sessionId = ref('s1')
        const isLoading = ref(true)
        const summary = ref<SyncSummary>(defaultSummary())
        const syncSummary = computed(() => summary.value)

        const scope = effectScope()
        scope.run(() => {
            useInitAnalysisSyncBridge({
                caseId,
                sessionId,
                syncSummary,
                isLoading,
                refreshGlobalStatus: vi.fn(),
                onExternalGenerating: vi.fn(),
            })
        })

        await nextTick()
        postCrossTabEventMock.mockClear()

        isLoading.value = false
        await nextTick()

        expect(postCrossTabEventMock).toHaveBeenCalledWith('analysis:updated', { caseId: 123 })

        scope.stop()
    })

    it('caseId <= 0 时即便 isLoading 变化也不广播（避免 setup 期未初始化时误发）', async () => {
        const caseId = ref(0)
        const sessionId = ref('s1')
        const isLoading = ref(false)
        const summary = ref<SyncSummary>(defaultSummary())
        const syncSummary = computed(() => summary.value)

        const scope = effectScope()
        scope.run(() => {
            useInitAnalysisSyncBridge({
                caseId,
                sessionId,
                syncSummary,
                isLoading,
                refreshGlobalStatus: vi.fn(),
                onExternalGenerating: vi.fn(),
            })
        })

        await nextTick()
        postCrossTabEventMock.mockClear()

        isLoading.value = true
        await nextTick()
        isLoading.value = false
        await nextTick()

        expect(postCrossTabEventMock).not.toHaveBeenCalled()

        scope.stop()
    })
})
