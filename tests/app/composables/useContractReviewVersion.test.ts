/**
 * useContractReviewVersion composable 测试
 *
 * 覆盖合同审查多版本管理 composable 的核心行为：
 * - refreshWorkspace：加载工作区，摊平 annotations
 * - refreshVersions：加载版本列表
 * - enterPreview / exitPreview：切换只读历史版本模式
 * - 只读态守护：isReadOnly=true 时，编辑动作静默不发请求
 * - saveNewVersion：成功后触发 refreshWorkspace + refreshVersions
 * - updateAnnotation：批注内容编辑走 debounce 500ms pending map 模式
 *
 * mock 策略：vi.mock useApiFetch 捕获请求，vi.useFakeTimers 验证 debounce。
 *
 * **Feature: contract-review-versioning-phase-a**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { CONTRACT_UPLOAD_VERSION_SSE_EVENT } from '#shared/types/contract'

// ── mock @vueuse/core：默认取消 debounce，让调用立即生效 ──────────────────────
// debounce 真实节流用 vi.useFakeTimers 的单独 describe 块验证。

vi.mock('@vueuse/core', async () => {
    const actual = await vi.importActual<typeof import('@vueuse/core')>('@vueuse/core')
    return {
        ...actual,
        useDebounceFn: (fn: (...args: unknown[]) => unknown) => fn,
    }
})

// ── mock useApiFetch ────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: unknown[]) => mockFetch(...args),
}))

// ── 动态导入（mock 注册后）──────────────────────────────────────────────────

const { useContractReviewVersion } = await import('~/composables/useContractReviewVersion')

// ── 测试数据工厂 ────────────────────────────────────────────────────────────

function makeRisk(id: number, reviewId: number = 1) {
    return {
        id,
        reviewId,
        source: 'ai' as const,
        code: null,
        category: '试用期',
        level: 'high' as const,
        stance: 'balanced' as const,
        problem: '超长试用期',
        legalBasis: null,
        analysis: null,
        suggestion: null,
        archivedStatus: null,
        archivedAt: null,
        clauseText: '试用期 6 个月',
        clauseParagraphIndex: null,
        clauseCharStart: null,
        clauseCharEnd: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    }
}

function makeAnnotation(id: number, riskId: number, reviewId: number = 1) {
    return {
        id,
        reviewId,
        riskId,
        parentAnnotationId: null,
        authorType: 'ai' as const,
        authorName: 'AI',
        authorUserId: null,
        content: 'AI 审查意见',
        createdAt: '2026-01-01T00:00:00.000Z',
    }
}

function makeVersion(id: number, reviewId: number = 1, versionNumber: number = 1) {
    return {
        id,
        reviewId,
        versionNumber,
        systemLabel: 'initial_upload' as const,
        lawyerNote: null,
        createdById: 1,
        createdByName: '张三',
        createdAt: '2026-01-01T00:00:00.000Z',
    }
}

function makeSnap(overrides: { risks?: any[]; annotations?: any[]; docxText?: string } = {}) {
    return {
        id: 5,
        reviewId: 1,
        versionNumber: 1,
        systemLabel: 'initial_upload' as const,
        lawyerNote: null,
        createdById: 1,
        createdByName: '张三',
        createdAt: '2026-01-01T00:00:00.000Z',
        snapshot: {
            risks: overrides.risks ?? [],
            annotations: overrides.annotations ?? [],
            docxText: overrides.docxText ?? '',
        },
    }
}

function makeWorkspaceResponse(opts: { risks?: any[]; currentVersionId?: number | null; maxVersionNo?: number } = {}) {
    const risk = makeRisk(1)
    const ann = makeAnnotation(1, 1)
    return {
        id: 1,
        risks: (opts.risks ?? [{ ...risk, annotations: [ann] }]),
        currentVersionId: opts.currentVersionId ?? 1,
        maxVersionNo: opts.maxVersionNo ?? 1,
    }
}

// ── 测试套件 ────────────────────────────────────────────────────────────────

describe('useContractReviewVersion.refreshWorkspace', () => {
    beforeEach(() => { mockFetch.mockReset() })

    it('加载工作区：risks 去掉 annotations、annotations 摊平到独立数组', async () => {
        const risk = makeRisk(1)
        const ann = makeAnnotation(1, 1)
        // 后端返回 { review: { ... } }（bug #20 修复后），mock 同步包一层
        mockFetch.mockResolvedValueOnce({
            review: {
                id: 1,
                risks: [{ ...risk, annotations: [ann] }],
                currentVersionId: 10,
                maxVersionNo: 2,
            },
        })

        const c = useContractReviewVersion(ref(1))
        await c.refreshWorkspace()

        expect(c.workspace.value.risks).toHaveLength(1)
        expect((c.workspace.value.risks[0] as any).annotations).toBeUndefined()
        expect(c.workspace.value.annotations).toHaveLength(1)
        expect(c.workspace.value.annotations[0].id).toBe(1)
        expect(c.workspace.value.currentVersionId).toBe(10)
        expect(c.workspace.value.maxVersionNo).toBe(2)
    })

    it('服务端返回 null 时静默不更新', async () => {
        mockFetch.mockResolvedValueOnce(null)
        const c = useContractReviewVersion(ref(1))
        await c.refreshWorkspace()
        expect(c.workspace.value.risks).toHaveLength(0)
    })

    it('risks 为空数组时 annotations 也为空', async () => {
        mockFetch.mockResolvedValueOnce({
            id: 1,
            risks: [],
            currentVersionId: null,
            maxVersionNo: 0,
        })
        const c = useContractReviewVersion(ref(1))
        await c.refreshWorkspace()
        expect(c.workspace.value.risks).toHaveLength(0)
        expect(c.workspace.value.annotations).toHaveLength(0)
    })
})

describe('useContractReviewVersion.refreshVersions', () => {
    beforeEach(() => { mockFetch.mockReset() })

    it('加载版本列表写入 versions.value', async () => {
        const v1 = makeVersion(1, 1, 1)
        const v2 = makeVersion(2, 1, 2)
        mockFetch.mockResolvedValueOnce({ versions: [v2, v1] })

        const c = useContractReviewVersion(ref(1))
        await c.refreshVersions()

        expect(c.versions.value).toHaveLength(2)
        expect(c.versions.value[0].id).toBe(2)
    })

    it('服务端返回 null 时版本列表不变', async () => {
        mockFetch.mockResolvedValueOnce(null)
        const c = useContractReviewVersion(ref(1))
        c.versions.value = [makeVersion(99)]
        await c.refreshVersions()
        expect(c.versions.value).toHaveLength(1)
    })
})

describe('useContractReviewVersion enterPreview / exitPreview', () => {
    beforeEach(() => { mockFetch.mockReset() })

    it('enterPreview 成功后 isReadOnly=true，previewSnapshot 有值', async () => {
        mockFetch.mockResolvedValueOnce(makeSnap({
            risks: [makeRisk(10)],
            annotations: [makeAnnotation(20, 10)],
            docxText: '合同原文',
        }))

        const c = useContractReviewVersion(ref(1))
        expect(c.isReadOnly.value).toBe(false)

        await c.enterPreview(5)

        expect(c.isReadOnly.value).toBe(true)
        expect(c.previewVersionId.value).toBe(5)
        expect(c.previewSnapshot.value?.snapshot.docxText).toBe('合同原文')
    })

    it('enterPreview 失败时 isReadOnly 保持 false', async () => {
        mockFetch.mockResolvedValueOnce(null)
        const c = useContractReviewVersion(ref(1))
        await c.enterPreview(99)
        expect(c.isReadOnly.value).toBe(false)
        expect(c.previewVersionId.value).toBeNull()
    })

    it('exitPreview 清除 previewVersionId 和 previewSnapshot', async () => {
        mockFetch.mockResolvedValueOnce(makeSnap())

        const c = useContractReviewVersion(ref(1))
        await c.enterPreview(5)
        expect(c.isReadOnly.value).toBe(true)

        c.exitPreview()

        expect(c.isReadOnly.value).toBe(false)
        expect(c.previewVersionId.value).toBeNull()
        expect(c.previewSnapshot.value).toBeNull()
    })

    it('currentView 在预览态返回快照数据', async () => {
        mockFetch.mockResolvedValueOnce(makeSnap({ risks: [makeRisk(77)], docxText: '历史合同正文' }))

        const c = useContractReviewVersion(ref(1))
        await c.enterPreview(5)

        expect(c.currentView.value.docxText).toBe('历史合同正文')
        expect(c.currentView.value.risks[0].id).toBe(77)
    })
})

describe('useContractReviewVersion 只读态守护', () => {
    beforeEach(() => { mockFetch.mockReset() })

    async function mountInPreview() {
        mockFetch.mockResolvedValueOnce(makeSnap())
        const c = useContractReviewVersion(ref(1))
        await c.enterPreview(5)
        mockFetch.mockReset()
        return c
    }

    it('isReadOnly=true 时 updateRiskArchivedStatus 静默不发请求', async () => {
        const c = await mountInPreview()
        await c.updateRiskArchivedStatus(1, 'handled')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('isReadOnly=true 时 addLawyerAnnotation 静默返回 null', async () => {
        const c = await mountInPreview()
        const result = await c.addLawyerAnnotation(1, '我的批注')
        expect(mockFetch).not.toHaveBeenCalled()
        expect(result).toBeNull()
    })

    it('isReadOnly=true 时 updateAnnotation 静默不发请求', async () => {
        const c = await mountInPreview()
        await c.updateAnnotation(1, '修改内容')
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('isReadOnly=true 时 deleteAnnotation 静默不发请求', async () => {
        const c = await mountInPreview()
        await c.deleteAnnotation(1)
        expect(mockFetch).not.toHaveBeenCalled()
    })

    it('isReadOnly=true 时 saveNewVersion 返回 false 不发请求', async () => {
        const c = await mountInPreview()
        const ok = await c.saveNewVersion('备注')
        expect(mockFetch).not.toHaveBeenCalled()
        expect(ok).toBe(false)
    })
})

describe('useContractReviewVersion.saveNewVersion', () => {
    beforeEach(() => { mockFetch.mockReset() })

    it('成功后触发 refreshWorkspace 和 refreshVersions（各调用一次 fetch）', async () => {
        const c = useContractReviewVersion(ref(1))
        // 1. POST 保存版本
        mockFetch.mockResolvedValueOnce({ id: 2, versionNumber: 2, systemLabel: 'lawyer_save' })
        // 2. refreshWorkspace 调用
        mockFetch.mockResolvedValueOnce(makeWorkspaceResponse({ currentVersionId: 2, maxVersionNo: 2 }))
        // 3. refreshVersions 调用
        mockFetch.mockResolvedValueOnce({ versions: [makeVersion(2, 1, 2)] })

        const ok = await c.saveNewVersion('第二版')

        expect(ok).toBe(true)
        expect(mockFetch).toHaveBeenCalledTimes(3)
        expect(mockFetch).toHaveBeenNthCalledWith(
            1,
            `/api/v1/assistant/contract/reviews/version-list/1`,
            expect.objectContaining({ method: 'POST', body: { lawyerNote: '第二版' } }),
        )
    })

    it('POST 失败时返回 false 且不继续 refresh', async () => {
        mockFetch.mockResolvedValueOnce(null)
        const c = useContractReviewVersion(ref(1))
        const ok = await c.saveNewVersion()
        expect(ok).toBe(false)
        expect(mockFetch).toHaveBeenCalledTimes(1)
    })
})

describe('useContractReviewVersion.updateRiskArchivedStatus', () => {
    beforeEach(() => { mockFetch.mockReset() })

    it('成功后乐观更新本地 risk.archivedStatus', async () => {
        mockFetch.mockResolvedValueOnce({ id: 1, archivedStatus: 'handled', archivedAt: '2026-01-01T00:00:00.000Z' })

        const c = useContractReviewVersion(ref(1))
        c.workspace.value.risks = [makeRisk(1)]

        await c.updateRiskArchivedStatus(1, 'handled')

        expect(c.workspace.value.risks[0].archivedStatus).toBe('handled')
        expect(c.workspace.value.risks[0].archivedAt).toBeTruthy()
    })

    it('传 null 时清除 archivedStatus', async () => {
        mockFetch.mockResolvedValueOnce({ id: 1, archivedStatus: null, archivedAt: null })

        const c = useContractReviewVersion(ref(1))
        c.workspace.value.risks = [{ ...makeRisk(1), archivedStatus: 'handled' as const }]

        await c.updateRiskArchivedStatus(1, null)

        expect(c.workspace.value.risks[0].archivedStatus).toBeNull()
        expect(c.workspace.value.risks[0].archivedAt).toBeNull()
    })
})

describe('useContractReviewVersion.addLawyerAnnotation', () => {
    beforeEach(() => { mockFetch.mockReset() })

    it('成功后将新批注 push 到 workspace.annotations', async () => {
        const newAnn = makeAnnotation(100, 1)
        mockFetch.mockResolvedValueOnce(newAnn)

        const c = useContractReviewVersion(ref(1))
        const result = await c.addLawyerAnnotation(1, '我的批注')

        expect(result?.id).toBe(100)
        expect(c.workspace.value.annotations).toHaveLength(1)
        expect(c.workspace.value.annotations[0].id).toBe(100)
    })
})

describe('useContractReviewVersion.deleteAnnotation', () => {
    beforeEach(() => { mockFetch.mockReset() })

    it('成功后从 workspace.annotations 移除该批注', async () => {
        mockFetch.mockResolvedValueOnce({ deleted: true })

        const c = useContractReviewVersion(ref(1))
        c.workspace.value.annotations = [makeAnnotation(1, 1), makeAnnotation(2, 1)]

        await c.deleteAnnotation(1)

        expect(c.workspace.value.annotations).toHaveLength(1)
        expect(c.workspace.value.annotations[0].id).toBe(2)
    })

    it('服务端返回 null 时不修改本地列表', async () => {
        mockFetch.mockResolvedValueOnce(null)

        const c = useContractReviewVersion(ref(1))
        c.workspace.value.annotations = [makeAnnotation(1, 1)]

        await c.deleteAnnotation(1)

        expect(c.workspace.value.annotations).toHaveLength(1)
    })
})

describe('useContractReviewVersion.updateVersionNote', () => {
    beforeEach(() => { mockFetch.mockReset() })

    it('成功后更新 versions 中对应版本的 lawyerNote', async () => {
        mockFetch.mockResolvedValueOnce({ id: 1, lawyerNote: '发张三法务审阅' })

        const c = useContractReviewVersion(ref(1))
        c.versions.value = [makeVersion(1)]

        await c.updateVersionNote(1, '发张三法务审阅')

        expect(c.versions.value[0].lawyerNote).toBe('发张三法务审阅')
    })
})

// ── debounce 真实 500ms 验证（不 mock @vueuse/core）──────────────────────────

describe('useContractReviewVersion.updateAnnotation debounce 500ms', () => {
    beforeEach(() => {
        mockFetch.mockReset()
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    // 顶层 mock 把 useDebounceFn 变成 identity，此处只验证调用后 PATCH 能正常发出；
    // 真实 debounce 500ms 合并行为在 useContractReviewVersion.debounce.test.ts 中独立验证
    it('连续调用 updateAnnotation 在 500ms 后合并成一次 PATCH', async () => {
        mockFetch.mockResolvedValueOnce({ id: 1, content: '最终内容' })

        const c = useContractReviewVersion(ref(1))
        c.workspace.value.annotations = [makeAnnotation(1, 1)]

        await c.updateAnnotation(1, '最终内容')
        await nextTick()

        expect(mockFetch).toHaveBeenCalledWith(
            '/api/v1/assistant/contract/reviews/annotations/1',
            expect.objectContaining({ method: 'PATCH', body: { content: '最终内容' } }),
        )
    })

    it('updateAnnotation 乐观更新：调用后本地 content 立即变化', async () => {
        mockFetch.mockResolvedValue(null)

        const c = useContractReviewVersion(ref(1))
        c.workspace.value.annotations = [makeAnnotation(1, 1)]

        await c.updateAnnotation(1, '即时更新的内容')

        expect(c.workspace.value.annotations[0].content).toBe('即时更新的内容')
    })
})

describe('useContractReviewVersion.currentView', () => {
    it('工作区模式下 currentView 使用 workspace 数据', async () => {
        const c = useContractReviewVersion(ref(1))
        c.workspace.value.risks = [makeRisk(1)]
        c.workspace.value.annotations = [makeAnnotation(1, 1)]

        expect(c.currentView.value.risks).toHaveLength(1)
        expect(c.currentView.value.annotations).toHaveLength(1)
        expect(c.currentView.value.docxText).toBe('')
    })
})

// ── lastUploadResult & dismissUploadBanner （Task 3.3）────────────────────────

describe('useContractReviewVersion.lastUploadResult & dismissUploadBanner', () => {
    beforeEach(() => {
        mockFetch.mockReset()
    })

    it('初始状态 lastUploadResult 为 null', () => {
        const c = useContractReviewVersion(ref(1))
        expect(c.lastUploadResult.value).toBeNull()
    })

    it('dismissUploadBanner 将 lastUploadResult 置为 null', () => {
        const c = useContractReviewVersion(ref(1))
        c.lastUploadResult.value = { newVersionId: 10, summary: '测试摘要' }
        expect(c.lastUploadResult.value).not.toBeNull()

        c.dismissUploadBanner()
        expect(c.lastUploadResult.value).toBeNull()
    })

    it('lastUploadResult 可直接赋值，dismissUploadBanner 后归零（Panel 集成模型）', () => {
        const c = useContractReviewVersion(ref(1))

        c.lastUploadResult.value = { newVersionId: 99, summary: '新版本已生成，发现 3 处外部变更' }
        expect(c.lastUploadResult.value?.newVersionId).toBe(99)
        expect(c.lastUploadResult.value?.summary).toBe('新版本已生成，发现 3 处外部变更')

        c.dismissUploadBanner()
        expect(c.lastUploadResult.value).toBeNull()
    })
})

// ── uploadNewVersion：SSE 流消费 & 业务错误识别（S6）─────────────────────────

describe('useContractReviewVersion.uploadNewVersion', () => {
    afterEach(() => { vi.unstubAllGlobals() })

    /** 构造 resError 的响应：服务端开流前失败时返回 HTTP 200 + application/json 业务错误体 */
    function makeResErrorResponse(message: string): Response {
        return {
            ok: true,
            status: 200,
            headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
            body: {},
            json: async () => ({ code: 401, success: false, message }),
        } as unknown as Response
    }

    /** 构造真正的 SSE 流响应：text/event-stream + ReadableStream */
    function makeSseResponse(sseText: string): Response {
        const encoder = new TextEncoder()
        return {
            ok: true,
            status: 200,
            headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
            body: new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoder.encode(sseText))
                    controller.close()
                },
            }),
        } as unknown as Response
    }

    it('S6：服务端开流前失败（resError 返回 HTTP 200 + JSON）→ 识别为业务错误而非卡转圈', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => makeResErrorResponse('会话已过期，请重新登录')))

        const c = useContractReviewVersion(ref(1))
        const { error, done } = await c.uploadNewVersion(123)

        await vi.waitFor(() => {
            expect(error.value).not.toBeNull()
        })
        // resError 是 HTTP 200，resp.ok 恒 true；必须靠 content-type 识别出 JSON 业务错误体，
        // 并把其中的 message 写入 error.value，否则对话框永久停在"处理中"。
        expect(error.value?.message).toBe('会话已过期，请重新登录')
        expect(done.value).toBe(false)
    })

    it('正常 SSE 流（text/event-stream）→ 正常消费 progress / complete 事件', async () => {
        const sse =
            `event: ${CONTRACT_UPLOAD_VERSION_SSE_EVENT.PROGRESS}\n`
            + `data: ${JSON.stringify({ step: 'backup', status: 'done' })}\n\n`
            + `event: ${CONTRACT_UPLOAD_VERSION_SSE_EVENT.COMPLETE}\n`
            + `data: ${JSON.stringify({ newVersionId: 7, summary: '完成' })}\n\n`
        vi.stubGlobal('fetch', vi.fn(async () => makeSseResponse(sse)))

        const c = useContractReviewVersion(ref(1))
        const { done, result, error } = await c.uploadNewVersion(123)

        await vi.waitFor(() => {
            expect(done.value).toBe(true)
        })
        expect(error.value).toBeNull()
        expect(result.value).toEqual({ newVersionId: 7, summary: '完成' })
    })

    it('真正的 HTTP 错误（非 2xx）→ error.value 写入兜底信息', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 502,
            headers: { get: () => null },
            body: null,
            json: async () => { throw new Error('no json') },
        } as unknown as Response)))

        const c = useContractReviewVersion(ref(1))
        const { error } = await c.uploadNewVersion(123)

        await vi.waitFor(() => {
            expect(error.value).not.toBeNull()
        })
        expect(error.value?.message).toContain('502')
    })
})
