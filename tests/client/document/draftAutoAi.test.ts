/**
 * 文书页 autoAi=1 启动逻辑（纯函数契约测试）
 *
 * 文书草稿页 onMounted 检测到 route.query.autoAi === '1' 时，应该：
 *   1. 唤起 AI 浮窗（openAgent）
 *   2. 自动发出生成指令（handleChatSubmit）
 *   3. 清除 autoAi query 参数防止刷新重复触发，其他 query 保留
 *
 * 此测试只锁定上述行为契约（纯函数），便于 onMounted 内的 watch 直接照搬。
 *
 * **Feature: case-features-iter / Phase D**
 * **Validates: spec §3.3 + plan Task D2**
 */
import { describe, it, expect, vi } from 'vitest'

interface Route {
    query: Record<string, any>
}

interface Draft {
    templateName?: string
}

/**
 * 与 document/drafts/[id].vue 中 onMounted+watch 内联逻辑对齐的纯函数实现。
 * 任何修改请同步两边。
 */
function handleAutoAi(route: Route, draft: Draft | null, deps: {
    openAgent: () => void
    handleChatSubmit: (msg: { text: string }) => void
    router: { replace: (loc: any) => void }
}) {
    if (route.query.autoAi !== '1') return
    if (!draft) return
    const templateName = draft.templateName ?? '本文书'
    deps.openAgent()
    deps.handleChatSubmit({ text: `请根据当前案件信息生成《${templateName}》` })
    const { autoAi: _autoAi, ...rest } = route.query
    deps.router.replace({ query: { ...rest } })
}

describe('文书页 autoAi 启动逻辑', () => {
    it('autoAi=1 且草稿就绪后调 openAgent 并发送指令', async () => {
        const openAgent = vi.fn()
        const handleChatSubmit = vi.fn()
        const router = { replace: vi.fn() }

        handleAutoAi(
            { query: { autoAi: '1', from: 'case', caseId: '7', returnTab: 'documents' } },
            { templateName: '民事起诉状' },
            { openAgent, handleChatSubmit, router },
        )
        expect(openAgent).toHaveBeenCalledOnce()
        expect(handleChatSubmit).toHaveBeenCalledWith({ text: '请根据当前案件信息生成《民事起诉状》' })
        expect(router.replace).toHaveBeenCalledWith({ query: { from: 'case', caseId: '7', returnTab: 'documents' } })
    })

    it('autoAi 不为 1 时不触发', async () => {
        const openAgent = vi.fn()
        const handleChatSubmit = vi.fn()
        handleAutoAi(
            { query: { from: 'case' } },
            { templateName: '民事起诉状' },
            { openAgent, handleChatSubmit, router: { replace: vi.fn() } },
        )
        expect(openAgent).not.toHaveBeenCalled()
        expect(handleChatSubmit).not.toHaveBeenCalled()
    })

    it('草稿尚未就绪（draft 为 null）时不触发', async () => {
        const openAgent = vi.fn()
        handleAutoAi(
            { query: { autoAi: '1' } },
            null,
            { openAgent, handleChatSubmit: vi.fn(), router: { replace: vi.fn() } },
        )
        expect(openAgent).not.toHaveBeenCalled()
    })

    it('templateName 缺失时使用兜底文案「本文书」', async () => {
        const handleChatSubmit = vi.fn()
        handleAutoAi(
            { query: { autoAi: '1' } },
            {},
            { openAgent: vi.fn(), handleChatSubmit, router: { replace: vi.fn() } },
        )
        expect(handleChatSubmit).toHaveBeenCalledWith({ text: '请根据当前案件信息生成《本文书》' })
    })

    it('清除 autoAi 后保留其他 query 字段', async () => {
        const router = { replace: vi.fn() }
        handleAutoAi(
            { query: { autoAi: '1', from: 'case', caseId: '7', returnTab: 'documents', extra: 'ok' } },
            { templateName: '答辩状' },
            { openAgent: vi.fn(), handleChatSubmit: vi.fn(), router },
        )
        const call = router.replace.mock.calls[0][0]
        expect(call.query.autoAi).toBeUndefined()
        expect(call.query.from).toBe('case')
        expect(call.query.caseId).toBe('7')
        expect(call.query.returnTab).toBe('documents')
        expect(call.query.extra).toBe('ok')
    })
})
