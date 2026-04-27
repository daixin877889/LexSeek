/**
 * useCaseLinker 单元测试（阶段 5 · Task 12/13 共用 composable）
 *
 * 验证：
 * - openLinker / closeLinker 切换 dialog 状态
 * - linkCase: variant=document 走 PATCH /api/v1/assistant/document/drafts/:id
 * - linkCase: variant=contract 走 PATCH /api/v1/assistant/contract/reviews/:id
 * - linkCase 成功后调用 onLinked + 关闭 dialog
 * - linkCase 失败（useApiFetch 返回 null）保持 dialog 打开
 * - entityId 无效（null/0）拒绝执行
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

const useApiFetchMock = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: unknown[]) => useApiFetchMock(...args),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('vue-sonner', () => ({
    toast: {
        success: (...a: unknown[]) => toastSuccess(...a),
        error: (...a: unknown[]) => toastError(...a),
    },
}))

import { useCaseLinker } from '~/composables/useCaseLinker'

describe('useCaseLinker', () => {
    beforeEach(() => {
        useApiFetchMock.mockReset()
        toastSuccess.mockReset()
        toastError.mockReset()
    })

    it('openLinker / closeLinker 切换 dialogOpen', () => {
        const linker = useCaseLinker({ variant: 'document', entityId: ref(123) })
        expect(linker.dialogOpen.value).toBe(false)
        linker.openLinker()
        expect(linker.dialogOpen.value).toBe(true)
        linker.closeLinker()
        expect(linker.dialogOpen.value).toBe(false)
    })

    it('variant=document 调用 PATCH 文书草稿接口', async () => {
        useApiFetchMock.mockResolvedValueOnce({})
        const onLinked = vi.fn()
        const linker = useCaseLinker({
            variant: 'document',
            entityId: ref(42),
            onLinked,
        })
        linker.dialogOpen.value = true
        await linker.linkCase(7)

        expect(useApiFetchMock).toHaveBeenCalledWith(
            '/api/v1/assistant/document/drafts/42',
            expect.objectContaining({ method: 'PATCH', body: { caseId: 7 } }),
        )
        expect(onLinked).toHaveBeenCalledWith(7)
        expect(toastSuccess).toHaveBeenCalledWith('已关联到案件')
        expect(linker.dialogOpen.value).toBe(false)
    })

    it('variant=contract 调用 PATCH 合同审查接口 + caseId=null 解绑文案', async () => {
        useApiFetchMock.mockResolvedValueOnce({})
        const linker = useCaseLinker({ variant: 'contract', entityId: ref(99) })
        await linker.linkCase(null)

        expect(useApiFetchMock).toHaveBeenCalledWith(
            '/api/v1/assistant/contract/reviews/99',
            expect.objectContaining({ method: 'PATCH', body: { caseId: null } }),
        )
        expect(toastSuccess).toHaveBeenCalledWith('已解除案件关联')
    })

    it('PATCH 失败（返回 null）保持 dialog 打开 + 不调 onLinked', async () => {
        useApiFetchMock.mockResolvedValueOnce(null)
        const onLinked = vi.fn()
        const linker = useCaseLinker({ variant: 'document', entityId: ref(1), onLinked })
        linker.dialogOpen.value = true
        await linker.linkCase(2)

        expect(onLinked).not.toHaveBeenCalled()
        expect(toastSuccess).not.toHaveBeenCalled()
        expect(linker.dialogOpen.value).toBe(true)
    })

    it('entityId 为 null 时拒绝执行 + 弹错误 toast', async () => {
        const linker = useCaseLinker({ variant: 'document', entityId: ref(null) })
        await linker.linkCase(5)

        expect(useApiFetchMock).not.toHaveBeenCalled()
        expect(toastError).toHaveBeenCalledWith('当前记录尚未加载完成，请稍后重试')
    })

    it('submitting 中再次 linkCase 被去抖（不重复 PATCH）', async () => {
        let resolve: (v: unknown) => void = () => {}
        useApiFetchMock.mockReturnValueOnce(new Promise(r => { resolve = r }))
        const linker = useCaseLinker({ variant: 'document', entityId: ref(1) })
        const first = linker.linkCase(2)
        // 第一次 in-flight 时第二次直接被去抖
        const second = linker.linkCase(3)
        await second
        expect(useApiFetchMock).toHaveBeenCalledTimes(1)
        resolve({})
        await first
    })
})
