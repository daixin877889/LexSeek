/**
 * processMaterials 工具单测
 *
 * 验证：
 * - 缺 caseId 与 draftId 时直接报错并返回 error JSON
 * - draftId 优先：传 draftId + caseId 时调用 byDraft 入口
 * - caseId 路径：调用 ensureMaterialsReadyService
 * - 空材料：返回 empty 模式 + 文案区分 case/draft
 * - 正常 full 模式：tokenCount 取自 content；embeddedMap 透传
 * - summary 模式：tokenCount 取自 summary；hint 出现
 * - 端到端硬封顶 enforceTokenCap：超 cap 时尾部材料降级为 index 并产出降级 hint
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

;(globalThis as any).logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
}

// estimateTokens 故意支持运行时倍数：默认 1×；通过 setEstimateMultiplier 可调高，
// 用于触发"第一轮估算偏大、第二轮兜底降级"分支
let estimateMultiplier = 1
function setEstimateMultiplier(n: number) { estimateMultiplier = n }

// Mock 材料 pipeline service：保留 getSourceId / TOKEN_THRESHOLD 真实实现
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    ensureMaterialsReadyService: vi.fn(),
    ensureMaterialsReadyByDraftService: vi.fn(),
    getMaterialContextService: vi.fn(),
    estimateTokens: (text: string) => (text ? text.length * estimateMultiplier : 0),
    getSourceId: (m: any) => m.ossFileId ?? m.id,
    TOKEN_THRESHOLD: 15000,
    snapshotMaterialReadiness: vi.fn(async () => []),
}))

// Mock tokenCounter，把 countTokensSync 简化为字符长度
vi.mock('~~/server/utils/tokenCounter', () => ({
    countTokensSync: (text: string) => (text ? text.length : 0),
    countTokens: vi.fn(),
}))

import {
    ensureMaterialsReadyService,
    ensureMaterialsReadyByDraftService,
    getMaterialContextService,
} from '~~/server/services/material/materialPipeline.service'
import { createTool } from '~~/server/services/agent-platform/tools/processMaterials.tool'

const baseCtx = { userId: 1, sessionId: 'sess-1' } as any

function makeMaterial(overrides: Partial<{ id: number; ossFileId: number; name: string; type: number }> = {}) {
    return {
        id: overrides.id ?? 1,
        ossFileId: overrides.ossFileId ?? null,
        name: overrides.name ?? '材料1',
        type: overrides.type ?? 1,
    } as any
}

describe('process_materials 工具', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('缺 caseId 和 draftId 时返回 error JSON', async () => {
        const tool = createTool({ ...baseCtx })
        const raw: any = await tool.invoke({}, { toolCall: { id: 'c1' } } as any)
        const result = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(result.error).toBe('材料处理失败')
        expect(result.message).toMatch(/caseId 或 draftId/)
        // 异常分支不会调下游入口
        expect(ensureMaterialsReadyService).not.toHaveBeenCalled()
        expect(ensureMaterialsReadyByDraftService).not.toHaveBeenCalled()
    })

    it('caseId 路径：空材料返回 empty 模式且文案为案件版本', async () => {
        ;(ensureMaterialsReadyService as any).mockResolvedValue({
            materials: [],
            embeddedMap: new Map(),
        })

        const tool = createTool({ ...baseCtx, caseId: 100 })
        const raw: any = await tool.invoke({}, { toolCall: { id: 'c1' } } as any)
        const result = JSON.parse(typeof raw === 'string' ? raw : raw.content)

        expect(ensureMaterialsReadyService).toHaveBeenCalledWith(100, 1)
        expect(ensureMaterialsReadyByDraftService).not.toHaveBeenCalled()
        expect(result.mode).toBe('empty')
        expect(result.message).toContain('案件')
        expect(result.materials).toEqual([])
    })

    it('draftId 优先：同时传 caseId+draftId 时走 byDraft 入口并把 fileIds 透传', async () => {
        ;(ensureMaterialsReadyByDraftService as any).mockResolvedValue({
            materials: [],
            embeddedMap: new Map(),
        })

        const tool = createTool({ ...baseCtx, caseId: 100, draftId: 50 })
        const raw: any = await tool.invoke({ fileIds: [11, 22] }, { toolCall: { id: 'c1' } } as any)
        const result = JSON.parse(typeof raw === 'string' ? raw : raw.content)

        expect(ensureMaterialsReadyByDraftService).toHaveBeenCalledWith(50, 1, {
            fileIds: [11, 22],
            caseId: 100,
        })
        expect(ensureMaterialsReadyService).not.toHaveBeenCalled()
        expect(result.mode).toBe('empty')
        // draft 路径文案
        expect(result.message).toContain('文书草稿')
    })

    it('full 模式：tokenCount=content 长度；embedded 来自 embeddedMap', async () => {
        const m1 = makeMaterial({ id: 1, ossFileId: 11, name: '合同' })
        const m2 = makeMaterial({ id: 2, ossFileId: 22, name: '证据' })
        ;(ensureMaterialsReadyService as any).mockResolvedValue({
            materials: [m1, m2],
            embeddedMap: new Map([[1, true], [2, false]]),
        })
        ;(getMaterialContextService as any).mockResolvedValue({
            mode: 'full',
            totalTokens: 30,
            materialList: [
                { sourceId: 11, name: '合同', type: 1, hasContent: true, mode: 'full', content: '合同内容' },
                { sourceId: 22, name: '证据', type: 1, hasContent: true, mode: 'full', content: '证据内容XYZ' },
            ],
        })

        const tool = createTool({ ...baseCtx, caseId: 100 })
        const raw: any = await tool.invoke({}, { toolCall: { id: 'c1' } } as any)
        const result = JSON.parse(typeof raw === 'string' ? raw : raw.content)

        expect(result.mode).toBe('full')
        expect(result.threshold).toBe(15000)
        expect(result.materialCount).toBe(2)
        expect(result.materialsWithContent).toBe(2)
        expect(result.hint).toBeUndefined()

        // full 模式 tokenCount = content.length（mock 的 estimateTokens）
        const m1Out = result.materials.find((m: any) => m.sourceId === 11)
        const m2Out = result.materials.find((m: any) => m.sourceId === 22)
        expect(m1Out.tokenCount).toBe('合同内容'.length)
        expect(m1Out.id).toBe(1)
        expect(m1Out.embedded).toBe(true)
        expect(m2Out.tokenCount).toBe('证据内容XYZ'.length)
        expect(m2Out.embedded).toBe(false)
    })

    it('summary 模式：tokenCount=summary 长度；附带 hint', async () => {
        const m1 = makeMaterial({ id: 1, ossFileId: 11 })
        ;(ensureMaterialsReadyService as any).mockResolvedValue({
            materials: [m1],
            embeddedMap: new Map([[1, true]]),
        })
        ;(getMaterialContextService as any).mockResolvedValue({
            mode: 'summary',
            totalTokens: 4,
            materialList: [
                { sourceId: 11, name: '材料1', type: 1, hasContent: true, mode: 'summary', summary: '简短' },
            ],
        })

        const tool = createTool({ ...baseCtx, caseId: 100 })
        const raw: any = await tool.invoke({}, { toolCall: { id: 'c1' } } as any)
        const result = JSON.parse(typeof raw === 'string' ? raw : raw.content)

        expect(result.mode).toBe('summary')
        expect(result.hint).toContain('search_case_materials')
        expect(result.materials[0].tokenCount).toBe('简短'.length)
    })

    it('未匹配到 material 时，embedded 与 id 走默认值（覆盖 find 失败分支）', async () => {
        const m1 = makeMaterial({ id: 1, ossFileId: 11 })
        ;(ensureMaterialsReadyService as any).mockResolvedValue({
            materials: [m1],
            embeddedMap: new Map(),
        })
        // materialList 中 sourceId=99 在 materials 里找不到
        ;(getMaterialContextService as any).mockResolvedValue({
            mode: 'full',
            totalTokens: 0,
            materialList: [
                { sourceId: 99, name: '幽灵', type: 1, hasContent: false, mode: 'full', content: '' },
            ],
        })

        const tool = createTool({ ...baseCtx, caseId: 100 })
        const raw: any = await tool.invoke({}, { toolCall: { id: 'c1' } } as any)
        const result = JSON.parse(typeof raw === 'string' ? raw : raw.content)

        const item = result.materials[0]
        expect(item.id).toBeUndefined()
        expect(item.embedded).toBe(false)
        // 没有内容时 tokenCount 为 0
        expect(item.tokenCount).toBe(0)
    })

    it('enforceTokenCap：超 cap 时尾部材料降级为 index 模式并附带 degradeHint', async () => {
        // 构造大体积 materialList 触发硬封顶（内容字符数 > 25000 token cap）
        const bigContent = 'x'.repeat(20000)
        const materials = Array.from({ length: 3 }, (_, i) =>
            makeMaterial({ id: i + 1, ossFileId: 100 + i, name: `mat${i}` }))
        ;(ensureMaterialsReadyService as any).mockResolvedValue({
            materials,
            embeddedMap: new Map(materials.map(m => [m.id, true])),
        })
        ;(getMaterialContextService as any).mockResolvedValue({
            mode: 'full',
            totalTokens: 60000,
            materialList: materials.map((m) => ({
                sourceId: m.ossFileId,
                name: m.name,
                type: 1,
                hasContent: true,
                mode: 'full' as const,
                content: bigContent,
            })),
        })

        const tool = createTool({ ...baseCtx, caseId: 100 })
        const raw: any = await tool.invoke({}, { toolCall: { id: 'c1' } } as any)
        const result = JSON.parse(typeof raw === 'string' ? raw : raw.content)

        // 至少有一份被降级
        const indexed = result.materials.filter((m: any) => m.mode === 'index')
        expect(indexed.length).toBeGreaterThan(0)
        // 降级 hint 出现
        expect(result.hint).toMatch(/已将 \d+ 份低优先级材料降级为索引模式/)
        // 索引模式材料 summary = 提示文案
        expect(indexed[0].summary).toContain('search_case_materials')
        // 索引模式 tokenCount = 提示文案长度
        expect(indexed[0].tokenCount).toBe(indexed[0].summary.length)
        // 优先降级尾部
        expect(result.materials[result.materials.length - 1].mode).toBe('index')
    })

    it('enforceTokenCap：第一轮估算偏大、降级不足时，第二轮逐份再降级直至达标', async () => {
        // 故意把 estimateTokens 放大 5 倍 → 第一轮按 tokenCount 估算误认为只需降 1 份，
        // 但 countTokensSync 用真实字符长度统计，JSON 仍超 cap，触发第二轮逐份降级。
        // 数组长度 >=11 走 i%10===0 校核分支
        setEstimateMultiplier(5)
        const bigContent = 'x'.repeat(2500) // 12 份 × 2500 ≈ 30000 chars 超 25000 cap
        const materials = Array.from({ length: 12 }, (_, i) =>
            makeMaterial({ id: i + 1, ossFileId: 200 + i, name: `m${i}` }))
        ;(ensureMaterialsReadyService as any).mockResolvedValue({
            materials,
            embeddedMap: new Map(materials.map(m => [m.id, true])),
        })
        ;(getMaterialContextService as any).mockResolvedValue({
            mode: 'full',
            totalTokens: 30000,
            materialList: materials.map((m) => ({
                sourceId: m.ossFileId,
                name: m.name,
                type: 1,
                hasContent: true,
                mode: 'full' as const,
                content: bigContent,
            })),
        })

        try {
            const tool = createTool({ ...baseCtx, caseId: 100 })
            const raw: any = await tool.invoke({}, { toolCall: { id: 'c1' } } as any)
            const result = JSON.parse(typeof raw === 'string' ? raw : raw.content)

            // 多份被降级，hint 提到降级数
            const indexed = result.materials.filter((m: any) => m.mode === 'index')
            expect(indexed.length).toBeGreaterThanOrEqual(2)
            expect(result.hint).toMatch(/已将 \d+ 份低优先级材料降级为索引模式/)
        } finally {
            setEstimateMultiplier(1)
        }
    })

    it('下游 ensureMaterials 抛错时返回 error JSON 不抛', async () => {
        ;(ensureMaterialsReadyService as any).mockRejectedValue(new Error('数据库连接失败'))

        const tool = createTool({ ...baseCtx, caseId: 100 })
        const raw: any = await tool.invoke({}, { toolCall: { id: 'c1' } } as any)
        const result = JSON.parse(typeof raw === 'string' ? raw : raw.content)

        expect(result.error).toBe('材料处理失败')
        expect(result.message).toBe('数据库连接失败')
    })
})
